# Spec: Partial tracker data deletion for cleaner re-creation

Status: Open
Last updated: 2026-04-20

## Summary

Allow users to clear selected tracker data without deleting the whole tracker, then optionally recreate the cleared targets from a single coordinated workflow.

This feature exists to solve the multi-error case that the current UI handles poorly:

- one tracker can contain several wrong sections at once;
- regenerating only one target still leaves other wrong targets in the prompt context;
- those remaining wrong values can anchor later partial regenerations;
- the only current workaround is raw JSON editing or full tracker deletion.

The primary UX should therefore be a structured `Clear and Recreate Selected` flow, not just a low-level delete primitive. Standalone partial deletion should still be possible, but it should be a secondary path.

## Motivation

zTracker already supports targeted regeneration:

- top-level parts;
- array items;
- array item fields.

That is a strong baseline, but it only redacts the one target currently being regenerated. When several related sections are wrong, users need a way to remove all stale values first so the model is not asked to keep consistency with already-bad data.

Example:

1. `charactersPresent` is wrong.
2. The `characters` array is also wrong because it was derived from the same bad state.
3. Regenerating only `characters` still exposes the wrong `charactersPresent` list in the tracker snapshot context.
4. Regenerating `charactersPresent` afterward still exposes the wrong `characters` data until that second pass completes.

Today the user must manually edit JSON to delete both targets first. That is too technical for a routine correction workflow and easy to do incorrectly.

## Current behavior and codebase analysis

### Storage and rendering

Tracker data is persisted on the message under `message.extra[EXTENSION_KEY]`.

Current stored fields include:

- `value`: full tracker object;
- `html`: schema HTML template;
- `partsOrder`: top-level part order;
- `partsMeta`: metadata such as array identity keys and item-field lists.

Rendering happens in `src/tracker.ts` by compiling the schema HTML with Handlebars using `{ strict: true, noEscape: true }`.

Important implication:

- removing keys outright from a persisted tracker can break rendering if the template references those keys;
- partial deletion cannot rely on simply deleting arbitrary properties and re-rendering.

### Existing UI surface

The message-level tracker controls currently expose:

- full regenerate;
- parts menu for per-part/per-item/per-field regenerate;
- raw JSON edit;
- full delete.

The parts menu is generated in `src/tracker.ts` from `partsOrder` and `partsMeta` and already provides a strong, schema-aware target model for partial actions.

### Existing targeted regeneration already redacts one target correctly

`src/ui/tracker-actions.ts` already omits the targeted value from prompt context before regeneration:

- `generateTrackerPart()` uses `redactTrackerPartValue()`;
- `generateTrackerArrayItem()` and its identity/name variants use `redactTrackerArrayItemValue()`;
- `generateTrackerArrayItemField()` and its identity/name variants use `redactTrackerArrayItemFieldValue()`.

This is important: the current problem is not that single-target regeneration forgets to redact. The problem is that zTracker has no user-facing way to redact several stale targets together before re-creating them.

### Helper coverage already present

`src/tracker-parts.ts` already contains low-level helpers for:

- top-level part redaction;
- array item redaction;
- array item field redaction;
- part merge and replacement logic;
- array-item identity resolution.

The test suite already covers these helpers in `src/__tests__/tracker-parts.test.ts`.

This makes the proposed feature a good extension of existing architecture rather than a new parallel system.

## Goals

- Allow partial deletion of tracker data at the same granularity the UI already supports for targeted regeneration.
- Provide a good UX for selecting several wrong targets in one action.
- Make the primary workflow `Clear and Recreate Selected` so multi-target cleanup is practical.
- Preserve render safety despite strict Handlebars templates.
- Preserve array-item identity where possible so users can recreate the intended item instead of losing the target reference.
- Keep the raw JSON editor available for power users, but remove the need to use it for common cleanup.

## Non-goals

- Replacing the raw JSON editor with a full generic JSON tree editor.
- Trying to infer and hide arbitrary values inside the user-provided tracker HTML template DOM.
- Adding arbitrary nested-field targeting beyond the granularity zTracker already exposes today.
- Changing the semantics of existing single-target regenerate actions.

