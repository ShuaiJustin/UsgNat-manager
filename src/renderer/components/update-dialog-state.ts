export type DestroyableUpdaterModal = {
  destroy: () => void;
};

export type ActiveUpdaterModal = {
  current: DestroyableUpdaterModal | null;
};

export const replaceActiveUpdaterModal = (
  activeModal: ActiveUpdaterModal,
  createModal: () => DestroyableUpdaterModal
): void => {
  activeModal.current?.destroy();
  activeModal.current = createModal();
};

export const clearActiveUpdaterModal = (activeModal: ActiveUpdaterModal): void => {
  activeModal.current?.destroy();
  activeModal.current = null;
};

export const assertUpdaterActionSucceeded = (
  result: { success?: boolean; message?: string } | undefined,
  fallbackMessage: string
): void => {
  if (result?.success !== true) {
    throw new Error(result?.message || fallbackMessage);
  }
};

export const isClearUpdateDialogMessage = (message: { event?: string }): boolean =>
  message.event === 'clear-update-dialog';
