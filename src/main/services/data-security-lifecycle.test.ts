import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { PrismaClient } from '@prisma/client';
import CryptoJS from 'crypto-js';
import { SecretStorage } from './secret-storage.ts';
import { DATABASE_SETUP_STATEMENTS } from './database-service-helpers.ts';
import * as backupHelpers from './backup-service-helpers.ts';
import * as configHelpers from './config-service-helpers.ts';

const nativeRequire = createRequire(import.meta.url);

// Load production services with only app/OS/log boundaries replaced; the SQLite operations are real.
async function withServices(
  action: (services: {
    client: PrismaClient;
    credentials: typeof import('./credential-manager').credentialManager;
    configs: typeof import('./config-service').configService;
    backups: typeof import('./backup-service').backupService;
    dir: string;
    store: SecretStorage;
  }) => Promise<void>
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usg-data-lifecycle-'));
  const client = new PrismaClient({
    datasources: { db: { url: `file:${path.join(dir, 'test.db')}` } },
  });
  try {
    for (const sql of DATABASE_SETUP_STATEMENTS) await client.$executeRawUnsafe(sql);
    const store = new SecretStorage(path.join(dir, 'key'), {
      isEncryptionAvailable: () => false,
      encryptString: () => {
        throw new Error('unavailable');
      },
      decryptString: () => {
        throw new Error('unavailable');
      },
    });
    const dependencies: Record<string, unknown> = {
      electron: { app: { getPath: () => dir } },
      './prisma-client': { prisma: client },
      './secret-protection': { secretStorage: store },
      './logger': {
        logger: {
          info: async () => {},
          success: async () => {},
          error: async () => {},
          warning: async () => {},
        },
      },
      './backup-service-helpers': backupHelpers,
      './config-service-helpers': configHelpers,
    };
    const load = async (filename: string) => {
      const source = await fs.readFile(new URL(filename, import.meta.url), 'utf8');
      const compiled = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      }).outputText;
      const exported = { exports: {} };
      vm.runInNewContext(
        compiled,
        {
          module: exported,
          exports: exported.exports,
          require: (id: string) => dependencies[id] ?? nativeRequire(id),
          console,
          Buffer,
          process,
        },
        { filename }
      );
      return exported.exports as Record<string, unknown>;
    };
    const credentials = (await load('credential-manager.ts'))
      .credentialManager as typeof import('./credential-manager').credentialManager;
    const configs = (await load('config-service.ts'))
      .configService as typeof import('./config-service').configService;
    const backups = (await load('backup-service.ts'))
      .backupService as typeof import('./backup-service').backupService;
    await action({ client, credentials, configs, backups, dir, store });
  } finally {
    await client.$disconnect();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('credential private key, password and passphrase survive encrypted persistence and old key migration', async () => {
  await withServices(async ({ client, credentials, store }) => {
    await client.device.create({ data: { id: 'd', name: 'device', host: '192.0.2.1' } });
    await credentials.saveCredential({
      deviceId: 'd',
      authType: 'PrivateKey',
      username: 'admin',
      privateKey: 'PRIVATE KEY MATERIAL',
      passphrase: 'key-secret',
      password: 'password-secret',
    });
    const saved = await client.credentialRef.findUniqueOrThrow({ where: { deviceId: 'd' } });
    assert.notEqual(saved.privateKey, 'PRIVATE KEY MATERIAL');
    assert.ok(!saved.secretRef?.includes('key-secret'));
    const read = await credentials.getCredential('d');
    assert.equal(read?.privateKey, 'PRIVATE KEY MATERIAL');
    assert.equal(read?.passphrase, 'key-secret');
    assert.equal(read?.password, 'password-secret');
    await credentials.updatePassword('d', 'new-password');
    assert.equal((await credentials.getCredential('d'))?.passphrase, 'key-secret');
    await client.credentialRef.update({
      where: { deviceId: 'd' },
      data: { privateKey: 'LEGACY PRIVATE KEY', secretRef: await store.protect('legacy-password') },
    });
    assert.equal((await credentials.getCredential('d'))?.privateKey, 'LEGACY PRIVATE KEY');
    assert.notEqual(
      (await client.credentialRef.findUniqueOrThrow({ where: { deviceId: 'd' } })).privateKey,
      'LEGACY PRIVATE KEY'
    );
  });
});

test('backup files encrypt legacy private keys and reject foreign-key fingerprints before replacing data', async () => {
  await withServices(async ({ client, backups, dir, store }) => {
    await client.device.create({ data: { id: 'd', name: 'original', host: '192.0.2.1' } });
    await client.credentialRef.create({
      data: {
        deviceId: 'd',
        authType: 'PrivateKey',
        privateKey: 'LEGACY PRIVATE KEY',
        secretRef: await store.protect('private-password'),
      },
    });
    await client.config.create({
      data: {
        key: 'automation',
        value: JSON.stringify({
          enabled: false,
          smtpPassword: 'misplaced-secret',
          autoUpdateEnabled: true,
          clientEgressConfirmed: true,
          selectedDevices: ['d'],
          managedRuleIds: ['r'],
        }),
      },
    });
    const info = await backups.createBackup();
    const content = await fs.readFile(info.path, 'utf8');
    assert.ok(!content.includes('LEGACY PRIVATE KEY'));
    assert.ok(!content.includes('private-password'));
    assert.ok(!content.includes('misplaced-secret'));
    const payload = JSON.parse(content);
    payload.protection.keyFingerprint = '0'.repeat(64);
    const badPath = path.join(dir, 'foreign.json');
    await fs.writeFile(badPath, JSON.stringify(payload));
    await assert.rejects(backups.restoreBackup(badPath), /密钥不匹配/);
    assert.equal((await client.device.findUniqueOrThrow({ where: { id: 'd' } })).name, 'original');
    await client.device.update({ where: { id: 'd' }, data: { name: 'changed' } });
    await backups.restoreBackup(info.path);
    assert.equal((await client.device.findUniqueOrThrow({ where: { id: 'd' } })).name, 'original');
    const restoredAutomation = JSON.parse(
      (await client.config.findUniqueOrThrow({ where: { key: 'automation' } })).value
    );
    assert.equal(restoredAutomation.autoUpdateEnabled, false);
    assert.equal(restoredAutomation.clientEgressConfirmed, false);
    assert.deepEqual(restoredAutomation.selectedDevices, ['d']);
    assert.deepEqual(restoredAutomation.managedRuleIds, ['r']);
  });
});

test('config import keeps masked secrets and applies all imported rows atomically', async () => {
  await withServices(async ({ client, configs, dir }) => {
    await configs.saveConfig('email', {
      host: 'old',
      auth: { user: 'admin', pass: 'real-email-password' },
    });
    const file = path.join(dir, 'config.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        configs: {
          email: { host: 'new', auth: { user: 'admin', pass: '***masked***' } },
          app: { language: 'en-US' },
          automation: {
            autoUpdateEnabled: true,
            clientEgressConfirmed: true,
            selectedDevices: ['target'],
            managedRuleIds: ['rule'],
          },
        },
      })
    );
    await configs.importConfig(file);
    assert.equal(
      (await configs.getConfig<{ auth: { pass: string } }>('email'))?.auth.pass,
      'real-email-password'
    );
    assert.deepEqual(JSON.parse(JSON.stringify(await configs.getConfig('automation'))), {
      autoUpdateEnabled: false,
      clientEgressConfirmed: false,
      selectedDevices: ['target'],
      managedRuleIds: ['rule'],
    });
    assert.ok(
      !(await client.config.findUniqueOrThrow({ where: { key: 'email' } })).value.includes(
        'real-email-password'
      )
    );
    await client.$executeRawUnsafe(
      "CREATE TRIGGER fail_config BEFORE INSERT ON configs WHEN NEW.key = 'system' BEGIN SELECT RAISE(ABORT, 'injected config failure'); END"
    );
    await fs.writeFile(
      file,
      JSON.stringify({ configs: { app: { language: 'zh-CN' }, system: { theme: 'dark' } } })
    );
    await assert.rejects(configs.importConfig(file));
    assert.equal((await configs.getConfig<{ language: string }>('app'))?.language, 'en-US');
  });
});

