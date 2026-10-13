import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { isAllowedAppNavigation } from './window-navigation.ts';

const appIndexUrl = pathToFileURL('C:/Program Files/USG/resources/app/renderer/index.html').href;

test('production only allows the packaged renderer page', () => {
  assert.equal(isAllowedAppNavigation(`${appIndexUrl}#/devices`, false, appIndexUrl), true);
  assert.equal(isAllowedAppNavigation('http://localhost:5174/', false, appIndexUrl), false);
  assert.equal(isAllowedAppNavigation('https://example.com/', false, appIndexUrl), false);
  assert.equal(
    isAllowedAppNavigation(pathToFileURL('C:/Windows/evil.html').href, false, appIndexUrl),
    false
  );
  assert.equal(isAllowedAppNavigation('not a url', false, appIndexUrl), false);
});

test('development only allows the local Vite dev server', () => {
  assert.equal(isAllowedAppNavigation('http://localhost:5174/#/logs', true, appIndexUrl), true);
  assert.equal(isAllowedAppNavigation('http://localhost:5175/', true, appIndexUrl), false);
  assert.equal(isAllowedAppNavigation('https://example.com/', true, appIndexUrl), false);
});