## UX proposal

### Primary entry point: new cleanup button

Add a new message-level cleanup button next to the existing tracker controls.

Recommended behavior:

- icon opens a structured cleanup modal;
- it does not overload the existing parts popover with multi-select state;
- the existing list menu remains optimized for quick one-off regenerate actions.

Why a modal is preferred over multi-select inside the current parts popover:

- the parts menu is compact and already dense;
- multi-target selection, parent-child conflict handling, and confirmation text would be awkward in the current popover;
- a modal can show the whole target set clearly and explain the difference between clearing only and clear-plus-recreate.

### Cleanup modal contents

The modal should present a structured target tree derived from the same data that powers the parts menu:

- top-level parts;
- array items under each array part;
- array item fields under each object item.

Each row should have a checkbox and a human-readable label.

Example:

```text
Tracker Cleanup

[ ] time
[x] charactersPresent
[x] characters
    [ ] Alice
    [x] Alice.outfit
    [ ] Bob

Buttons:
- Clear and Recreate Selected
- Clear Selected
- Cancel
```

### Selection rules

- Selecting a parent target supersedes its descendants.
- Descendant rows should become disabled or auto-deselected when the parent is selected.
- The modal should show a small summary like `2 effective targets selected` after parent-child normalization.

This avoids confusing requests such as clearing a whole part and one field inside that same part.

### Primary action: Clear and Recreate Selected

This should be the default action because it directly addresses the contamination problem.

Behavior:

1. Normalize the selected targets.
2. Build a single redacted tracker state in memory with all selected targets cleared.
3. Run the selected recreations against that shared redacted state, not against the original tracker.
4. Persist the final tracker once the coordinated recreation flow finishes, or persist partial progress with pending markers if some targets fail.

Result:

- later recreations in the same batch do not see stale values from other selected targets;
- the user does not need to perform several manual delete-edit-regenerate cycles.

### Secondary action: Clear Selected

Users should also be able to clear targets without immediate recreation.

This is useful when:

- the user wants to stage cleanup first and recreate later;
- the user wants to remove obviously wrong values before continuing the chat;
- the user wants to retry recreation later with a different prompt/configuration.

### Pending-cleared state

When targets are cleared but not yet recreated successfully, the message UI should surface that state.

Recommended UI:

- a small message-level badge such as `2 tracker targets cleared`;
- pending markers in the cleanup modal on reopen;
- pending styling in the parts menu so the user can see which targets still need recreation.

The main rendered tracker HTML should continue to come from the stored tracker value. zTracker should not attempt DOM-level hiding inside arbitrary user templates.

## Data and rendering model

### Persisted deletion must be render-safe

Because tracker templates render with Handlebars strict mode, persisted partial deletion cannot simply remove arbitrary keys and re-render.

The implementation should therefore persist schema-aware placeholder values for cleared targets.

Guidance:

- full top-level object part: replace with a blank object shaped from the schema;
- full top-level array part: replace with an empty array;
- scalar field: keep the property present and blank the value;
- array item object: preserve identity fields and blank the remaining fields;
- array item primitive: replace with a blank primitive value and keep metadata for its display label if needed.

This keeps rendering structurally safe while still removing the stale content that would otherwise contaminate future regeneration.

### Pending-redaction metadata

Add message-level metadata for cleared targets so zTracker can:

- show pending state in the UI;
- preserve recreate affordances even when the stored display value has been blanked;
- retain identity information for array items that would otherwise become ambiguous.

Suggested shape:

```ts
message.extra[EXTENSION_KEY].pendingRedactions = {
  version: 1,
  targets: [
    { kind: 'part', partKey: 'charactersPresent' },
    {
      kind: 'array-item-field',
      partKey: 'characters',
      idKey: 'name',
      idValue: 'Alice',
      fieldKey: 'outfit',
      label: 'Alice.outfit',
    },
  ],
};
```

Exact field naming can change during implementation, but the metadata should be explicit enough to survive re-render and allow targeted retry.

## Recreation semantics

### Supported target types in v1

The new feature should align with the existing target model:

- top-level part;
- array item;
- array item field.

