import { randomUUID } from 'crypto';

export interface ManualConfirmationRequest {
  requestId: string;
  newIP: string;
  deviceCount: number;
  expiresAt: number;
}

/** Why a request ended without an explicit user answer; absent means the user answered. */
export type ManualConfirmationEndReason = 'timeout' | 'cancelled';

export type ManualConfirmationResolver = (
  confirmed: boolean,
  reason?: ManualConfirmationEndReason
) => void;

interface PendingManualConfirmation extends ManualConfirmationRequest {
  resolve: ManualConfirmationResolver;
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
    resolve: ManualConfirmationResolver
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

      // A timeout is not a rejection: automation keeps the target pending and asks again later.
      this.pending.resolve(false, 'timeout');
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
    resolve(confirmed, confirmed ? undefined : 'cancelled');
    return true;
  }
}
