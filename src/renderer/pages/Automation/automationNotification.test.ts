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

test('builds test email config only when required fields and recipients are present', () => {
  const config = buildAutomationTestEmailConfig({
    smtpServer: ' smtp.example.com ',
    smtpPort: '587',
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
