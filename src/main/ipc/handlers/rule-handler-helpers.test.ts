import assert from 'node:assert/strict';
import test from 'node:test';

import { assertBatchUpdateIPInput, getRuleIdsOutsideDevice } from './rule-handler-helpers.ts';

test('rejects invalid IPv4 values for batch rule IP updates', () => {
  assert.throws(
    () =>
      assertBatchUpdateIPInput({
        deviceId: 'device-1',
        ruleIds: ['rule-1'],
        newIP: '999.1.1.1',
      }),
    /IP/
  );
});

test('rejects empty rule selections for batch rule IP updates', () => {
  assert.throws(
    () =>
      assertBatchUpdateIPInput({
        deviceId: 'device-1',
        ruleIds: [],
        newIP: '1.2.3.4',
      }),
    /rule/
  );
});

test('identifies selected rules that do not belong to the requested device', () => {
  assert.deepEqual(
    getRuleIdsOutsideDevice(
      [
        { id: 'rule-1', deviceId: 'device-1' },
        { id: 'rule-2', deviceId: 'device-2' },
      ],
      'device-1'
    ),
    ['rule-2']
  );
});
