# Project Structure Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up the repository structure and split the most overloaded source files into clearer modules without changing application behavior.

**Architecture:** First reduce root-level clutter by moving non-runtime assets into clearer locations and updating all path references. Then turn the main IPC entry into a thin registrar with domain-specific handler modules. Finally split the largest renderer files into page-local helpers and smaller type exports while preserving existing APIs and flows.

**Tech Stack:** Electron, React, TypeScript, Vite, Prisma, ESLint

---

### Task 1: Normalize Root Structure And References

**Files:**
- Create: `D:\Coding Project\usg-nat-manager\USG1.0.7\docs\archive\custom-updater\README.md`
- Modify: `D:\Coding Project\usg-nat-manager\USG1.0.7\.gitignore`
- Modify: `D:\Coding Project\usg-nat-manager\USG1.0.7\README.md`
- Move: `D:\Coding Project\usg-nat-manager\USG1.0.7\Demo\index.html`
- Move: `D:\Coding Project\usg-nat-manager\USG1.0.7\Docs\test_api_server.py`
- Move: `D:\Coding Project\usg-nat-manager\USG1.0.7\generate-icon.js`
- Move: `D:\Coding Project\usg-nat-manager\USG1.0.7\USG Server Updates\Docs\**`

- [ ] **Step 1: Write the failing path audit**

```text
Expected root after cleanup:
- src/
- prisma/
- scripts/
- resources/
- docs/
- README.md
- package.json

Paths that should disappear from active root structure:
- Demo/
- USG Server Updates/
- top-level generate-icon.js
- utility scripts living under docs/
```

- [ ] **Step 2: Run the audit command and verify the old paths still exist**

Run: `Get-ChildItem -Force`
Expected: `Demo`, `Docs` or `docs`, `USG Server Updates`, and top-level `generate-icon.js` are still present.

- [ ] **Step 3: Apply the directory cleanup**

```text
Moves to perform:
- Demo/index.html -> docs/mockups/demo.html
- Docs/test_api_server.py -> scripts/dev/test_api_server.py
- generate-icon.js -> scripts/generate-icon.js
- USG Server Updates/Docs/* -> docs/archive/custom-updater/*

.gitignore updates:
- stop ignoring the entire docs tree
- ignore only archive/mockup payloads that should stay untracked, if any
- keep dist/release/node_modules ignored
```

- [ ] **Step 4: Update repository-facing references**

```markdown
README changes:
- replace `Docs/` references with `docs/`
- replace `Demo/` references with `docs/mockups/`
- update the project tree section so root reflects the cleaned layout

.gitignore comment cleanup:
- rewrite the ignored-directory comment so it matches the new intent
```

- [ ] **Step 5: Verify the cleanup**

Run: `rg -n -F "Docs/" README.md .gitignore scripts`
Expected: no stale active-project references remain unless they are intentional historical notes.

Run: `rg -n -F "Demo/" README.md .gitignore scripts`
Expected: no active-path references remain.

### Task 2: Split Main IPC Registration By Domain

**Files:**
- Create: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\main\ipc\handlers\shared.ts`
- Create: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\main\ipc\handlers\device-handlers.ts`
- Create: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\main\ipc\handlers\rule-handlers.ts`
- Create: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\main\ipc\handlers\monitor-handlers.ts`
- Create: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\main\ipc\handlers\automation-handlers.ts`
- Create: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\main\ipc\handlers\config-handlers.ts`
- Create: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\main\ipc\handlers\system-handlers.ts`
- Modify: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\main\ipc\index.ts`
- Test: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\main\window-visibility.test.ts`

- [ ] **Step 1: Write the failing structural expectation**

```typescript
// structural expectation
// registerIpcHandlers should become a thin coordinator that delegates to
// domain-specific registration functions instead of inlining every handler.
```

- [ ] **Step 2: Run a structural check before refactor**

Run: `rg -n "ipcMain\\.handle\\(" src/main/ipc/index.ts`
Expected: dozens of matches, proving the file is still overloaded.

- [ ] **Step 3: Extract shared guard helpers and the first domain modules**

```typescript
// shared.ts
export const assertSupportedConnectionType = (...) => { ... };
export const assertSupportedAuthType = (...) => { ... };
export const assertSupportedDeviceAccess = (...) => { ... };

