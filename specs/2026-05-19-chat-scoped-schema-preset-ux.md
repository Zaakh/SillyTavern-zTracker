# Chat-Scoped Schema Preset UX

## Summary

Refine zTracker's schema-preset UX so the active preset for an existing chat is explicit and visible, while the preset selector in the main settings remains the global default and preset-definition editor for future chats.

This spec builds on the lazy chat-switch model already captured in [docs/specs/29-chat-schema-switching.md](../docs/specs/29-chat-schema-switching.md). It does not change the core data model that stores schema metadata at both chat and message level. It changes the product UX so users can predict which schema a full regeneration and new tracker generations will use.

## Current State

- The main settings selector in [src/components/settings/SchemaPresetSection.tsx](../src/components/settings/SchemaPresetSection.tsx) currently looks like the active schema selector for zTracker as a whole.
- That same selector also determines which preset definition the user edits in the JSON Schema and HTML fields.
- Full tracker generation in [src/ui/tracker-actions.ts](../src/ui/tracker-actions.ts) already uses the chat-level schema key stored in `chatMetadata.zTracker.schemaKey`.
- Existing message trackers also store their own schema key and rendered HTML template in message metadata.
- Partial regeneration already follows the saved message schema, not the current chat schema.
- Existing chats can already change their schema via the `Modify zTracker schema` popup, but that entry point is separate from the main settings and is easy to miss.

## Problem Statement

Users reasonably expect the currently selected `Schema Preset` in the main zTracker settings to be the schema used by `Regenerate Tracker`. That is not the current UX contract. The visible selector in settings controls preset editing and the default fallback for chats that do not yet have their own schema key, while full regeneration for an existing chat follows a separate chat-scoped schema selection.

The split is technically sound but poorly communicated. The result is that regeneration can feel stale or buggy even when the runtime behavior is internally consistent.

## User Value

- Existing chats can choose and show their own schema preset without creating a new chat.
- New chats still start from an intentional default instead of forcing a choice every time.
- Users can tell which schema full regeneration will use before they click it.
- The preset editor remains usable without silently changing older chats.

## Goals

- Make the active schema preset for the current chat explicit in a UI.
- Preserve the global preset selection that acts as the default for all new chats and the active preset-definition editor.
- Define how a chat gets its initial schema preset when it has no stored chat-level schema yet.
- Keep full `Regenerate Tracker` aligned with the current chat schema preset.
- Keep partial regeneration aligned with the saved message schema preset.
- Reduce the chance that users confuse preset editing with chat-level schema selection.

## Non-Goals

- Bulk-migrating historical trackers when a chat schema changes.
- Removing message-level schema metadata.
- Automatically syncing all existing chats to the current global default preset.
- Redesigning schema preset authoring itself beyond the minimum labeling and control changes needed for clarity.

## Open Questions

- Non-blocking: should the existing `Modify zTracker schema` popup remain as a secondary shortcut after the main settings gains a current-chat selector? Working assumption for this spec: keep it as a shortcut in the first iteration, but align its copy with the new settings wording.

## Proposed Approach

### UX model

- Treat the main settings preset selector as the global default for new chats and the selector for which preset definition is being edited.
- Add a separate `Current Chat Schema Preset` control in the chat settings when a chat is active.
- Clearly label the two controls so their scopes are obvious:
  - `Default Schema Preset` or equivalent wording for future chats plus preset editing.
  - `Current Chat Schema Preset` or equivalent wording for the active chat only.

### Behavior rules

- If the active chat already has `chatMetadata.zTracker.schemaKey`, zTracker uses that value for full tracker generation and full regeneration.
- If the active chat has no stored chat schema yet, zTracker initializes it from the current global default preset selected in settings and persists it.
- Changing the global default preset does not retroactively change existing chats that already have a stored chat schema.
- Changing the current chat schema preset affects future full tracker generations in that chat.
- Full `Regenerate Tracker` always uses the current chat schema preset and rewrites the saved message-level schema metadata as part of the regenerated tracker.
- Partial regeneration continues to use the saved message schema, including the existing mismatch messaging from the lazy-switch behavior.

### Copy and discoverability

- The settings UI should explain that the default preset seeds new chats, while the current-chat preset controls full generation in the open chat.
- If the popup remains, it should use the same terminology as the main settings.
- Success and info messages should consistently talk about `current chat schema` versus `message schema` to avoid referring to both as the generic `selected schema preset`.

## Affected Areas

- [src/components/Settings.tsx](../src/components/Settings.tsx)
- [src/components/settings/SchemaPresetSection.tsx](../src/components/settings/SchemaPresetSection.tsx)
- A new or updated settings component for the chat-scoped selector under [src/components/settings](../src/components/settings)
- [src/ui/tracker-actions.ts](../src/ui/tracker-actions.ts)
- [templates/modify_schema_popup.html](../templates/modify_schema_popup.html) if the popup stays
- [src/__tests__](../src/__tests__) coverage for chat-schema initialization and regenerate behavior
- [readme.md](../readme.md)
- [CHANGELOG.md](../CHANGELOG.md)

## Acceptance Criteria

- The active chat's schema preset is exposed separately from the global default preset.
- The main settings UI makes it clear that the global default preset is used for new chats and preset editing, not as an automatic override for existing chats.
- When an existing chat already has a stored chat schema preset, full `Regenerate Tracker` uses that chat preset even if the global default preset is different.
- When a chat has no stored chat schema preset yet, zTracker initializes it from the current global default preset before full generation and persists it.
- Changing the global default preset does not alter the active schema preset of chats that already have stored chat metadata.
- Changing the current chat schema preset causes the next full tracker regeneration in that chat to use the newly selected chat preset.
- Partial regeneration continues to use the saved message schema preset and does not silently switch to the current chat schema.
- User-facing copy distinguishes among global default preset, current chat preset, and saved message schema.

## Implementation Plan

1. Update the settings UX so the existing preset selector is explicitly framed as the global default and preset editor selector.
2. Add a current-chat schema selector to the main settings, backed by `chatMetadata.zTracker.schemaKey`.
3. Ensure chat initialization logic persists the current global default into chat metadata only when a chat does not already have a stored schema key.
4. Keep full generation and full regeneration on the chat schema path, and keep partial regeneration on the message schema path.
5. Align popup copy and any toast/info messages with the new terminology.
6. Add focused tests for:
   - seeding a new chat from the global default preset;
   - preserving an existing chat's preset when the global default changes;
   - full regeneration using the current chat preset;
   - partial regeneration continuing to use the message schema.
7. Update user-facing docs and changelog entries for the clarified schema-selection model.

## Risks and Dependencies

- Two schema-related selectors in one settings area can still be confusing if the labels and help text are weak.
- Preset rename or deletion flows must keep global default, chat metadata, and message metadata fallback behavior coherent.
- The implementation depends on stable access to the active chat metadata via `SillyTavern.getContext()` and on the settings UI having enough active-chat context to render a chat-scoped selector safely.
- This spec intentionally extends, rather than replaces, the lazy-switch behavior documented in [docs/specs/29-chat-schema-switching.md](../docs/specs/29-chat-schema-switching.md).

## Status

Ready for Review

Implementation note: the settings UI now reconciles deleted or stale current-chat schema keys immediately, keeps rename-by-key stable, and uses the shared chat-schema metadata key constant. Automated validation passed with `npm test` and `npm run build`. Live SillyTavern smoke testing is still pending.