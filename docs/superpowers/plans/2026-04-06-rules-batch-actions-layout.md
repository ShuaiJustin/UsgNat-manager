# Rules Batch Actions Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move rules batch actions above the table and only show them when rows are selected.

**Architecture:** Add a tiny visibility helper in the rules page helpers module, verify it with a small test, then simplify the rules page layout by removing the footer toggle and rendering a top batch-action bar when selection exists.

**Tech Stack:** React, Ant Design, TypeScript, node:test

---

### Task 1: Lock The Visibility Rule

**Files:**
- Modify: `src/renderer/pages/Rules/rulePageHelpers.test.ts`
- Modify: `src/renderer/pages/Rules/rulePageHelpers.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('shows rule batch actions only when at least one row is selected', () => {
  assert.equal(shouldShowRuleBatchActions(0), false);
  assert.equal(shouldShowRuleBatchActions(1), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/renderer/pages/Rules/rulePageHelpers.test.ts`
Expected: FAIL because `shouldShowRuleBatchActions` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export const shouldShowRuleBatchActions = (selectedCount: number): boolean => selectedCount > 0;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/renderer/pages/Rules/rulePageHelpers.test.ts`
Expected: PASS

### Task 2: Move The Batch Actions Bar

**Files:**
- Modify: `src/renderer/pages/Rules/index.tsx`
- Modify: `src/renderer/locales/zh-CN.json`
- Modify: `src/renderer/locales/en-US.json`

- [ ] **Step 1: Remove the footer toggle state**

Delete `showBatchMenu` state and its reset calls where they only exist for the old footer-driven menu.

- [ ] **Step 2: Render the batch-action bar above the table**

Render a conditional block between the current-device summary and the `<Table />`:

```tsx
{shouldShowRuleBatchActions(selectedRowKeys.length) && (
  <div style={{ ... }}>
    <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
      <span>{t('rules.selectedCount', { count: selectedRowKeys.length })}</span>
      <Space wrap>
        ...
      </Space>
    </Space>
  </div>
)}
```

- [ ] **Step 3: Remove the old footer batch controls**

Delete the table `footer` block that shows the toggle button and remove the old below-table batch menu block.

- [ ] **Step 4: Add the selection-count translation**

Add:

```json
"selectedCount": "{{count}} selected"
```

and

```json
"selectedCount": "已选 {{count}} 项"
```

### Task 3: Verify

**Files:**
- Modify: none

- [ ] **Step 1: Run focused test**

Run: `node --test src/renderer/pages/Rules/rulePageHelpers.test.ts`
Expected: PASS

- [ ] **Step 2: Run type-check**

Run: `npm run type-check`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: PASS
