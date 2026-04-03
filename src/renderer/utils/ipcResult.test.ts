import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureIpcSuccess } from './ipcResult.ts';

test('returns successful IPC results unchanged', () => {
  const result = { success: true, value: 42 };

  assert.equal(ensureIpcSuccess(result, 'fallback message'), result);
});

test('throws the fallback message when the IPC result has no useful error text', () => {
  assert.throws(() => ensureIpcSuccess({ success: false }, 'fallback message'), /fallback message/);
});

test('prefers result error text over the fallback message', () => {
  assert.throws(
    () =>
      ensureIpcSuccess({ success: false, error: 'server rejected request' }, 'fallback message'),
    /server rejected request/
  );
});
