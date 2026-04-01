# Spec: Character card fields during tracker generation

Status: Implemented
Last updated: 2026-04-01

## Goal

Add a zTracker setting that controls whether character-card prompt fields are included during tracker generation.

Primary user goal:
- Let users disable character-card context for tracker extraction when it adds noise, redundant prose, or biases the tracker toward static card text instead of recent chat state.

Secondary user goal:
- Preserve the current behavior for users who want tracker generation to continue using character-card context.

## Background / Current behavior

- Tracker generation currently calls `buildPrompt(...)` in `src/ui/tracker-actions.ts`.
- The current call does **not** pass `ignoreCharacterFields`, so SillyTavern's prompt builder is free to include character-card prompt fields.
- Live verification against the `Bar` chat showed that character-card content is currently present in the tracker-generation request, including narrator/description text from the card.
- This behavior is currently implicit and not user-configurable.

## Definitions

- **Character-card fields**: prompt content derived from the active character card and related card-backed prompt sections such as description, personality, scenario, and similar character prompt fields that `buildPrompt(...)` would normally include.
- **Skip character card in tracker generation**: a new checkbox setting controlling whether those character-card fields are omitted from the tracker-generation prompt.

## Proposed behavior

### New setting: `skipCharacterCardInTrackerGeneration`

| Property | Value |
|----------|-------|
| Name | `skipCharacterCardInTrackerGeneration` |
| Type | `boolean` |
| Default | `false` |
| Semantics | When enabled, tracker generation requests `ignoreCharacterFields: true` during prompt building. When disabled, tracker generation keeps character-card prompt fields enabled. |

### Prompt-building behavior

When `generateTracker(messageId)` prepares prompt context:

1. Read `settings.skipCharacterCardInTrackerGeneration`.
2. If `false`, call `buildPrompt(...)` as today.
3. If `true`, call `buildPrompt(..., { ignoreCharacterFields: true })`.
4. All other tracker-generation prompt behavior remains unchanged:
   - tracker system prompt selection
   - recent-message windowing
   - injected tracker snapshots
   - World Info policy handling
   - prompt-engineering mode (JSON/XML/TOON)

## UI

- Add a checkbox to zTracker settings near other prompt-composition options.
- Label: `Skip character card in tracker generation`
- Help text / tooltip:
  - `When enabled, tracker generation ignores character-card prompt fields such as description, personality, and scenario.`

## Decisions (closed)

1. Scope: this setting affects tracker generation only, not normal chat generation and not embedded tracker snapshot injection.
2. Default: `false` so tracker extraction avoids static character-card prose unless the user explicitly wants it.
3. Control type: checkbox, because the behavior is binary.
4. Implementation hook: use `ignoreCharacterFields` in the existing `buildPrompt(...)` call rather than introducing custom post-processing.

## Acceptance criteria

- [x] New boolean setting exists in `ExtensionSettings` and defaults to `false`.
- [x] A checkbox is present in zTracker settings and persists correctly.
- [x] When disabled, tracker generation continues to include character-card prompt fields.
- [x] When enabled, tracker generation passes `ignoreCharacterFields: true` to `buildPrompt(...)`.
- [x] Disabling the setting does not change World Info behavior, tracker snapshot injection, or prompt-engineering mode behavior.
- [x] Unit tests cover both enabled and disabled cases.
- [x] CHANGELOG entry is added when implementation lands.

## Tasks checklist

- [x] Add `skipCharacterCardInTrackerGeneration: boolean` to `ExtensionSettings` defaults in `src/config.ts`
- [x] Update tracker prompt building in `src/ui/tracker-actions.ts` to pass `ignoreCharacterFields` based on the setting
- [x] Add checkbox UI in `src/components/Settings.tsx`
- [x] Add tests in `src/__tests__/tracker-actions.test.ts`
- [x] Update `CHANGELOG.md` when implemented
- [x] Update `readme.md` if the setting is user-facing enough to document there

## Open questions

- Should this checkbox cover **all** character-card-backed prompt fields behind `ignoreCharacterFields`, or do we eventually want finer-grained controls (for example description on/off, scenario on/off)?
- Is the setting name sufficiently clear, or should it mention `description/personality/scenario` explicitly in the UI copy?
- Should a future tracker-context debug artifact explicitly indicate whether character-card fields were enabled for that capture?

## Verification

- Live verification on 2026-03-30 showed character-card content present in a real tracker-generation request for the `Bar` chat.
- Implemented on 2026-04-01 with a default-off skip checkbox in zTracker settings and tracker-actions coverage for both enabled and disabled prompt-building paths.