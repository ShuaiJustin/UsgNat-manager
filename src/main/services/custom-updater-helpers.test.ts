import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLatestVersionApiUrl,
  createSetupInstallerFileName,
  getUpdateCheckIntervalMs,
  resolveUpdateAssetUrl,
  compareVersions,
} from './custom-updater-helpers.ts';

test('compareVersions orders semantic version strings', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.2.0', '1.10.0'), -1);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
});

test('getUpdateCheckIntervalMs supports known frequencies and defaults to daily', () => {
  assert.equal(getUpdateCheckIntervalMs('daily'), 24 * 60 * 60 * 1000);
  assert.equal(getUpdateCheckIntervalMs('weekly'), 7 * 24 * 60 * 60 * 1000);
  assert.equal(getUpdateCheckIntervalMs('unexpected'), 24 * 60 * 60 * 1000);
});

test('buildLatestVersionApiUrl appends the latest-version endpoint', () => {
  assert.equal(
    buildLatestVersionApiUrl('http://updates.example.com'),
    'http://updates.example.com/api/versions/latest'
  );
  assert.equal(
    buildLatestVersionApiUrl('https://updates.example.com/base/'),
    'https://updates.example.com/base/api/versions/latest'
  );
});

test('resolveUpdateAssetUrl keeps absolute URLs and resolves relative URLs against the server', () => {
  assert.equal(
    resolveUpdateAssetUrl('https://cdn.example.com/setup.exe', 'http://updates.example.com'),
    'https://cdn.example.com/setup.exe'
  );
  assert.equal(
    resolveUpdateAssetUrl('/downloads/setup.exe', 'http://updates.example.com'),
    'http://updates.example.com/downloads/setup.exe'
  );
  assert.equal(
    resolveUpdateAssetUrl('downloads/setup.exe', 'https://updates.example.com/base/'),
    'https://updates.example.com/base/downloads/setup.exe'
  );
});

test('createSetupInstallerFileName uses the expected installer naming pattern', () => {
  assert.equal(createSetupInstallerFileName('1.2.3'), 'USG-NAT-Manager-Setup-1.2.3.exe');
});
