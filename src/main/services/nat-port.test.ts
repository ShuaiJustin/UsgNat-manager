import assert from 'node:assert/strict';
import test from 'node:test';
import { natPortCommand, natPortsOverlap, parseNatPort } from './nat-port.ts';

test('port validation used by the editor and command guard accepts only canonical safe values', () => {
  assert.deepEqual(parseNatPort('80'), [80, 80]);
  assert.deepEqual(parseNatPort('1-65535'), [1, 65535]);
  for (const value of [
    undefined,
    null,
    80,
    '',
    '0',
    '65536',
    '080',
    '90-80',
    '80-80',
    '80 90',
    '80.5',
    '8e1',
    '80-65536',
    '80\n',
    '80\nsave',
  ]) {
    assert.equal(parseNatPort(value), null, JSON.stringify(value));
  }
  assert.equal(natPortCommand('20000-20053'), '20000 20053');
  assert.equal(natPortCommand('80'), '80');
  assert.equal(natPortsOverlap('80-90', '90'), true);
  assert.equal(natPortsOverlap('80-90', '91-100'), false);
});
