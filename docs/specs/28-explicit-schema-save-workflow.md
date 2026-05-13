# Spec: Explicit schema-editor save workflow

Status: In Progress
Last updated: 2026-05-13

## Summary

Replace per-keystroke persistence in the schema editors with local draft state plus explicit Save actions.

This change covers both editors inside the tracker generation settings:

1. JSON schema editor
2. HTML template editor

Each editor should keep local edits while the user types, show actionable validation feedback when the draft is invalid, and enable its Save button only when the draft is both valid and changed.

## Motivation

Editing the schema JSON is currently unstable because valid intermediate edits are persisted immediately, which triggers a rerender and repopulates the textarea from saved state. In practice this causes the field to blink and can replace the user's in-progress text with the formatted persisted version.

The same settings area already preserves invalid drafts, but it does not preserve valid unsaved drafts and does not give the user an explicit commit point. That makes larger schema or template changes frustrating and error-prone.

## Verified current behavior

- [src/components/Settings.tsx](../../src/components/Settings.tsx) updates `schemaText` locally and immediately persists any JSON draft that parses successfully.
- The same component formats persisted schema JSON through `formatSchemaText(...)`, so saved state is always pretty-printed before it is rendered back into the editor.
- The sync helpers in [src/components/settings/schema-editor-state.ts](../../src/components/settings/schema-editor-state.ts) only preserve drafts that are invalid. Valid drafts are considered safe to overwrite from settings.
- This means a valid but still-unsaved draft can be replaced on the same preset after a rerender, which matches the reported blink/reset behavior.
- HTML template editing currently behaves similarly in principle, although the bug report specifically came from the JSON schema editor.

## Decisions

- Scope includes both the JSON schema editor and the HTML template editor for a consistent UX.
- Unsaved drafts are discarded when the user switches schema preset.
- Preset list edits that keep the same active preset key should preserve local drafts instead of discarding them.
- No discard-confirmation prompt is included in this change.
- Save controls are separate per editor so one invalid draft does not block saving the other editor.

## Desired behavior

### JSON schema editor

- Typing never persists changes automatically.
- Invalid JSON stays in the textarea.
- JSON drafts must also remain a usable top-level object before Save is enabled.
- The UI shows the current parse error while the draft is invalid.
- The Save button stays disabled until the JSON is valid and changed.
- Clicking Save persists the active preset's schema and normalizes the editor to the saved formatted JSON.

### HTML template editor

- Typing never persists changes automatically.
- Invalid Handlebars stays in the textarea.
- The UI shows the current template compile error while the draft is invalid.
- The Save button stays disabled until the template is valid and changed.
- Clicking Save persists the active preset's HTML template.

### Preset changes and restore-default

- Switching schema preset discards unsaved drafts and loads the selected preset immediately.
- Creating, renaming, or deleting other presets should not discard local drafts unless the active preset actually changes.
- Restore default replaces the active preset values and repopulates both editors from the restored preset.

## Implementation plan

1. Refactor [src/components/settings/schema-editor-state.ts](../../src/components/settings/schema-editor-state.ts) so it exposes structured validation and dirty-state helpers instead of only boolean invalid-draft checks.
2. Remove per-keystroke persistence from [src/components/Settings.tsx](../../src/components/Settings.tsx) schema onChange handlers.
3. Add explicit JSON and HTML save handlers in [src/components/Settings.tsx](../../src/components/Settings.tsx).
4. Extend [src/components/settings/TrackerGenerationSection.tsx](../../src/components/settings/TrackerGenerationSection.tsx) and [src/components/settings/SchemaPresetSection.tsx](../../src/components/settings/SchemaPresetSection.tsx) to render save buttons plus inline validation and unsaved-draft feedback.
5. Add the minimal supporting styles in [src/styles/main.scss](../../src/styles/main.scss).
6. Update [src/__tests__/schema-editor-state.test.ts](../../src/__tests__/schema-editor-state.test.ts) to cover valid unsaved drafts, invalid error messages, and preset-switch resync behavior.
7. Add a concise Unreleased note in [CHANGELOG.md](../../CHANGELOG.md).

## Acceptance criteria

- Typing valid JSON no longer causes the textarea to blink or revert mid-edit.
- Invalid JSON and invalid Handlebars drafts remain editable and visibly explain why Save is disabled.
- Save buttons are disabled when the draft is invalid or unchanged.
- Saving updates only the active preset editor field that the user saved.
- Switching presets discards unsaved drafts and loads the selected preset.

## Implementation notes

- [src/components/settings/schema-editor-state.ts](../../src/components/settings/schema-editor-state.ts) now exposes structured validation and dirty-state helpers for both JSON and HTML drafts.
- The JSON draft validation now rejects non-object top-level values so unusable schema payloads do not become savable just because they parse.
- [src/components/Settings.tsx](../../src/components/Settings.tsx) no longer persists schema drafts on each `onChange`; it now uses explicit save handlers for JSON and HTML.
- [src/components/settings/preset-state.ts](../../src/components/settings/preset-state.ts) now exposes a helper that keeps local drafts when preset-list edits do not actually switch the active preset.
- [src/components/settings/SchemaPresetSection.tsx](../../src/components/settings/SchemaPresetSection.tsx) now renders Save buttons for both editors, disables them until the draft is valid and changed, and shows inline validation or unsaved-draft feedback.
- [src/styles/main.scss](../../src/styles/main.scss) now includes the minimal editor-action and validation-status styling needed for the new workflow.

## Verification

- Updated [src/__tests__/schema-editor-state.test.ts](../../src/__tests__/schema-editor-state.test.ts) to cover dirty-state detection, valid unsaved drafts, invalid draft error reporting, and preset-change resync behavior.
- Updated [src/__tests__/preset-state.test.ts](../../src/__tests__/preset-state.test.ts) to cover draft-preservation behavior across preset-list edits.
- Ran `npm test` successfully.
- Ran `npm run build` successfully.
- Live SillyTavern smoke verification is still pending. This spec remains `In Progress` until the browser-side no-blink editing flow is confirmed against the real host UI. This session did not have a browser automation surface available to execute that host-level check directly.