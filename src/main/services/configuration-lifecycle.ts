type LifecycleOptions = {
  gate: {
    block: (reason: string) => void;
    unblock: (reason: string) => void;
    waitForIdle: () => Promise<void>;
  };
  stop: () => Promise<void>;
  beforeStop?: () => void;
  restoreAfterFailure?: () => Promise<void>;
  apply: (type?: string, duringMaintenance?: boolean) => Promise<void>;
  reportRestoreError: (error: unknown) => Promise<void>;
};

export class ConfigurationLifecycle {
  private maintaining = false;
  private inDataAction = false;
  private tail: Promise<void> = Promise.resolve();
  private options: LifecycleOptions;

  constructor(options: LifecycleOptions) {
    this.options = options;
  }

  isMaintaining(): boolean {
    return this.maintaining;
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action);
    this.tail = result.then(
      () => {},
      () => {}
    );
    return result;
  }

  apply(type?: string): Promise<void> {
    // Import/restore handlers already request a full apply inside their action. Fold it into final restoration.
    if (this.inDataAction) return Promise.resolve();
    return this.enqueue(() => this.options.apply(type, this.maintaining));
  }

  async runDataChange<T>(action: () => Promise<T>): Promise<T> {
    if (this.maintaining) throw new Error('已有数据维护操作正在执行');
    this.maintaining = true;
    this.options.gate.block('maintenance');
    try {
      // Wait outside the queue: admitted config saves may themselves be awaiting a queued apply.
      await this.options.gate.waitForIdle();
      return await this.enqueue(async () => {
        let value: T | undefined;
        let actionFailed = false;
        let originalError: unknown;
        try {
          this.options.beforeStop?.();
          await this.options.stop();
          this.inDataAction = true;
          value = await action();
        } catch (error) {
          actionFailed = true;
          originalError = error;
        } finally {
          this.inDataAction = false;
        }
        try {
          if (actionFailed && this.options.restoreAfterFailure)
            await this.options.restoreAfterFailure();
          else await this.options.apply('all', true);
        } catch (error) {
          try {
            await this.options.reportRestoreError(error);
          } catch {
            /* Logging must not hide either failure. */
          }
          if (!actionFailed) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`数据已写入，但运行服务恢复失败：${message}`);
          }
        }
        if (actionFailed) throw originalError;
        return value as T;
      });
    } finally {
      this.maintaining = false;
      this.options.gate.unblock('maintenance');
    }
  }
}
