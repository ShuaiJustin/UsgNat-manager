import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAutomationFormSnapshot,
  createAutomationFormSnapshot,
} from './automationFormState.ts';

test('buildAutomationFormSnapshot keeps stored automation values for later reset', () => {
  const snapshot = buildAutomationFormSnapshot({
    automationConfig: {
      ipMonitorEnabled: false,
      checkInterval: 12,
      confirmCount: 4,
      checkSources: ['cip'],
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

  assert.deepEqual(snapshot.formValues.checkSources, ['cip.cc', 'ipip']);
  assert.deepEqual(snapshot.formValues.selectedDevices, []);
  assert.deepEqual(snapshot.formValues.notifyTypes, ['ipChange', 'updateSuccess', 'updateFailed']);
});
