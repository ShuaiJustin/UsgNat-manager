import assert from 'node:assert/strict';
import test from 'node:test';

test('partial saved settings keep form defaults usable for validation', () => {
  const { formValues } = buildAutomationFormSnapshot({
    automationConfig: { autoUpdateEnabled: false, selectedDevices: ['device-1'] },
  });
  assert.equal(formValues.checkInterval, 5);
  assert.equal(formValues.confirmCount, 3);
  assert.equal(formValues.triggerType, 'immediate');
  assert.equal(formValues.windowsNotifyEnabled, true);
  assert.equal(formValues.smtpPort, '465');
});

import {
  buildAutomationFormSnapshot,
  createAutomationFormSnapshot,
} from './automationFormState.ts';

test('automation snapshots preserve explicit outlet ownership and managed rule scope', () => {
  const snapshot = buildAutomationFormSnapshot({
    automationConfig: {
      clientEgressConfirmed: true,
      managedRuleIds: ['rule-1'],
    },
  });
  assert.equal(snapshot.formValues.clientEgressConfirmed, true);
  assert.deepEqual(snapshot.formValues.managedRuleIds, ['rule-1']);
  const defaults = createAutomationFormSnapshot(
    {},
    {
      emailNotifyEnabled: false,
      wechatNotifyEnabled: false,
      wechatType: 'work',
    }
  );
  assert.equal(defaults.formValues.clientEgressConfirmed, false);
  assert.deepEqual(defaults.formValues.managedRuleIds, []);
});

test('saved automation settings exclude notification secrets and require safety checks', async () => {
  const { buildStoredAutomationSettings } = await import('./automationFormState.ts');
  const stored = buildStoredAutomationSettings({
    selectedDevices: ['device-1'],
    managedRuleIds: ['rule-1'],
    clientEgressConfirmed: true,
    smtpPassword: 'smtp-secret',
    corpSecret: 'wechat-secret',
    appSecret: 'app-secret',
    backupOptions: [],
    securityOptions: [],
  });
  assert.equal('smtpPassword' in stored, false);
  assert.equal('corpSecret' in stored, false);
  assert.equal('appSecret' in stored, false);
  assert.equal(stored.clientEgressConfirmed, true);
  assert.deepEqual(stored.managedRuleIds, ['rule-1']);
  assert.ok(stored.backupOptions?.includes('autoBackup'));
  assert.ok(stored.securityOptions?.includes('verifyRules'));
});

test('buildAutomationFormSnapshot keeps stored automation values for later reset', () => {
  const snapshot = buildAutomationFormSnapshot({
    automationConfig: {
      ipMonitorEnabled: false,
      checkInterval: 12,
      confirmCount: 4,
      checkSources: ['cip.cc'],
      autoUpdateEnabled: true,
      selectedDevices: ['device-1'],
      emailNotifyEnabled: true,
      wechatNotifyEnabled: true,
      wechatType: 'webhook',
      recipientEmails: 'ops@example.com',
    },
  });

  assert.equal(snapshot.formValues.ipMonitorEnabled, false);
  assert.equal(snapshot.formValues.checkInterval, 12);
  assert.equal(snapshot.formValues.confirmCount, 4);
  assert.deepEqual(snapshot.formValues.checkSources, ['cip.cc']);
  assert.equal(snapshot.formValues.autoUpdateEnabled, true);
  assert.deepEqual(snapshot.formValues.selectedDevices, ['device-1']);
  assert.equal(snapshot.emailNotifyEnabled, true);
  assert.equal(snapshot.wechatNotifyEnabled, true);
  assert.equal(snapshot.wechatType, 'webhook');
});

test('buildAutomationFormSnapshot lets the dedicated email config override smtp reset fields', () => {
  const snapshot = buildAutomationFormSnapshot({
    automationConfig: {
      emailNotifyEnabled: false,
      smtpServer: 'old.example.com',
      recipientEmails: 'old@example.com',
    },
    emailConfig: {
      enabled: true,
      host: 'smtp.example.com',
      port: 587,
      auth: {
        user: 'bot@example.com',
        pass: 'secret',
      },
      from: {
        address: 'bot@example.com',
        name: 'Bot',
      },
      to: ['ops@example.com', 'admin@example.com'],
      notifyTypes: ['updateFailed'],
    },
  });

  assert.equal(snapshot.emailNotifyEnabled, true);
  assert.equal(snapshot.formValues.smtpServer, 'smtp.example.com');
  assert.equal(snapshot.formValues.smtpPort, '587');
  assert.equal(snapshot.formValues.smtpUsername, 'bot@example.com');
  assert.equal(snapshot.formValues.smtpPassword, 'secret');
  assert.equal(snapshot.formValues.senderEmail, 'bot@example.com');
  assert.equal(snapshot.formValues.senderName, 'Bot');
  assert.equal(snapshot.formValues.recipientEmails, 'ops@example.com, admin@example.com');
  assert.deepEqual(snapshot.formValues.emailNotifyTypes, ['updateFailed']);
});

test('buildAutomationFormSnapshot infers smtpEncryption from stored email transport flags', () => {
  const startTlsSnapshot = buildAutomationFormSnapshot({
    emailConfig: {
      enabled: true,
      host: 'smtp.example.com',
      port: 587,
      requireTLS: true,
    },
  });

  assert.equal(startTlsSnapshot.formValues.smtpEncryption, 'starttls');

  const plainSnapshot = buildAutomationFormSnapshot({
    emailConfig: {
      enabled: true,
      host: 'smtp.example.com',
      port: 25,
      ignoreTLS: true,
    },
  });

  assert.equal(plainSnapshot.formValues.smtpEncryption, 'none');
});

test('createAutomationFormSnapshot normalizes reset-safe defaults', () => {
  const snapshot = createAutomationFormSnapshot(
    {
      checkSources: ['not-supported'],
      selectedDevices: undefined,
      notifyTypes: undefined,
    },
    {
      emailNotifyEnabled: false,
      wechatNotifyEnabled: false,
      wechatType: 'work',
    }
  );

  assert.deepEqual(snapshot.formValues.checkSources, ['ipip', 'ddnspod', 'pconline']);
  assert.deepEqual(snapshot.formValues.selectedDevices, []);
  assert.deepEqual(snapshot.formValues.notifyTypes, ['ipChange', 'updateSuccess', 'updateFailed']);
});
