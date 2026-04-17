# Spec: Context-menu tracker generation indicator

Status: Completed
Last updated: 2026-04-17

## Summary

Show a visible message-level status indicator when zTracker generation is triggered from the tracker context menu. This should reuse the same visual language as the existing outgoing auto-mode badge that appears when a normal sent message pauses reply generation to build a tracker first.

The current context-menu path only spins the clicked regenerate control inside the parts menu. The new behavior should add a message-level badge on the target message for the lifetime of the request, while keeping the clicked control spinner.

## Motivation

The current context-menu regeneration flow gives only very local feedback:

- A part regenerate click spins the clicked part button.
- An array-item regenerate click spins the clicked item button.
- An array-item-field regenerate click spins the clicked field button.

That is technically correct, but it is easy to miss in practice:

- The parts menu is portaled and can be visually separated from the message.
- The clicked control may scroll out of view during longer requests.
- The menu-level spinner does not give the same clear “zTracker is busy on this message” signal that users already get during outgoing auto-mode.

By contrast, outgoing auto-mode adds a clear badge above the pending message with the text `Generating tracker before reply`, which makes the tracker operation obvious even when the user is focused on the message body rather than the initiating control.

This feature closes that UX gap and makes manual context-menu-triggered generation feel consistent with the existing outgoing auto-mode behavior.

## Current behavior

### Outgoing auto-mode already has a message-level indicator

`src/ui/ui-init.ts` wires `MESSAGE_SENT` into `outgoingAutoMode.beginPendingMessage(messageId)` before calling `actions.generateTracker(messageId, { silent: true })`.

`src/ui/outgoing-auto-mode.ts` then:

- adds `.ztracker-auto-mode-hold` to the message block;
- injects a `.ztracker-auto-mode-status` badge before `.mes_text`;
- renders the text `Generating tracker before reply`;
- swaps the host send button into a stop button;
- removes the indicator when tracker generation completes.

### Context-menu generation only spins the clicked action

`src/ui/ui-init.ts` routes tracker context-menu clicks directly to:

- `generateTrackerPart()`
- `generateTrackerArrayItem()` / `generateTrackerArrayItemByName()` / `generateTrackerArrayItemByIdentity()`
- `generateTrackerArrayItemField()` / `generateTrackerArrayItemFieldByName()` / `generateTrackerArrayItemFieldByIdentity()`

Those functions in `src/ui/tracker-actions.ts` currently:

- resolve the target message;
- add `.spinning` only to the clicked context-menu control;
- run the request;
- remove `.spinning` in `finally`.

They do not add any message-level indicator and they do not involve `outgoing-auto-mode.ts`.

## Goals

- Show a visible message-level status indicator while any context-menu tracker regeneration request is in flight.
- Reuse the existing zTracker indicator styling and placement so the UI stays consistent.
- Keep the current clicked-button spinner so users still see which specific part/item/field was targeted.
- Remove the indicator reliably on success, failure, or cancellation.
- Scope the indicator to the affected message only.

## Non-goals

- Reusing the outgoing auto-mode send-button stop behavior for context-menu actions.
- Changing the behavior of full-message tracker generation triggered by the main truck button.
- Changing generation semantics, prompts, request payloads, or tracker merge behavior.
- Supporting multiple independent concurrent indicators for the same message beyond the current one-pending-sequence-per-message behavior.

## Proposed behavior

### Trigger scope

Show the indicator for all tracker updates started from the tracker context menu:

- regenerate top-level part;
- regenerate array item;
- regenerate array item field.

This includes the name-based and identity-based array-item helper variants because they delegate into the same generation flow.

### Presentation

Add a message-level badge above the target message content using the same placement and base styling as the outgoing auto-mode badge.

Recommended initial text:

```text
Updating tracker from menu
```

Why this text:

- it is accurate for part, item, and field regeneration;
- it still reads as tracker-generation work;
- it avoids implying that a normal chat reply is being held.

The existing truck-fast icon can be reused so the indicator remains visually tied to zTracker.

### Lifecycle

For each context-menu-triggered tracker request:

1. Add the message-level indicator immediately before the async request starts.
2. Keep the existing local `.spinning` class on the clicked control.
3. Remove both indicator and button spinner in `finally`.
4. If the request aborts or fails, remove the indicator exactly the same way.

