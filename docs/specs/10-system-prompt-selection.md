# Spec: Configurable system prompt source for tracker generation

Status: Completed
Last updated: 2026-03-17

## Summary

Allow users to choose which system prompt zTracker sends to the LLM when building tracker data. Currently the system prompt is implicitly dictated by the SillyTavern connection profile (`profile.sysprompt`). This spec adds two explicit modes:

| Mode | Label | Behavior |
|------|-------|----------|
| **A** | From connection profile | Use the system prompt configured in the selected connection profile (current behavior) |
| **B** | Saved ST prompt | Pick any saved SillyTavern system prompt by name |

zTracker ships a recommended system prompt preset that gets installed into SillyTavern's system prompt library. Users select it via Mode B. This avoids a redundant custom-text editor inside zTracker — the prompt lives where SillyTavern already manages system prompts.

## Motivation

The roleplay system prompt (character-card voice, personality, scenario rules) is designed for creative writing and often carries instructions irrelevant or counter-productive for structured data extraction. Smaller models (≤ 12 B parameters) are especially sensitive to conflicting or noisy instructions: a long RP system prompt can crowd out tracker-specific guidance and waste context tokens.

Giving the user explicit control over the system prompt means:
- **Mode A** preserves today's behavior for users who already tuned their profile.
- **Mode B** lets users pick any saved system prompt — including the zTracker-optimized one we ship — without creating a dedicated connection profile.

A dedicated Mode C (custom textarea in zTracker settings) was considered and rejected: it duplicates functionality SillyTavern already provides and adds UI surface that needs to be maintained. Users who want a custom prompt can save it in SillyTavern and select it via Mode B.

## Current behavior (baseline)

### Prompt assembly flow

1. `prepareTrackerGeneration()` in `src/ui/tracker-actions.ts` calls `buildPrompt()` from `sillytavern-utils-lib`.
2. `buildPrompt()` receives `syspromptName: profile?.sysprompt` — the system prompt name stored inside the connection profile.
3. Inside the lib, `getPresetManager("sysprompt").getCompletionPresetByName(name)` resolves the prompt content. That content is then substituted into the full prompt (respecting `prefer_character_prompt`, instruct formatting, etc.).
4. The resulting message array (system + chat history + world info) is returned as `promptResult.result`.
5. zTracker then injects previous tracker snapshots (`includeZTrackerMessages`), optional World Info allowlist entries, and finally appends the tracker-specific user prompt (`settings.prompt` / JSON / XML template).

### What this means

- The system prompt is **always** the one named in the connection profile.
- There is **no UI** in zTracker settings to override or inspect which system prompt is active.
- Changing the system prompt requires editing the connection profile in SillyTavern core settings.

## Goals

