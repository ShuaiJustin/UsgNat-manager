# Project Structure Cleanup Design

## Summary

This design defines a medium-scope cleanup for the USG NAT Manager repository. The goal is to make the project easier to navigate in the editor, reduce confusion at the repository root, and split a small number of oversized source files into clearer responsibility boundaries without changing user-facing behavior.

## Current Problems

### Root Directory Is Hard To Scan

The repository root currently mixes source code, generated output, demos, supplemental documentation, archived updater notes, and utility scripts at the same level. This makes the project look larger and messier than it really is, and it makes it harder to tell which files are part of the actual application.

### Some Source Files Carry Too Much Responsibility

The current structure already separates `src/main` and `src/renderer`, but several files are acting as catch-all modules:

- `src/main/ipc/index.ts`
- `src/renderer/pages/Automation/index.tsx`
- `src/renderer/pages/Settings/index.tsx`
- `src/renderer/pages/Devices/DeviceModal.tsx`
- `src/renderer/types/index.ts`

These files mix orchestration, view code, defaults, validation, and utility behavior in ways that make them harder to understand and safer to modify.

### Documentation And Utility Assets Lack Clear Boundaries

The current `docs` area includes both actual documentation and at least one utility script. Demo content and archived updater materials are also stored in top-level locations that do not clearly signal whether they are active project inputs or historical references.

## Goals

- Make the repository root read as an application project instead of a dump of project-adjacent materials.
- Keep active engineering entry points obvious: source, scripts, resources, Prisma schema, package metadata, and the main README.
- Move supporting documentation, demos, and archived materials into clearer locations.
- Split the most overloaded source files into smaller modules with single, more obvious responsibilities.
- Preserve existing behavior and public application flows.

## Non-Goals

- No database schema redesign.
- No Electron or Vite build pipeline redesign.
- No UI redesign.
- No broad service-layer rewrite.
- No functional changes to automation, device, rule, log, or updater behavior beyond what is required to keep the cleanup compiling.

## Root Directory Design

### Keep At Root

The repository root should remain focused on active project inputs:

- `src/`
- `prisma/`
- `scripts/`
- `resources/`
- configuration files such as TypeScript, ESLint, Prettier, Tailwind, Vite, and packaging config
- `README.md`
- package metadata files

### Re-home Supporting Materials

The cleanup should move secondary materials into clearer locations:

- `Demo/index.html` moves to `docs/mockups/demo.html`
- updater reference materials currently under `USG Server Updates/Docs` move to `docs/archive/custom-updater/`
- utility scripts currently inside `docs/` move into `scripts/` under a subfolder such as `scripts/dev/` or `scripts/tools/`
- `generate-icon.js` moves under `scripts/`

### Output Directories Stay Ignored

Generated and environment-specific folders remain outside the mental model of project structure:

- `dist/`
- `release/`
- `node_modules/`

The cleanup does not attempt to repurpose these folders. It only ensures project docs and ignore rules keep them clearly classified as generated output or dependencies.

## Source Structure Design

### Main Process

`src/main/ipc/index.ts` becomes a thin registration entry point. It should no longer contain the full set of Electron IPC handlers inline.

Proposed direction:

- keep `src/main/ipc/index.ts` as the top-level `registerIpcHandlers()` entry
- add a handler folder under `src/main/ipc/handlers/`
- group handlers by domain such as device, rule, credential, log, automation, config, backup, system, updater, and window
- keep shared assertions or IPC-local helper utilities in focused sibling files instead of repeating them in multiple handlers

The intent is to keep domain boundaries obvious while minimizing churn to callers.

### Renderer

Large page files should be split by responsibility without forcing a brand-new app architecture.

Proposed direction:

- `src/renderer/pages/Automation/index.tsx`
  - keep data loading, submit actions, and high-level orchestration in the page entry
  - move modal rendering, grouped form sections, and defaults/parsing helpers into nearby files
- `src/renderer/pages/Settings/index.tsx`
  - keep page-level state orchestration in the entry
  - move independent settings sections or cards into page-local components
- `src/renderer/pages/Devices/DeviceModal.tsx`
  - separate form section rendering, credential-related helpers, and reusable field logic
- `src/renderer/types/index.ts`
  - split into domain files and retain a small barrel export

### Services

Existing services remain in place unless a large file needs a small helper extraction to support the above cleanup. This design does not call for a service-layer reorganization beyond targeted helper extraction.

## Documentation Design

The cleanup must update repository-facing documentation so the cleaned structure stays understandable:

- update the structure section in `README.md`
- update document links that currently reference old demo or docs locations
- update ignore comments and any script references that mention old top-level paths

## Validation Strategy

Cleanup work should be performed in small batches and validated after each batch:

1. Directory and file moves
   - verify moved files still exist in their new locations
   - verify documentation references point to valid paths
2. Source file decomposition
   - run `npm run lint`
   - run `npm run type-check`
3. Targeted tests
   - run relevant existing tests when a moved helper or split module already has coverage
   - add minimal tests only when a new extracted pure helper is easy to verify and the test clearly reduces regression risk

## Risk Management

The repository already contains local uncommitted changes. Cleanup work must avoid overwriting or reverting unrelated edits. If a planned move or split conflicts directly with current work in progress, the implementation should pause and adjust the decomposition rather than forcibly resetting files.

## Execution Order

The implementation should proceed in this order:

1. Clean the repository root and update path references.
2. Split `src/main/ipc/index.ts` into domain-oriented handler modules.
3. Split the highest-value renderer files:
   - `src/renderer/pages/Automation/index.tsx`
   - `src/renderer/pages/Settings/index.tsx`
   - `src/renderer/pages/Devices/DeviceModal.tsx`
4. Split `src/renderer/types/index.ts` into smaller domain files if still justified after the page cleanup.

## Expected Outcome

After this cleanup, the repository root should present a much clearer project shape, and the most difficult source files should be easier to read and modify. The codebase should feel more intentional without taking on the risk of a full architectural rewrite.
