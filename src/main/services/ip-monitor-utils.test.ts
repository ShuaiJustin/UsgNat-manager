import assert from 'node:assert/strict';
import test from 'node:test';

import { extractIPv4, isValidIPv4, selectMostCommonIP } from './ip-monitor-utils.ts';

test('extracts IPv4 addresses from verbose provider responses', () => {
  assert.equal(extractIPv4('当前 IP：123.45.67.89 来自上海'), '123.45.67.89');
  assert.equal(extractIPv4(' 98.76.54.32 '), '98.76.54.32');
});

test('validates IPv4 strings by octet range and shape', () => {
  assert.equal(isValidIPv4('192.168.1.1'), true);
  assert.equal(isValidIPv4('256.168.1.1'), false);
  assert.equal(isValidIPv4('not-an-ip'), false);
});

test('returns the most common IP and keeps first seen IP on ties', () => {
  assert.equal(selectMostCommonIP(['1.1.1.1', '2.2.2.2', '2.2.2.2']), '2.2.2.2');
  assert.equal(selectMostCommonIP(['3.3.3.3', '4.4.4.4']), '3.3.3.3');
});
