export class MandatoryUpdateBusinessGate {
  private readonly blockedReasons = new Set<string>();
  private activeOperations = 0;
  private readonly blockedCallbacks = new Set<() => void>();
  private readonly idleResolvers = new Set<() => void>();

  block(reason = 'mandatory'): void {
    if (this.blockedReasons.has(reason)) {
      return;
    }

    const wasBlocked = this.isBlocked();
    this.blockedReasons.add(reason);
    if (wasBlocked) return;
    for (const callback of this.blockedCallbacks) {
      try {
        callback();
      } catch (error) {
        console.error('强制更新门禁回调失败:', error);
      }
    }
  }

  unblock(reason = 'mandatory'): void {
    this.blockedReasons.delete(reason);
  }

  isBlocked(reason?: string): boolean {
    return reason ? this.blockedReasons.has(reason) : this.blockedReasons.size > 0;
  }

  tryEnter(): (() => void) | null {
    if (this.isBlocked()) {
      return null;
    }

    this.activeOperations += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.activeOperations -= 1;
      if (this.activeOperations === 0) {
        for (const resolve of this.idleResolvers) {
          resolve();
        }
        this.idleResolvers.clear();
      }
    };
  }

  waitForIdle(): Promise<void> {
    if (this.activeOperations === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.idleResolvers.add(resolve);
    });
  }

  onBlocked(callback: () => void): () => void {
    this.blockedCallbacks.add(callback);
    return () => this.blockedCallbacks.delete(callback);
  }
}

export const mandatoryUpdateBusinessGate = new MandatoryUpdateBusinessGate();
