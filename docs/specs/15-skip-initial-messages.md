# Spec: Skip initial messages before tracker generation

Status: Open
Last updated: 2026-03-30

## Goal

Allow users to configure a minimum chat length before zTracker starts generating trackers. This prevents tracker generation on the first few messages of a conversation, where there is typically too little context to produce useful tracker data.

## Background / Current behavior

- Tracker generation can be triggered manually (truck icon), via regenerate button, or automatically via `autoMode` (on `CHARACTER_MESSAGE_RENDERED` / `USER_MESSAGE_RENDERED` events).
- The existing `includeLastXMessages` setting controls how many recent messages are included in the prompt context (the scan window), but does **not** prevent generation from being attempted on early messages.
- When `autoMode` is enabled, every incoming/outgoing message triggers `generateTracker(messageId)` unconditionally (no minimum-message-count guard exists).
- Manual generation also has no minimum-message-count guard.

## Definitions

- **Chat length**: total number of messages in the active chat (`globalContext.chat.length`), counting from index 0.
- **Skip threshold** (`skipFirstXMessages`): the minimum number of messages that must exist in the chat **before** zTracker will generate a tracker. A value of 0 disables the guard (current behavior).
- **Scan window** (`includeLastXMessages`): the existing setting that controls how many messages are included in the generation prompt. This is **not** changed by this spec.

## Proposed behavior

### New setting: `skipFirstXMessages`

| Property | Value |
|----------|-------|
| Name | `skipFirstXMessages` |
| Type | `number` (integer, ≥ 0) |
| Default | `0` (disabled — current behavior preserved) |
| Semantics | The chat must contain **more than** `skipFirstXMessages` messages before tracker generation is allowed. |

### Guard logic

When `generateTracker(messageId)` is called:

1. Read `settings.skipFirstXMessages`.
2. If `skipFirstXMessages > 0` and `messageId < skipFirstXMessages`, skip generation:
   - **Auto-mode**: silently skip (no error, no toast).
   - **Manual trigger**: show a brief info toast explaining the threshold is not reached, e.g. *"Tracker generation skipped: chat has fewer than {N} messages."*
3. Otherwise, proceed with normal generation flow.

### Interaction with `includeLastXMessages`

The two settings are independent:
- `skipFirstXMessages` controls **whether** generation happens at all.
- `includeLastXMessages` controls **which messages** are included in the prompt when generation does happen.

Example: `skipFirstXMessages = 6`, `includeLastXMessages = 4`
- Messages 0–5: no tracker generated.
- Message 6: tracker generated, prompt includes messages 3–6 (last 4).

### UI

- Add a number input to the zTracker settings panel, near the existing `includeLastXMessages` control.
- Label: *"Skip First X Messages"*
- Tooltip/title: *"Minimum number of messages before zTracker starts generating trackers. 0 disables this threshold."*

## Decisions (closed)

1. **Guard placement**: inside `generateTracker()` (the single dispatch point), not in each caller / event handler. This ensures manual and auto-mode triggers both respect the setting. Granular generators (`generateTrackerPart`, `generateTrackerArrayItem*`, etc.) do not need the guard because their UI buttons only appear on messages that already have tracker data.
2. **Semantics**: `messageId < skipFirstXMessages` (0-indexed). If `skipFirstXMessages = 6`, the first tracker can appear on message index 6 (the 7th message in the chat).
3. **Manual vs. auto behavior on skip**: auto-mode is silent; manual shows an info toast so the user understands why nothing happened.
4. **Default value**: `0` (no skip) to preserve backward compatibility.
5. **No interaction with scan window**: the settings are orthogonal; `includeLastXMessages` continues to work as before.

## Acceptance criteria

- [ ] New `skipFirstXMessages` field exists in `ExtensionSettings` with default `0`.
- [ ] `generateTracker()` checks the threshold and silently skips for auto-mode, or shows an info toast for manual triggers.
- [ ] UI number input for the setting is present in the settings panel and persists correctly.
- [ ] When `skipFirstXMessages = 6` and auto-mode is enabled, messages 0–5 receive no auto-generated tracker.
- [ ] When `skipFirstXMessages = 6`, manually clicking the truck icon on message 3 shows an info toast and does not generate.
- [ ] When `skipFirstXMessages = 6`, manually clicking on message 6 generates normally.
- [ ] When `skipFirstXMessages = 0`, all messages are eligible (existing behavior unchanged).
- [ ] `includeLastXMessages` still controls the prompt scan window independently.
- [ ] Unit tests cover the guard logic (skip vs. proceed) for both auto and manual paths.
- [ ] Setting appears in the CHANGELOG under `Unreleased`.

## Tasks checklist

- [ ] Add `skipFirstXMessages: number` to `ExtensionSettings` interface and defaults in `src/config.ts`
- [ ] Add guard logic at the top of `generateTracker()` in `src/ui/tracker-actions.ts`
  - Accept an optional `options?: { silent?: boolean }` parameter (or similar) to distinguish auto vs. manual
  - Auto callers in `src/ui/ui-init.ts` pass `{ silent: true }`
- [ ] Add UI input in `src/components/Settings.tsx`
- [ ] Add / update unit tests in `src/__tests__/tracker-actions.test.ts`
- [ ] Update `CHANGELOG.md` (Unreleased section)
- [ ] Update `readme.md` if applicable

## Open questions

None at this time.
