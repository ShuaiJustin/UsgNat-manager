import { randomUUID } from 'crypto';

export interface ManualConfirmationRequest {
  requestId: string;
  newIP: string;
  deviceCount: number;
  expiresAt: number;
}

interface PendingManualConfirmation extends ManualConfirmationRequest {
  resolve: (confirmed: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface StartManualConfirmationOptions {
  newIP: string;
  deviceCount: number;
  timeoutMs?: number;
  onExpired?: (request: ManualConfirmationRequest) => void;
}

export class ManualConfirmationManager {
  private pending: PendingManualConfirmation | null = null;

  start(
    options: StartManualConfirmationOptions,
    resolve: (confirmed: boolean) => void
  ): ManualConfirmationRequest {
    this.clear(false);

    const timeoutMs = options.timeoutMs ?? 30000;
    const request: ManualConfirmationRequest = {
      requestId: randomUUID(),
      newIP: options.newIP,
      deviceCount: options.deviceCount,
      expiresAt: Date.now() + timeoutMs,
    };

    const timeout = setTimeout(() => {
      if (!this.pending || this.pending.requestId !== request.requestId) {
        return;
      }

      this.pending.resolve(false);
      this.pending = null;
      options.onExpired?.(request);
    }, timeoutMs);

    this.pending = {
      ...request,
      resolve,
      timeout,
    };

    return request;
  }

  respond(requestId: string, confirmed: boolean): boolean {
    if (!this.pending || this.pending.requestId !== requestId) {
      return false;
    }

    clearTimeout(this.pending.timeout);
    const { resolve } = this.pending;
    this.pending = null;
    resolve(confirmed);
    return true;
  }

  getPending(): ManualConfirmationRequest | null {
    if (!this.pending) {
      return null;
    }

    return {
      requestId: this.pending.requestId,
      newIP: this.pending.newIP,
      deviceCount: this.pending.deviceCount,
      expiresAt: this.pending.expiresAt,
    };
  }

  clear(confirmed: boolean): boolean {
    if (!this.pending) {
      return false;
    }

    clearTimeout(this.pending.timeout);
    const { resolve } = this.pending;
    this.pending = null;
    resolve(confirmed);
    return true;
  }
}