// index.ts
export function registerIpcHandlers() {
  const manualConfirmationManager = new ManualConfirmationManager();
  registerDeviceHandlers();
  registerRuleHandlers();
  registerMonitorHandlers();
  registerAutomationHandlers(manualConfirmationManager);
  registerConfigHandlers();
  registerSystemHandlers();
}
```

- [ ] **Step 4: Move the remaining handler groups without changing channel names**

```typescript
// example shape
export const registerDeviceHandlers = () => {
  ipcMain.handle('device:getAll', async () => { ... });
  ipcMain.handle('device:getById', async (_event, id: string) => { ... });
};
```

- [ ] **Step 5: Verify the IPC refactor**

Run: `npm run type-check`
Expected: exit code 0.

Run: `npm run lint`
Expected: exit code 0 or only pre-existing warnings already known before the refactor.

### Task 3: Split Automation Page Into Page-Local Modules

**Files:**
- Create: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\renderer\pages\Automation\automation-form-defaults.ts`
- Create: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\renderer\pages\Automation\automation-time.ts`
- Create: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\renderer\pages\Automation\components\AutomationConfirmModal.tsx`
- Create: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\renderer\pages\Automation\components\AutomationMonitorSection.tsx`
- Create: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\renderer\pages\Automation\components\AutomationNotifySection.tsx`
- Modify: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\renderer\pages\Automation\index.tsx`
- Test: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\renderer\utils\automationConfig.test.ts`

- [ ] **Step 1: Write the failing behavior-preservation target**

```text
The Automation page must keep:
- the same IPC calls
- the same pending confirmation modal behavior
- the same form defaults and time parsing behavior
```

- [ ] **Step 2: Run a structural check before splitting**

Run: `Get-Item src/renderer/pages/Automation/index.tsx | Select-Object Length`
Expected: file length is still large enough to justify extraction.

- [ ] **Step 3: Extract pure defaults and time helpers first**

```typescript
export const DEFAULT_AUTOMATION_FORM_VALUES = { ... };
export const parseScheduledTime = (value: unknown): Dayjs | null => { ... };
export const formatScheduledTime = (value: unknown): string | undefined => { ... };
```

- [ ] **Step 4: Extract UI sections and modal wrapper**

```tsx
export function AutomationConfirmModal(props: {...}) {
  return <Modal ... />;
}

export function AutomationMonitorSection(props: {...}) {
  return <Card ... />;
}
```

- [ ] **Step 5: Verify the split**

Run: `npm run type-check`
Expected: exit code 0.

Run: `npm run lint`
Expected: exit code 0 or only unrelated pre-existing warnings.

### Task 4: Split Settings Page Into Page-Local Sections

**Files:**
- Create: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\renderer\pages\Settings\components\SettingsGeneralSection.tsx`
- Create: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\renderer\pages\Settings\components\SettingsDatabaseSection.tsx`
- Create: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\renderer\pages\Settings\components\SettingsUpdateSection.tsx`
- Modify: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\renderer\pages\Settings\index.tsx`

- [ ] **Step 1: Write the failing behavior-preservation target**

```text
The Settings page must keep the same user actions for theme, auto-start, database management, and updater controls after section extraction.
```

- [ ] **Step 2: Run a structural check before splitting**

Run: `Get-Item src/renderer/pages/Settings/index.tsx | Select-Object Length`
Expected: the page file is still large enough to justify extracting independent sections.

- [ ] **Step 3: Extract the independent settings sections**

```tsx
export function SettingsGeneralSection(props: {...}) {
  return <Card ... />;
}

export function SettingsDatabaseSection(props: {...}) {
  return <Card ... />;
}
```

- [ ] **Step 4: Keep page-level orchestration in the entry file**

```tsx
const Settings: React.FC = () => {
  // load state, wire IPC actions, render extracted sections
};
```

- [ ] **Step 5: Verify the split**

Run: `npm run type-check`
Expected: exit code 0.

Run: `npm run lint`
Expected: exit code 0 or only unrelated pre-existing warnings.

### Task 5: Split Shared Renderer Types And Device Modal Helpers

**Files:**
- Create: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\renderer\types\device.ts`
- Create: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\renderer\types\rule.ts`
- Create: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\renderer\types\log.ts`
- Create: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\renderer\types\automation.ts`
- Modify: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\renderer\types\index.ts`
- Modify: `D:\Coding Project\usg-nat-manager\USG1.0.7\src\renderer\pages\Devices\DeviceModal.tsx`

- [ ] **Step 1: Write the failing structural expectation**

```text
Renderer type exports should be organized by domain while keeping existing import sites working through index.ts.
```

- [ ] **Step 2: Run a structural check before changes**

Run: `Get-Item src/renderer/types/index.ts | Select-Object Length`
Expected: one shared types file still owns multiple unrelated domains.

- [ ] **Step 3: Split types into domain files and keep a barrel export**

```typescript
// src/renderer/types/index.ts
export * from './automation';
export * from './device';
export * from './log';
export * from './rule';
```

- [ ] **Step 4: Extract DeviceModal-only helpers if they are still inline**

```typescript
export const buildInitialCredentialValues = (...) => ({ ... });
export const normalizePrivateKeyInput = (...) => { ... };
```

- [ ] **Step 5: Verify the final renderer cleanup**

Run: `npm run type-check`
Expected: exit code 0.

Run: `npm run lint`
Expected: exit code 0 or only unrelated pre-existing warnings.

- [ ] **Step 6: Final verification sweep**

Run: `git status --short`
Expected: only intended cleanup files are modified.