test('legacy AES encrypted passwords remain readable with the single shared key', async () => {
  await withServices(async ({ client, credentials, configs, dir, store }) => {
    await store.fingerprint();
    const key = await fs.readFile(path.join(dir, 'key'), 'utf8');
    await client.credentialRef.create({
      data: {
        deviceId: 'old',
        authType: 'Password',
        secretRef: CryptoJS.AES.encrypt('old-ssh', key).toString(),
      },
    });
    await client.config.create({
      data: {
        key: 'email',
        value: JSON.stringify({ auth: { pass: CryptoJS.AES.encrypt('old-mail', key).toString() } }),
      },
    });
    assert.equal((await credentials.getCredential('old'))?.password, 'old-ssh');
    assert.equal(
      (await configs.getConfig<{ auth: { pass: string } }>('email'))?.auth.pass,
      'old-mail'
    );
    assert.match(
      (await client.credentialRef.findUniqueOrThrow({ where: { deviceId: 'old' } })).secretRef!,
      /^credential:v1:/
    );
    assert.ok(
      !(await client.config.findUniqueOrThrow({ where: { key: 'email' } })).value.includes(
        'U2FsdGVkX1'
      )
    );
    await client.config.create({
      data: { key: 'automation', value: '{"enabled":false,"smtpPassword":"leftover"}' },
    });
    assert.deepEqual(await configs.getConfig('automation'), { enabled: false });
    assert.ok(
      !(await client.config.findUniqueOrThrow({ where: { key: 'automation' } })).value.includes(
        'leftover'
      )
    );
  });
});

