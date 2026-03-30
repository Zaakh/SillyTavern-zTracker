# Spec: Character card fields during tracker generation

Status: Open
Last updated: 2026-03-30

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
- **Include character card in tracker generation**: a new checkbox setting controlling whether those character-card fields are allowed into the tracker-generation prompt.

## Proposed behavior

### New setting: `includeCharacterCardInTrackerGeneration`

| Property | Value |
|----------|-------|
| Name | `includeCharacterCardInTrackerGeneration` |
| Type | `boolean` |
| Default | `true` |
| Semantics | When enabled, tracker generation keeps the current behavior and allows character-card prompt fields. When disabled, tracker generation requests `ignoreCharacterFields: true` during prompt building. |

### Prompt-building behavior

When `generateTracker(messageId)` prepares prompt context:

1. Read `settings.includeCharacterCardInTrackerGeneration`.
2. If `true`, call `buildPrompt(...)` as today.
3. If `false`, call `buildPrompt(..., { ignoreCharacterFields: true })`.
4. All other tracker-generation prompt behavior remains unchanged:
   - tracker system prompt selection
   - recent-message windowing
   - injected tracker snapshots
   - World Info policy handling
   - prompt-engineering mode (JSON/XML/TOON)

## UI

- Add a checkbox to zTracker settings near other prompt-composition options.
- Label: `Include character card in tracker generation`
- Help text / tooltip:
  - `When disabled, tracker generation ignores character-card prompt fields such as description, personality, and scenario.`

## Decisions (closed)

1. Scope: this setting affects tracker generation only, not normal chat generation and not embedded tracker snapshot injection.
2. Default: `true` for backward compatibility.
3. Control type: checkbox, because the behavior is binary.
4. Implementation hook: use `ignoreCharacterFields` in the existing `buildPrompt(...)` call rather than introducing custom post-processing.

## Acceptance criteria

- [ ] New boolean setting exists in `ExtensionSettings` and defaults to `true`.
- [ ] A checkbox is present in zTracker settings and persists correctly.
- [ ] When enabled, tracker generation continues to include character-card prompt fields (existing behavior).
- [ ] When disabled, tracker generation passes `ignoreCharacterFields: true` to `buildPrompt(...)`.
- [ ] Disabling the setting does not change World Info behavior, tracker snapshot injection, or prompt-engineering mode behavior.
- [ ] Unit tests cover both enabled and disabled cases.
- [ ] CHANGELOG entry is added when implementation lands.

## Tasks checklist

- [ ] Add `includeCharacterCardInTrackerGeneration: boolean` to `ExtensionSettings` defaults in `src/config.ts`
- [ ] Update tracker prompt building in `src/ui/tracker-actions.ts` to pass `ignoreCharacterFields` based on the setting
- [ ] Add checkbox UI in `src/components/Settings.tsx`
- [ ] Add tests in `src/__tests__/tracker-actions.test.ts`
- [ ] Update `CHANGELOG.md` when implemented
- [ ] Update `readme.md` if the setting is user-facing enough to document there

## Open questions

- Should this checkbox cover **all** character-card-backed prompt fields behind `ignoreCharacterFields`, or do we eventually want finer-grained controls (for example description on/off, scenario on/off)?
- Is the setting name sufficiently clear, or should it mention `description/personality/scenario` explicitly in the UI copy?
- Should a future tracker-context debug artifact explicitly indicate whether character-card fields were enabled for that capture?

## Verification

- Live verification on 2026-03-30 showed character-card content present in a real tracker-generation request for the `Bar` chat.
- No code change is implemented by this spec yet; implementation verification will be added once the setting exists.