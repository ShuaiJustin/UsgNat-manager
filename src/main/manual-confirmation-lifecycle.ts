import type { EventEmitter } from 'node:events';

import type {
  ManualConfirmationRequest,
  ManualConfirmationManager,
  ManualConfirmationResolver,
} from './manual-confirmation';
import type { MandatoryUpdateBusinessGate } from './services/mandatory-update-business-gate';

type ManualConfirmationEventPayload = {
  newIP: string;
  deviceCount: number;
  callback: ManualConfirmationResolver;
};

type ManualConfirmationLifecycleOptions = {
  automationEvents: Pick<EventEmitter, 'on'>;
  gate: MandatoryUpdateBusinessGate;
  manager: ManualConfirmationManager;
  notifyRequest: (request: ManualConfirmationRequest) => void;
  notifyCancelled: () => void;
};

export const registerManualConfirmationLifecycle = ({
  automationEvents,
  gate,
  manager,
  notifyRequest,
  notifyCancelled,
}: ManualConfirmationLifecycleOptions): void => {
  const clearPending = () => {
    if (manager.clear(false)) {
      notifyCancelled();
    }
  };

  automationEvents.on('manual-confirm-request', (data: ManualConfirmationEventPayload) => {
    if (gate.isBlocked()) {
      data.callback(false, 'cancelled');
      return;
    }

    notifyRequest(
      manager.start(
        {
          newIP: data.newIP,
          deviceCount: data.deviceCount,
        },
        data.callback
      )
    );
  });

  gate.onBlocked(clearPending);
  automationEvents.on('stopped', clearPending);
};
