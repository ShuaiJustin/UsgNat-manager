import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_SETTINGS_FORM_VALUES, buildSettingsFormSnapshot } from './settingsFormState.ts';

test('buildSettingsFormSnapshot preserves user settings and forces truthful security capabilities', () => {
  const snapshot = buildSettingsFormSnapshot(
    {
      scale: '125',
      language: 'en-US',
      logRetentionDays: 7,
      useWindowsCredentials: false,
      encryptSensitiveData: false,
      requirePasswordOnStartup: true,
      logAllOperations: false,
      writeToWindowsEventLog: false,
    },
    false
  );

  assert.equal(snapshot.scale, '125');
  assert.equal(snapshot.language, 'en-US');
  assert.equal(snapshot.logRetentionDays, 7);
  assert.equal(snapshot.autoStart, false);
  assert.equal(snapshot.useWindowsCredentials, false);
  assert.equal(snapshot.encryptSensitiveData, true);
  assert.equal(snapshot.requirePasswordOnStartup, false);
  assert.equal(snapshot.logAllOperations, true);
  assert.equal(snapshot.writeToWindowsEventLog, false);
});

test('buildSettingsFormSnapshot falls back to the shared defaults when no saved values exist', () => {
  assert.deepEqual(buildSettingsFormSnapshot(null), DEFAULT_SETTINGS_FORM_VALUES);
});
