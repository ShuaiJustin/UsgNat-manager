import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAutomationEmailConfig,
  buildAutomationTestEmailConfig,
} from './automationNotification.ts';

test('builds persisted automation email config with defaults and normalized recipients', () => {
  const config = buildAutomationEmailConfig(
    {
      smtpServer: 'smtp.example.com',
      smtpPort: '465',
      smtpEncryption: 'ssl',
      smtpUsername: 'alerts@example.com',
      smtpPassword: 'secret',
      senderEmail: 'noreply@example.com',
      recipientEmails: ' admin@example.com, ops@example.com ',
      emailNotifyTypes: ['ipChange'],
    },
    true
  );

  assert.deepEqual(config, {
    enabled: true,
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    auth: {
      user: 'alerts@example.com',
      pass: 'secret',
    },
    from: {
      name: 'USG NAT管理系统',
      address: 'noreply@example.com',
    },
    to: ['admin@example.com', 'ops@example.com'],
    notifyTypes: ['ipChange'],
  });
});

test('builds persisted automation email config with explicit STARTTLS and plain-text modes', () => {
  const startTlsConfig = buildAutomationEmailConfig(
    {
      smtpServer: 'smtp.example.com',
      smtpPort: '587',
      smtpEncryption: 'starttls',
      smtpUsername: 'alerts@example.com',
      smtpPassword: 'secret',
      senderEmail: 'noreply@example.com',
      recipientEmails: 'admin@example.com',
    },
    true
  );

  assert.equal(startTlsConfig.secure, false);
  assert.equal(startTlsConfig.requireTLS, true);
  assert.equal(startTlsConfig.ignoreTLS, undefined);

  const plainConfig = buildAutomationEmailConfig(
    {
      smtpServer: 'smtp.example.com',
      smtpPort: '25',
      smtpEncryption: 'none',
      smtpUsername: 'alerts@example.com',
      smtpPassword: 'secret',
      senderEmail: 'noreply@example.com',
      recipientEmails: 'admin@example.com',
    },
    true
  );

  assert.equal(plainConfig.secure, false);
  assert.equal(plainConfig.requireTLS, undefined);
  assert.equal(plainConfig.ignoreTLS, true);
});

test('builds test email config only when required fields and recipients are present', () => {
  const config = buildAutomationTestEmailConfig({
    smtpServer: ' smtp.example.com ',
    smtpPort: '587',
    smtpEncryption: 'starttls',
    smtpUsername: ' alerts@example.com ',
    smtpPassword: 'secret',
    senderEmail: ' noreply@example.com ',
    senderName: ' Ops ',
    recipientEmails: 'bad-value, admin@example.com, ops@example.com ',
  });

  assert.deepEqual(config, {
    enabled: true,
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: 'alerts@example.com',
      pass: 'secret',
    },
    from: {
      name: 'Ops',
      address: 'noreply@example.com',
    },
    to: ['admin@example.com', 'ops@example.com'],
  });
});

test('returns null for incomplete or invalid test email config inputs', () => {
  assert.equal(
    buildAutomationTestEmailConfig({
      smtpServer: 'smtp.example.com',
      smtpUsername: 'alerts@example.com',
      smtpPassword: 'secret',
      senderEmail: 'noreply@example.com',
      recipientEmails: 'invalid-recipient',
    }),
    null
  );

  assert.equal(
    buildAutomationTestEmailConfig({
      smtpServer: '',
      smtpUsername: 'alerts@example.com',
      smtpPassword: 'secret',
      senderEmail: 'noreply@example.com',
      recipientEmails: 'admin@example.com',
    }),
    null
  );
});

test('recipients accept common separators and report malformed addresses', async () => {
  const { findInvalidRecipients, normalizeRecipients } = await import(
    './automationNotification.ts'
  );
  assert.deepEqual(normalizeRecipients('a@x.com，b@y.cn; c@z.org  d@w.net'), [
    'a@x.com',
    'b@y.cn',
    'c@z.org',
    'd@w.net',
  ]);
  assert.deepEqual(findInvalidRecipients('a@x.com, admin, b@y'), ['admin', 'b@y']);
});

test('well-known SMTP ports pick their encryption', async () => {
  const { getEncryptionForPort } = await import('./automationNotification.ts');
  assert.equal(getEncryptionForPort('465'), 'ssl');
  assert.equal(getEncryptionForPort('587'), 'starttls');
  assert.equal(getEncryptionForPort('2525'), undefined);
});

test('SMTP port input is validated and odd port/encryption pairs are flagged', async () => {
  const { isValidSmtpPort, getPortEncryptionMismatch } = await import(
    './automationNotification.ts'
  );
  assert.equal(isValidSmtpPort('465'), true);
  assert.equal(isValidSmtpPort('4e2'), false);
  assert.equal(isValidSmtpPort('0x1F'), false);
  assert.equal(isValidSmtpPort('70000'), false);
  assert.match(getPortEncryptionMismatch('587', 'ssl') ?? '', /STARTTLS/);
  assert.match(getPortEncryptionMismatch('465', 'starttls') ?? '', /SSL/);
  assert.equal(getPortEncryptionMismatch('465', 'ssl'), null);
  assert.equal(getPortEncryptionMismatch('2525', 'ssl'), null);
});

test('documentation example hosts are rejected as SMTP servers', async () => {
  const { isPlaceholderSmtpHost } = await import('./automationNotification.ts');
  assert.equal(isPlaceholderSmtpHost('smtp.example.com'), true);
  assert.equal(isPlaceholderSmtpHost('smtp.qq.com'), false);
  assert.equal(isPlaceholderSmtpHost('mail.myexample.com'), false);
});
