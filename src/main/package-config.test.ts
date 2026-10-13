import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(
  fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')
);

test('windows thumbnail cache files are excluded from packaged artifacts', () => {
  assert.ok(
    packageJson.build.files.includes('!**/Thumbs.db'),
    'package build.files must exclude Thumbs.db files'
  );
});

test('postinstall prepares the local Electron distribution required by packaging', () => {
  assert.equal(packageJson.build.electronDist, 'node_modules/electron/dist');
  assert.match(packageJson.scripts.postinstall, /(?:^|&&\s*)install-electron(?:\s|$)/);
});
