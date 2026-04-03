import assert from 'node:assert/strict';
import test from 'node:test';

import { revealMainWindow } from './window-visibility.ts';

const createWindowStub = (options?: { visible?: boolean; minimized?: boolean }) => {
  const calls: string[] = [];
  let visible = options?.visible ?? false;
  let minimized = options?.minimized ?? false;

  return {
    calls,
    window: {
      isVisible: () => visible,
      show: () => {
        calls.push('show');
        visible = true;
      },
      isMinimized: () => minimized,
      restore: () => {
        calls.push('restore');
        minimized = false;
      },
      focus: () => {
        calls.push('focus');
      },
    },
  };
};

test('reveals a hidden window before focusing it', () => {
  const stub = createWindowStub({ visible: false, minimized: false });

  revealMainWindow(stub.window);

  assert.deepEqual(stub.calls, ['show', 'focus']);
});

test('restores a minimized window before focusing it', () => {
  const stub = createWindowStub({ visible: true, minimized: true });

  revealMainWindow(stub.window);

  assert.deepEqual(stub.calls, ['restore', 'focus']);
});
