import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

type DestroyableModal = { destroy: () => void };
type ActiveModal = { current: DestroyableModal | null };

const loadDialogState = async () => {
  const helperPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'update-dialog-state.ts'
  );
  assert.equal(fs.existsSync(helperPath), true, 'missing updater dialog state helper');
  return import('./update-dialog-state.ts') as Promise<{
    replaceActiveUpdaterModal: (
      activeModal: ActiveModal,
      createModal: () => DestroyableModal
    ) => void;
    clearActiveUpdaterModal: (activeModal: ActiveModal) => void;
    assertUpdaterActionSucceeded: (
      result: { success?: boolean; message?: string } | undefined,
      fallbackMessage: string
    ) => void;
    isClearUpdateDialogMessage: (message: { event?: string }) => boolean;
  }>;
};

test('each updater state replaces the previous modal and cleanup destroys the last one', async () => {
  const { clearActiveUpdaterModal, replaceActiveUpdaterModal } = await loadDialogState();
  const activeModal: ActiveModal = { current: null };
  const destroyed: string[] = [];

  replaceActiveUpdaterModal(activeModal, () => ({ destroy: () => destroyed.push('available') }));
  replaceActiveUpdaterModal(activeModal, () => ({ destroy: () => destroyed.push('downloading') }));
  replaceActiveUpdaterModal(activeModal, () => ({ destroy: () => destroyed.push('downloaded') }));
  clearActiveUpdaterModal(activeModal);

  assert.deepEqual(destroyed, ['available', 'downloading', 'downloaded']);
  assert.equal(activeModal.current, null);
});

test('mandatory updater actions reject unsuccessful IPC results so Ant Modal stays open', async () => {
  const { assertUpdaterActionSucceeded } = await loadDialogState();

  assert.doesNotThrow(() => assertUpdaterActionSucceeded({ success: true }, '下载失败'));
  assert.throws(
    () => assertUpdaterActionSucceeded({ success: false, message: 'disk full' }, '下载失败'),
    /disk full/
  );
  assert.throws(() => assertUpdaterActionSucceeded(undefined, '下载失败'), /下载失败/);
});

test('a clear state closes a stale mandatory updater modal', async () => {
  const { clearActiveUpdaterModal, isClearUpdateDialogMessage } = await loadDialogState();
  const destroyed: string[] = [];
  const activeModal: ActiveModal = {
    current: { destroy: () => destroyed.push('mandatory') },
  };

  assert.equal(isClearUpdateDialogMessage({ event: 'clear-update-dialog' }), true);
  assert.equal(isClearUpdateDialogMessage({ event: 'update-not-available' }), false);
  clearActiveUpdaterModal(activeModal);

  assert.deepEqual(destroyed, ['mandatory']);
  assert.equal(activeModal.current, null);
});