test('invalid imported log retention is rejected before any configuration changes', async () => {
  await withServices(async ({ client, configs, dir }) => {
    await configs.saveConfig('app', { logRetentionDays: 30, language: 'zh-CN' });
    const original = await client.config.findMany();
    const file = path.join(dir, 'invalid-config.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        configs: { app: { logRetentionDays: 0 }, automation: { ipMonitorEnabled: true } },
      })
    );
    await assert.rejects(configs.importConfig(file), /日志保留/);
    assert.deepEqual(await client.config.findMany(), original);
  });
});

test('backup with invalid service configuration is rejected before deleting original rows', async () => {
  await withServices(async ({ client, configs, backups, dir }) => {
    await configs.saveConfig('app', { logRetentionDays: 30 });
    await client.device.create({ data: { id: 'original', name: 'original', host: '192.0.2.1' } });
    const backup = await backups.createBackup();
    const payload = JSON.parse(await fs.readFile(backup.path, 'utf8'));
    payload.data.configs[0].value = '{"logRetentionDays":0}';
    payload.data.devices[0].name = 'replacement';
    const file = path.join(dir, 'invalid-backup.json');
    await fs.writeFile(file, JSON.stringify(payload));
    await assert.rejects(backups.restoreBackup(file), /日志保留/);
    assert.equal(
      (await client.device.findUniqueOrThrow({ where: { id: 'original' } })).name,
      'original'
    );
    assert.equal(
      (await configs.getConfig<{ logRetentionDays: number }>('app'))?.logRetentionDays,
      30
    );
  });
});

test('malformed automation and enabled SMTP configuration cannot be committed by import', async () => {
  await withServices(async ({ client, configs, dir }) => {
    await configs.saveConfig('app', { logRetentionDays: 30 });
    const original = await client.config.findMany();
    const file = path.join(dir, 'invalid-service-config.json');
    for (const config of [
      { automation: { autoUpdateEnabled: 'true', checkInterval: 5 } },
      { automation: { ipMonitorEnabled: true, checkInterval: 0 } },
      { automation: { checkSources: ['unknown'] } },
      {
        email: {
          enabled: true,
          host: 'smtp.example.com',
          port: 465,
          secure: true,
          auth: { user: 'admin', pass: 'secret' },
          from: { address: 'admin@example.com' },
          to: [],
        },
      },
    ]) {
      await fs.writeFile(
        file,
        JSON.stringify({ configs: { app: { logRetentionDays: 7 }, ...config } })
      );
      await assert.rejects(configs.importConfig(file));
      assert.deepEqual(await client.config.findMany(), original);
    }
  });
});