This keeps the feature consistent with the parts menu and current action helpers.

### Ordering for batch recreation

Batch recreation should use deterministic ordering.

Recommended order:

1. top-level part targets in `resolveTopLevelPartsOrder()` order;
2. array item targets ordered by part, then stable item identity or current index;
3. array item field targets ordered by part, item, then field.

Reason:

- top-level parts are the most likely dependency roots;
- item and field recreation should run after higher-level context is corrected.

### Failure handling

If one selected target fails during `Clear and Recreate Selected`:

- do not restore the stale deleted value;
- preserve successful recreations completed earlier in the batch;
- leave failed targets in pending-cleared state so the user can retry them.

This is more useful than an all-or-nothing rollback because the user goal is to remove known-bad data and avoid reintroducing it.

## Relationship to existing actions

### Existing quick regenerate remains unchanged

The current parts menu regenerate buttons should continue to work exactly as they do now for quick one-off corrections.

That flow is still appropriate when only one target is wrong.

### Raw JSON edit remains a power-user fallback

The current `Edit Tracker JSON` action should remain available for advanced cases.

The new cleanup flow should cover the common corrective workflow so users no longer need to understand the raw stored tracker structure just to clear a few bad sections.

## Resolved decisions

1. `Select all pending` will not ship in v1. The first version should keep the cleanup modal focused on explicit target selection and retry, without adding extra shortcut actions.
2. Arrays of primitive values should preserve a human-readable display label in pending metadata after clear-only operations. This keeps the retry UI understandable even when the stored primitive value has been blanked.
3. The message-level badge should appear only while targets remain pending-cleared. A successful clear-and-recreate batch should simply leave no pending badge behind rather than showing a separate success confirmation badge.

## Implementation outline

### Likely files to change

| File | Reason |
|---|---|
| `src/tracker.ts` | Add the cleanup control and surface pending-cleared state in tracker controls / parts menu rendering. |
| `src/ui/ui-init.ts` | Wire the new cleanup button and any pending-target recreate actions. |
| `src/ui/tracker-actions.ts` | Add modal open logic, target normalization, clear-only flow, and coordinated clear-plus-recreate flow. |
| `src/tracker-parts.ts` | Add schema-aware blanking helpers, target normalization helpers, and shared batch-redaction utilities. |
| `src/__tests__/tracker-parts.test.ts` | Cover blanking and parent-child target normalization. |
| `src/__tests__/tracker-render.test.ts` | Cover cleanup button / pending marker rendering. |
| `src/__tests__/tracker-actions*.test.ts` | Cover clear-only and clear-plus-recreate orchestration. |

### Files likely unchanged

| File | Reason |
|---|---|
| `src/config.ts` | No new global setting is required for the first version. |
| `templates/buttons.html` | The tracker controls are injected by `src/tracker.ts`, not by this template. |
| `manifest.json` | No new host integration or compatibility gate is required. |

## Testing strategy

- Unit-test target normalization so parent selections suppress descendant targets.
- Unit-test schema-aware blank value construction for object parts, array parts, array items, and fields.
- Unit-test batch recreation ordering.
- Unit-test failure handling so failed targets remain pending instead of restoring stale values.
- Render test the cleanup button and pending-cleared markers.
- Add at least one tracker-actions test proving `Clear and Recreate Selected` uses a shared redacted base rather than the original tracker snapshot.

No live SillyTavern smoke test is required for the spec itself, but implementation should include one because this feature introduces a new message-level control and modal workflow.

## Acceptance criteria

- Users can clear selected tracker targets without deleting the whole tracker.
- Supported target granularity matches the current partial-regeneration UI: part, array item, array item field.
- Users can select several targets and run a single `Clear and Recreate Selected` action.
- Coordinated recreation omits all selected stale values from prompt context before the first recreate request runs.
- Parent-target selection supersedes descendant selection.
- Clearing selected targets does not cause tracker render failure.
- Pending-cleared targets are visible and retryable after reload.
- Primitive-array pending targets preserve a readable display label after their stored value has been blanked.
- Existing quick regenerate, raw JSON edit, and full delete behaviors remain intact.
