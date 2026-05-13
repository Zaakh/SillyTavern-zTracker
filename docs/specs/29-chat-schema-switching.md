# Spec: Chat schema switching behavior

Status: In Progress
Last updated: 2026-05-13

## Summary

Clarify and harden the existing chat-level lazy schema switch behavior.

The selected direction is a lazy switch:

1. Changing the schema for a chat updates the default schema used for future full tracker generations.
2. Existing message trackers keep the schema and template they were originally saved with.
3. Existing messages move onto the new chat schema only when the user runs a full tracker regeneration for that message.

This spec does not introduce automatic bulk migration or chat-wide regeneration of historical tracker data.

## Motivation

Users currently experience chat schema switching as confusing because the repo already stores a chat-level schema selection, but existing tracker-bearing messages still carry message-level schema metadata and saved templates. In practice this can make a switched chat feel stuck on the old schema unless the user knows to run a full regeneration.

The goal is to make that contract explicit in the UI, tests, and docs instead of silently introducing risky data migration behavior.

## Verified current behavior

- [src/ui/tracker-actions.ts](../../src/ui/tracker-actions.ts) already exposes `modifyChatMetadata()`, which lets the user change the stored schema preset for the active chat.
- [src/ui/tracker-actions.ts](../../src/ui/tracker-actions.ts) `prepareTrackerGeneration(...)` already reads the chat-level schema key and uses it for full tracker generation.
- [src/ui/tracker-actions.ts](../../src/ui/tracker-actions.ts) `persistTrackerUpdate(...)` stores schema metadata on each message alongside the saved tracker data and HTML template.
- [src/ui/tracker-actions.ts](../../src/ui/tracker-actions.ts) `prepareExistingTrackerGeneration(...)` currently follows the existing message schema for targeted part, item, and field regeneration.
- [src/__tests__/tracker-actions.prompt-assembly.test.ts](../../src/__tests__/tracker-actions.prompt-assembly.test.ts) already proves full generation uses chat metadata.
- [src/__tests__/tracker-actions.cleanup.test.ts](../../src/__tests__/tracker-actions.cleanup.test.ts) already proves targeted regeneration uses the message schema.

## Decisions

- Scope is limited to clarifying and tightening the lazy-switch behavior.
- This change does not add a new chat-wide schema migration feature.
- Switching a chat schema does not bulk-migrate or bulk-regenerate historical trackers.
- Full tracker regeneration is the supported way to move an existing message onto the new chat schema.
- Partial/context-menu regeneration keeps using the saved message schema, but the UI should explain that behavior when the chat default has changed.
- The existing Modify Schema popup remains the primary chat-level schema switch entry point.

## Desired behavior

### Chat schema switch UI

- The Modify Schema popup explains that changing the chat schema affects future full tracker generations.
- The success feedback after a schema switch explicitly states that existing trackers keep their current schema until a full tracker regeneration is run for those messages.

### Full regeneration

- Running full tracker generation after a chat schema switch uses the chat's current schema preset.
- The regenerated message then stores the new message-level schema metadata and template as usual.

### Partial regeneration

- Running a part, array-item, or field regeneration on an older tracker continues to use that message's stored schema.
- If the active chat schema no longer matches the message schema, the UI surfaces one informational message per user action telling the user to run a full tracker regeneration if they want the message to adopt the chat's new schema.

## Implementation plan

1. Keep the chat-level schema switch path centered on [src/ui/tracker-actions.ts](../../src/ui/tracker-actions.ts) `modifyChatMetadata()`.
2. Add a shared helper in [src/ui/tracker-actions.ts](../../src/ui/tracker-actions.ts) so all existing-tracker regeneration flows can detect when the message schema differs from the active chat schema.
3. Surface a clear informational message for that mismatch instead of silently leaving users to infer why the old schema is still in effect.
4. Suppress repeated copies of that same message during multi-target cleanup and recreate flows.
5. Update [templates/modify_schema_popup.html](../../templates/modify_schema_popup.html) so the popup explains the lazy-switch contract before the user saves.
6. Add focused tests in [src/__tests__/tracker-actions.cleanup.test.ts](../../src/__tests__/tracker-actions.cleanup.test.ts) covering the mismatch notification and batch deduplication behavior.
7. Align tracker-action test metadata with the runtime `schemaKey` contract so the coverage exercises the real persisted key names.
8. Update [CHANGELOG.md](../../CHANGELOG.md), [readme.md](../../readme.md), and [docs/specs/ideas.md](../ideas.md) so the documented behavior matches the implementation.

## Acceptance criteria

- Users can change the schema preset stored for the active chat without creating a new chat.
- The UI makes it clear that existing trackers are not bulk-migrated.
- Full tracker regeneration adopts the active chat schema.
- Partial regeneration warns when it is still using an older message schema after the chat default changed.
- Batch cleanup and recreate flows do not spam the same schema-mismatch notice once per regenerated target.

## Verification

- Updated [src/__tests__/tracker-actions.cleanup.test.ts](../../src/__tests__/tracker-actions.cleanup.test.ts) to cover mismatch messaging when partial regeneration still follows an older message schema after the chat default changes, plus batch deduplication for cleanup-and-recreate flows.
- Updated [src/__tests__/tracker-actions.prompt-assembly.test.ts](../../src/__tests__/tracker-actions.prompt-assembly.test.ts) and the shared tracker-action test harness so the tests use the runtime `schemaKey` metadata names instead of the older `schemaPreset` aliases.
- Ran `npm test -- tracker-actions.cleanup.test.ts tracker-actions.prompt-assembly.test.ts` successfully.
- Ran `npm test` successfully.
- Ran `npm run build` successfully.
- Live SillyTavern smoke testing is still pending. The remaining host-level check is to switch a chat schema in the real UI, confirm that full regeneration adopts the new schema, and confirm that older untouched trackers remain on their saved schema until regenerated.