- Let the user choose between Mode A / B via a dropdown in zTracker settings.
- For Mode B, provide a sub-selector that lists all saved SillyTavern system prompts.
- Ship a recommended zTracker system prompt as a regular SillyTavern system prompt preset.
- Install the recommended preset automatically on first load (if it doesn't exist yet).
- Migrate existing installs gracefully (default to Mode A so nothing changes).

## Non-goals

- A custom system-prompt text editor inside zTracker settings (use SillyTavern's built-in editor instead).
- Replacing or altering SillyTavern's own system prompt management UI.
- Changing how the generate_interceptor path works (it doesn't rebuild prompts; it only injects tracker snapshots into an already-assembled chat array).
- Per-schema-preset system prompts (potential future extension, not this spec).

## Detailed design

### Shipped system prompt preset: "zTracker"

zTracker installs a SillyTavern system prompt preset named **"zTracker"** on first load (if no preset with that name exists). This prompt is designed to complement the tracker prompt (`settings.prompt` / JSON / XML template) which is appended later as a user message. The two prompts have distinct responsibilities:

| Concern | System prompt ("zTracker" preset) | Tracker prompt (user message, appended last) |
|---------|-----------------------------------|----------------------------------------------|
| Role & identity | Sets the model as a data-extraction assistant | — |
| Output contract | "JSON only, no narration" | Format-specific schema + example |
| Field-by-field instructions | — | Detailed per-field rules (time format, location, outfits, …) |
| Anti-roleplay guardrail | "Do NOT continue the conversation" | — |
| Consistency rule | "Match previous tracker snapshot" | "Consider recent messages and current tracker" |
| Conciseness | "Short phrases, not sentences" | — |

#### Full text of the shipped preset (~100 tokens)

```
You are a structured data extraction assistant. Your task is to analyze conversations and produce a JSON tracker update that conforms to a provided schema.

Rules:
- Output ONLY valid JSON matching the schema. No narration, no markdown unless instructed.
- Fill every field. Use conversation context to infer values not explicitly stated.
- Prefer short, specific phrases over full sentences.
- Maintain consistency with any previous tracker snapshot in the conversation.
- Do NOT continue the conversation or roleplay. Only produce the requested data.
- Follow all detailed instructions provided later in this conversation.
```

**Design rationale for ≤ 12 B models:**
- ~100 tokens — leaves maximum context for chat history and schema.
- Imperative phrasing ("Do NOT", "Output ONLY") — small models respond better to direct commands than nuanced requests.
- Explicit anti-roleplay rule — prevents the most common failure mode where the model continues the story instead of producing JSON.
- "Follow all detailed instructions provided later" — tells the model to defer to the tracker prompt without conflicting with it.
- No field-specific guidance — avoids duplication with the tracker prompt and keeps the system prompt schema-agnostic.

### New settings fields (`ExtensionSettings` in `src/config.ts`)

```ts
/**
 * Controls where zTracker gets its system prompt for tracker generation.
 * - 'profile': use the system prompt from the selected connection profile (default / legacy).
 * - 'saved':   use a specific saved SillyTavern system prompt, identified by name.
 */
trackerSystemPromptMode: 'profile' | 'saved';

/**
 * Name of the saved SillyTavern system prompt to use when mode is 'saved'.
 * Resolved at generation time via getPresetManager("sysprompt").
 */
trackerSystemPromptSavedName: string;
```

Defaults:
- `trackerSystemPromptMode`: `'profile'`
- `trackerSystemPromptSavedName`: `''`

### Preset installation (`src/system-prompt.ts` + startup init)

On extension init, after settings are loaded:
1. Check if a SillyTavern system prompt named `"zTracker"` already exists via `getPresetManager("sysprompt")`.
2. If not, create it with the shipped text above.
3. Do **not** overwrite if the user has edited it.

This is implemented via `ensureZTrackerSystemPromptPresetInstalled()`, called during startup before rendering settings. It uses SillyTavern's runtime preset manager `savePreset(name, data)` API and only creates the preset when it is missing.

### Prompt assembly changes (`src/ui/tracker-actions.ts`)

Inside `prepareTrackerGeneration()`, the `syspromptName` passed to `buildPrompt()` is resolved based on the mode:

```
Mode A ('profile'):
  → syspromptName = profile?.sysprompt  (unchanged, current behavior)

Mode B ('saved'):
  → syspromptName = settings.trackerSystemPromptSavedName
```

Implementation detail: Mode B no longer mutates SillyTavern's global `prefer_character_prompt` setting during tracker prompt assembly. Instead, zTracker builds the normal prompt without a profile system prompt override and then injects the selected saved system prompt as the final leading `system` message before chat history. That keeps tracker generations isolated from unrelated SillyTavern generations while still applying the selected saved prompt.

### UI changes (`src/components/Settings.tsx`)

Add a new **System Prompt** section above the existing "Prompt" row:

```
┌─────────────────────────────────────────────────────┐
│  System Prompt Source                               │
│  ┌─────────────────────────────────┐                │
│  │ ▼ From connection profile       │  ← dropdown    │
│  │   From saved ST prompt          │                │
│  └─────────────────────────────────┘                │
│                                                     │
│  (if "From saved ST prompt" selected:)              │
│  System Prompt                                      │
│  ┌─────────────────────────────────┐                │
│  │ ▼ <list of ST system prompts>   │  ← dropdown    │
│  └─────────────────────────────────┘                │
│  Tip: edit prompts in SillyTavern's system prompt   │
│  manager. The "zTracker" preset is optimized for    │
│  tracker generation.                                │
└─────────────────────────────────────────────────────┘
```

- The mode dropdown uses `<select>` with two `<option>` elements.
- For Mode B, populate the saved-prompt list via `SillyTavern.getContext().getPresetManager("sysprompt")` — enumerate available presets at render time. If the API does not expose an enumeration method, fall back to a text input where the user types the preset name.
- A hint below the dropdown tells users about the shipped "zTracker" preset and where to edit prompts.

### Migration / backward compatibility

- On load, if `trackerSystemPromptMode` is `undefined`, default to `'profile'`. Existing behavior is preserved.
- No data migration needed; new fields use defaults.

## Codebase change map

| File | Change |
|------|--------|
| `src/config.ts` | Add `trackerSystemPromptMode`, `trackerSystemPromptSavedName` to `ExtensionSettings`. Add `ZTRACKER_SYSTEM_PROMPT_PRESET_NAME` and `ZTRACKER_SYSTEM_PROMPT_TEXT` constants. Add defaults to `defaultSettings`. |
| `src/system-prompt.ts` | Centralizes preset enumeration, existence checks, shipped-preset installation, and system-prompt name resolution helpers. |
| `src/index.tsx` | Ensures the shipped `zTracker` system prompt preset exists before rendering settings. |
| `src/ui/tracker-actions.ts` | Resolves `syspromptName` from the selected mode and forces the saved prompt to win over `prefer_character_prompt` during tracker prompt assembly. |
| `src/components/Settings.tsx` | Add "System Prompt Source" dropdown and conditional saved-prompt selector for Mode B. |
| `src/__tests__/` (new or extended) | Test that the `syspromptName` resolution logic picks the correct name for each mode. |
| `CHANGELOG.md` | Add entry under Unreleased. |
| `readme.md` | Document the new setting and the shipped system prompt preset. |

## Resolved notes

1. **Enumeration**: resolved. SillyTavern runtime preset managers expose `getPresetList()` and upstream also exposes `getAllPresets()` for advanced-formatting managers such as `sysprompt`.
2. **Creation**: resolved. Upstream SillyTavern preset managers support `savePreset(name, data)` for `sysprompt`, and system prompts are persisted through the normal `/api/presets/save` endpoint.
3. **`prefer_character_prompt` interaction**: resolved in implementation. When Mode B is active, zTracker injects the selected saved prompt as a dedicated leading `system` message instead of temporarily mutating SillyTavern's global `prefer_character_prompt` setting.

## Acceptance criteria

- [x] Mode dropdown (A/B) appears in zTracker settings.
- [x] Mode A: behavior is identical to current (system prompt from connection profile).
- [x] Mode B: user can select any saved ST system prompt; that prompt is used during tracker generation.
- [x] A "zTracker" system prompt preset is installed into SillyTavern on first load.
- [x] The shipped preset is installed and wired for use with the default tracker prompt.
- [x] Existing installs default to Mode A automatically (no breaking change).
- [x] Sequential generation respects the selected system prompt mode for every part request.
- [x] Settings persist across reloads.
- [x] Tests cover system prompt mode branching logic.

## Tasks checklist

- [x] Verify `getPresetManager("sysprompt")` enumeration + creation capabilities
- [x] Add new fields + defaults to `src/config.ts`
- [x] Implement preset auto-install in startup initialization
- [x] Implement prompt-mode branching in `src/ui/tracker-actions.ts`
- [x] Add UI controls in `src/components/Settings.tsx`
- [x] Write / extend unit tests
- [x] Update `CHANGELOG.md`
- [x] Update `readme.md`
- [ ] Manual smoke test in a live SillyTavern UI

## Verification

- `npm test`
  - 12 test suites passed, including new coverage for preset listing, preset installation, saved-prompt existence checks, and prompt-mode resolution.
- `npm run build`
  - Production build completed successfully and updated the packaged `dist` assets.
- Manual SillyTavern smoke test was not run in this change.