### Relationship to outgoing auto-mode

The outgoing auto-mode controller currently mixes two responsibilities:

- message-level badge rendering;
- host send-button / generation gating.

Context-menu generation only needs the first responsibility. The implementation should therefore avoid coupling menu regeneration to outgoing auto-mode state.

Preferred direction:

- extract a small shared helper for the message-level zTracker status badge;
- keep outgoing auto-mode send-button behavior inside `outgoing-auto-mode.ts`;
- let `tracker-actions.ts` use the shared badge helper directly.

This keeps the change local and avoids inventing a fake “pending outgoing auto-mode run” just to render the badge.

## Implementation outline

### 1. Extract shared message-level indicator DOM handling

Move the badge DOM creation/removal logic behind a helper that can:

- add a zTracker status badge to a specific message id;
- remove a zTracker status badge from a specific message id;
- optionally preserve the existing `.ztracker-auto-mode-hold` behavior for outgoing auto-mode.

The helper should stay DOM-focused and should not know about host generation suppression or resume logic.

### 2. Reuse that helper in outgoing auto-mode

Refactor `src/ui/outgoing-auto-mode.ts` to call the shared helper for badge rendering, but keep:

- send-button swapping;
- generation-start suppression logic;
- host resume logic;
- run-token handling.

This is a structural cleanup, not a behavior change.

### 3. Add indicator calls around context-menu generation actions

Wrap the async body of these functions with the shared indicator helper:

- `generateTrackerPart()`
- `generateTrackerArrayItem()`
- `generateTrackerArrayItemByName()` / `generateTrackerArrayItemByIdentity()` via their delegated flow
- `generateTrackerArrayItemField()`
- `generateTrackerArrayItemFieldByName()` / `generateTrackerArrayItemFieldByIdentity()` via their delegated flow

The indicator should target the same `messageId` already used for button lookup and tracker save/render operations.

### 4. Preserve existing button-level feedback

Do not remove the existing `.spinning` logic on the clicked context-menu control. The new message-level badge is additive, not a replacement.

## Testing strategy

Add unit coverage for the new indicator behavior.

Likely test surface:

- extend the existing UI tests around message-level status badges in `src/__tests__/ui-init.auto-mode-exclusion.test.ts`; or
- add focused tests around a new shared indicator helper if the DOM logic is extracted.

Minimum cases:

- context-menu part generation adds a message-level status badge while the request is pending;
- the badge is removed when the request resolves;
- the badge is removed when the request rejects;
- the clicked menu control still gets and removes `.spinning` as before;
- outgoing auto-mode still shows `Generating tracker before reply` unchanged.

## Codebase verification

### Files likely to change

| File | Reason |
|---|---|
| `src/ui/tracker-actions.ts` | Add context-menu indicator lifecycle around part/item/field regeneration flows. |
| `src/ui/outgoing-auto-mode.ts` | Reuse a shared message-level indicator helper instead of owning the badge DOM directly. |
| `src/__tests__/ui-init.auto-mode-exclusion.test.ts` or a new helper test | Cover the new indicator behavior and guard against outgoing auto-mode regressions. |

### Files likely unchanged

| File | Reason |
|---|---|
| `src/tracker.ts` | Menu markup and tracker rendering stay the same. |
| `templates/buttons.html` | No template change is required for a message-level status badge inserted from JS. |
| `src/config.ts` | No setting or migration is needed. |

## Risks

- If the indicator DOM logic is copied instead of shared, the two badge variants may drift in markup or cleanup behavior.
- If the context-menu path reuses outgoing auto-mode state directly, it risks unintended interaction with host send-button logic.
- If cleanup is missed on one error path, the message could be left with a stale busy badge.

## Verification

Implemented with a shared message-status helper in `src/ui/message-status-indicator.ts`, reused by `src/ui/outgoing-auto-mode.ts` and by the context-menu regeneration flows in `src/ui/tracker-actions.ts`.

Validated with:

- a focused shared-helper test covering message-local indicator add/remove behavior for successful and failing async work;
- the existing outgoing auto-mode UI tests, which still verify the unchanged `Generating tracker before reply` badge behavior;
- `npm test`;
- `npm run build`.