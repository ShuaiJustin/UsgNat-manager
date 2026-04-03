export interface WindowVisibilityController {
  isVisible: () => boolean;
  show: () => void;
  isMinimized: () => boolean;
  restore: () => void;
  focus: () => void;
}

export function revealMainWindow(window: WindowVisibilityController): void {
  if (window.isMinimized()) {
    window.restore();
  }

  if (!window.isVisible()) {
    window.show();
  }

  window.focus();
}
