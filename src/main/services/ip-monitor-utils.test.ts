import assert from 'node:assert/strict';
import test from 'node:test';

import * as ipMonitorUtils from './ip-monitor-utils.ts';

const {
  extractIPv4,
  isGlobalUnicastIPv4,
  isValidIPv4,
  recordIPChangeCandidate,
  redactURLCredentials,
  selectConsensusIP,
  selectMostCommonIP,
} = ipMonitorUtils;

test('extracts IPv4 addresses from verbose provider responses', () => {
  assert.equal(extractIPv4('当前 IP：123.45.67.89 来自上海'), '123.45.67.89');
  assert.equal(extractIPv4(' 98.76.54.32 '), '98.76.54.32');
});

test('validates IPv4 strings by octet range and shape', () => {
  assert.equal(isValidIPv4('192.168.1.1'), true);
  assert.equal(isValidIPv4('256.168.1.1'), false);
  assert.equal(isValidIPv4('not-an-ip'), false);
});

test('extraction ignores longer numeric tokens and leading-zero octets', () => {
  assert.equal(extractIPv4('1.2.3.4567'), '1.2.3.4567');
  assert.equal(extractIPv4('ver 11.2.3.4.5 ip 8.8.8.8.'), '8.8.8.8');
  assert.equal(extractIPv4('ip 01.2.3.4 or 9.9.9.9'), '9.9.9.9');
  assert.equal(isValidIPv4('1.02.3.4'), false);
  assert.equal(isValidIPv4('0.0.0.0'), true);
});

test('accepts only global unicast IPv4 as a public egress address', () => {
  for (const ip of [
    '8.8.8.8',
    '1.1.1.1',
    '100.63.255.255',
    '100.128.0.1',
    '172.32.0.1',
    '223.255.255.254',
  ]) {
    assert.equal(isGlobalUnicastIPv4(ip), true, ip);
  }
  for (const ip of [
    '0.1.2.3',
    '10.0.0.1',
    '100.64.0.1',
    '100.127.255.255',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.255',
    '224.0.0.1',
    '239.1.1.1',
    '240.0.0.1',
    '255.255.255.255',
    '08.8.8.8',
    '1.2.3.4567',
    'not-an-ip',
  ]) {
    assert.equal(isGlobalUnicastIPv4(ip), false, ip);
  }
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

test('selects an IP only when the configured consensus threshold is met', () => {
  assert.equal(selectConsensusIP(['1.1.1.1'], 1), '1.1.1.1');
  assert.equal(selectConsensusIP(['1.1.1.1', '1.1.1.1'], 2), '1.1.1.1');
  assert.equal(selectConsensusIP(['1.1.1.1', '2.2.2.2'], 2), '');
});

test('requires IP change confirmations to be consecutive for the same candidate', () => {
  const confirmations = new Map<string, number>();

  assert.deepEqual(recordIPChangeCandidate(confirmations, '1.1.1.1', '2.2.2.2', 2), {
    confirmCount: 1,
    confirmed: false,
  });
  assert.deepEqual(recordIPChangeCandidate(confirmations, '1.1.1.1', '1.1.1.1', 2), {
    confirmCount: 0,
    confirmed: false,
  });
  assert.deepEqual(recordIPChangeCandidate(confirmations, '1.1.1.1', '2.2.2.2', 2), {
    confirmCount: 1,
    confirmed: false,
  });
  assert.deepEqual(recordIPChangeCandidate(confirmations, '1.1.1.1', '3.3.3.3', 2), {
    confirmCount: 1,
    confirmed: false,
  });
  assert.deepEqual(recordIPChangeCandidate(confirmations, '1.1.1.1', '3.3.3.3', 2), {
    confirmCount: 2,
    confirmed: true,
  });
});

test('redacts credentials from proxy URLs before logging', () => {
  assert.equal(
    redactURLCredentials('http://user:secret@proxy.example.com:8080'),
    'http://***:***@proxy.example.com:8080'
  );
  assert.equal(redactURLCredentials('https://proxy.example.com'), 'https://proxy.example.com');
  assert.equal(redactURLCredentials('not a url'), 'not a url');
});

test('keeps source-level retry diagnostics out of the persisted warning list', () => {
  assert.equal(typeof ipMonitorUtils.getIPSourceDiagnosticLogOptions, 'function');
  assert.deepEqual(ipMonitorUtils.getIPSourceDiagnosticLogOptions?.(), {
    persistToDatabase: false,
  });
});
