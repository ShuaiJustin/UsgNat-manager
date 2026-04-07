# Rules Batch Actions Layout Design

## Goal

Move the rules page batch-action controls from the table footer to a clearer position above the table so the action flow matches user attention after row selection.

## Scope

- Only adjust the rules page batch-action placement and visibility behavior.
- Keep the existing batch actions and handlers unchanged.
- Do not change backend IPC, rule update behavior, or pagination behavior.

## Design

### Layout

- Keep the filter row and top-right primary actions unchanged.
- Insert a dedicated batch-action bar between the current-device summary card and the rules table.
- Remove the footer toggle/button that currently reveals batch actions below the table.

### Visibility

- Show the batch-action bar only when one or more rows are selected.
- Include a compact selection summary so the user can see how many rules are currently targeted.

### Interaction

- Preserve the existing batch handlers: batch update IP, enable, disable, export, delete.
- Preserve the existing button order, with the destructive action still last.
- Keep the selected rows after the bar appears; only clear them when the existing handlers already clear selection.

### Validation

- Add a small helper-level regression test for the “selected rows show batch actions” rule.
- Re-run lint, type-check, tests, and a production build after the layout change.

## Notes

- This change is intentionally scoped to the rules page and should not restructure shared table utilities.
