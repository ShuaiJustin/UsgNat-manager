import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

type TrayMenuItem = {
  label?: string;
  type?: 'separator';
  click?: () => void;
};

type TrayMenuActions = {
  openMainWindow: () => void;
  openUpdate: () => void;
  startMonitor: () => void;
  stopMonitor: () => void;
  quitApp: () => void;
};

const loadTrayMenuBuilder = async () => {
  const helperPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tray-menu.ts');
  assert.equal(fs.existsSync(helperPath), true, 'missing tray menu state helper');
  return import('./tray-menu.ts') as Promise<{
    buildTrayMenuTemplate: (
      isMandatoryUpdateRequired: () => boolean,
      actions: TrayMenuActions
    ) => TrayMenuItem[];
  }>;
};

test('mandatory tray contains only the update entry and explicit exit', async () => {
  const { buildTrayMenuTemplate } = await loadTrayMenuBuilder();
  const actions: TrayMenuActions = {
    openMainWindow() {},
    openUpdate() {},
    startMonitor() {},
    stopMonitor() {},
    quitApp() {},
  };

  const labels = buildTrayMenuTemplate(() => true, actions)
    .map((item) => item.label)
    .filter(Boolean);

  assert.deepEqual(labels, ['打开更新', '退出程序']);
});

test('a stale normal tray menu rechecks the mandatory gate before starting work', async () => {
  const { buildTrayMenuTemplate } = await loadTrayMenuBuilder();
  let mandatory = false;
  const calls: string[] = [];
  const menu = buildTrayMenuTemplate(() => mandatory, {
    openMainWindow: () => calls.push('open-main'),
    openUpdate: () => calls.push('open-update'),
    startMonitor: () => calls.push('start-monitor'),
    stopMonitor: () => calls.push('stop-monitor'),
    quitApp: () => calls.push('quit'),
  });
  const startMonitor = menu.find((item) => item.label === '启动监控');

  mandatory = true;
  startMonitor?.click?.();

  assert.deepEqual(calls, ['open-update']);
});
