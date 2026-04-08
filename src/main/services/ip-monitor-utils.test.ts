import assert from 'node:assert/strict';
import test from 'node:test';

import * as ipMonitorUtils from './ip-monitor-utils.ts';

const { extractIPv4, isValidIPv4, selectMostCommonIP } = ipMonitorUtils;

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

test('classifies single-source failures as warnings and only treats full exhaustion as errors', () => {
  assert.equal(typeof ipMonitorUtils.getSourceFailureLogLevel, 'function');
  assert.equal(ipMonitorUtils.getSourceFailureLogLevel?.(false), 'WARNING');
  assert.equal(ipMonitorUtils.getSourceFailureLogLevel?.(true), 'ERROR');
});

test('detects when source results have already reached a reliable consensus', () => {
  assert.equal(typeof ipMonitorUtils.hasReachedIPConsensus, 'function');
  assert.equal(ipMonitorUtils.hasReachedIPConsensus?.([]), false);
  assert.equal(ipMonitorUtils.hasReachedIPConsensus?.(['1.1.1.1']), false);
  assert.equal(ipMonitorUtils.hasReachedIPConsensus?.(['1.1.1.1', '2.2.2.2']), false);
  assert.equal(ipMonitorUtils.hasReachedIPConsensus?.(['1.1.1.1', '1.1.1.1']), true);
  assert.equal(ipMonitorUtils.hasReachedIPConsensus?.(['1.1.1.1', '2.2.2.2', '1.1.1.1']), true);
});
