import { ManualConfirmationManager } from '../manual-confirmation';
import { registerAutomationHandlers } from './handlers/automation-handlers';
import { registerConfigHandlers } from './handlers/config-handlers';
import { registerDeviceHandlers } from './handlers/device-handlers';
import { registerMonitorHandlers } from './handlers/monitor-handlers';
import { registerRuleHandlers } from './handlers/rule-handlers';
import { registerSystemHandlers } from './handlers/system-handlers';

export function registerIpcHandlers(options?: Parameters<typeof registerConfigHandlers>[0]) {
  const manualConfirmationManager = new ManualConfirmationManager();

  registerDeviceHandlers();
  registerRuleHandlers();
  registerMonitorHandlers();
  registerAutomationHandlers(manualConfirmationManager);
  registerConfigHandlers(options);
  registerSystemHandlers(options);
}
