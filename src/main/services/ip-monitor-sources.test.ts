import assert from 'node:assert/strict';
import test from 'node:test';

import { createIPCheckSources } from './ip-monitor-sources.ts';

test('builds the expected source catalog for IP monitor checks', () => {
  const sources = createIPCheckSources();

  assert.deepEqual(Array.from(sources.keys()), [
    'ip.sb',
    'icanhazip',
    'ipinfo',
    'ifconfig',
    'ipify',
    'ipip',
    'ddnspod',
    'pconline',
    'cip.cc',
  ]);
});

test('uses IPv4 extraction parsers for verbose domestic sources', () => {
  const sources = createIPCheckSources();
  const ipip = sources.get('ipip');
  const ddnspod = sources.get('ddnspod');
  const pconline = sources.get('pconline');
  const cip = sources.get('cip.cc');

  assert.ok(ipip);
  assert.ok(ddnspod);
  assert.ok(pconline);
  assert.ok(cip);
  assert.equal(ipip?.parser('当前 IP：123.45.67.89 来自杭州'), '123.45.67.89');
  assert.equal(ddnspod?.parser(' 98.76.54.32 '), '98.76.54.32');
  assert.equal(pconline?.parser('{"ip":"98.76.54.32","city":"上海"}'), '98.76.54.32');
  assert.equal(cip?.parser('IP\t: 98.76.54.32\n地址\t: 浙江'), '98.76.54.32');
});

test('verbose source parsers do not truncate longer numeric tokens', () => {
  const ipip = createIPCheckSources().get('ipip');
  assert.equal(ipip?.parser('当前 IP：1.2.3.4567'), '当前 IP：1.2.3.4567');
  assert.equal(ipip?.parser('v1.2.3.4.5 IP：98.76.54.32。'), '98.76.54.32');
});
