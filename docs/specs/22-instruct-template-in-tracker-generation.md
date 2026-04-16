# Spec: Apply instruct template to tracker generation prompts

Status: Completed
Last updated: 2026-04-15

## Summary

Before this fix, tracker generation prompts sent to text-completion APIs (e.g. llamacpp, koboldcpp, Ollama text-completion endpoints) could still reach the model as a flat concatenation of system instructions, chat messages, previous tracker data, and schema/format instructions — with **no effective instruct template applied**. The prompt that reached the model was then an unstructured wall of text that lacked the turn-delimiter tokens the model was fine-tuned to expect (e.g. `<|im_start|>`, `[INST]`, `### Human:`).

Upstream verification showed SillyTavern already owns instruct formatting for text-completion requests. The initial transport mismatch around `instruct` was real, but it was only part of the larger problem: tracker generation was still resolving several prompt selectors from the saved zTracker connection profile even when SillyTavern's active runtime prompt configuration had changed.

The implemented fix therefore broadened the behavior from "mirror the active instruct preset during transport" to "use the currently active SillyTavern prompt configuration wherever tracker generation depends on host-owned prompt assembly." In practice this means:

- text-completion tracker requests now use the active runtime instruct preset, not just the saved profile field;
- tracker generation no longer forwards saved `preset` and `context` selector names that may be stale relative to the host;
- tracker system prompt resolution now uses the active SillyTavern system prompt in profile mode, while still preserving zTracker's explicit saved tracker-system-prompt override mode;
- tracker injection required no behavioral code change because it already runs against SillyTavern's live host-built prompt chat array.

## Evidence: Captured request

A captured tracker generation request (`debug/request.txt`) targeting a local llamacpp server shows the problem. The `prompt` field is a single string that mixes:

1. **System prompt** — "You are a structured data extraction assistant…"
2. **Chat messages** — `Bar: As you enter the bar…`, `Tobias: "A glass of water please"…`
3. **Previous tracker snapshot** — `Scene details: time: 14:32:05…` (embedded as a system-role message)
4. **Second round of chat** — `Bar: The low hum of the refrigerator…`, `Tobias: "Thank you"`
5. **Format/schema instructions** — "You are a highly specialized AI assistant…" + JSON schema + example

All five sections are joined into one raw string with **no instruct delimiters** between them. There is no way for the model to distinguish which segments are system instructions vs. user dialogue vs. assistant output expectations. For instruct-tuned models this is a significant prompt quality issue.

### What the model receives today (abbreviated)

```
You are a structured data extraction assistant. Your task is to analyze conversations…

Bar: As you enter the bar you realize you are the only customer…
Tobias: "A glass of water please" I say and sit down at the bar.
Scene details: time: 14:32:05; 09/27/2025 (Saturday)
location: Cozy downtown bar interior
…
Bar: The low hum of the refrigerator mingled with the quiet clinking…
Tobias: "Thank you"
You are a highly specialized AI assistant. Your SOLE purpose is to generate…
```

### What the model should receive (example: ChatML instruct template)

```
<|im_start|>system
You are a structured data extraction assistant. Your task is to analyze conversations…
<|im_end|>
<|im_start|>user
Bar: As you enter the bar you realize you are the only customer…
<|im_end|>
<|im_start|>assistant
Tobias: "A glass of water please" I say and sit down at the bar.
<|im_end|>
<|im_start|>system
Scene details:
time: 14:32:05; 09/27/2025 (Saturday)
location: Cozy downtown bar interior
…
<|im_end|>
<|im_start|>user
Bar: The low hum of the refrigerator mingled with the quiet clinking…
<|im_end|>
<|im_start|>assistant
Tobias: "Thank you"
<|im_end|>
<|im_start|>user
You are a highly specialized AI assistant. Your SOLE purpose is to generate…
<|im_end|>
<|im_start|>assistant
```

The exact tokens vary by instruct template (Llama 3, Alpaca, Vicuna, etc.) — the key is that whatever template the user has configured in SillyTavern is applied consistently.

## Root cause analysis

### How the prompt is assembled today

1. **`buildPrompt()`** from `sillytavern-utils-lib` returns a `Message[]` array. When called with `instructName`, it resolves the instruct preset and **may format system prompts and examples** with instruct wrappers, but the returned array still contains individual `Message` objects with `role` and `content` fields.

2. **`includeZTrackerMessages()`** injects previous tracker snapshots as system-role messages into the array.

3. **`sanitizeMessagesForGeneration()`** strips SillyTavern metadata and preserves speaker attribution. For `textgenerationwebui` APIs, speaker names are inlined into content (`"Bar: content"`) but no instruct wrapping is applied.

4. **Schema/format instructions** are appended as a final user-role message.

5. The sanitized `Message[]` array is passed to **`Generator.generateRequest()`**, which delegates to **`ConnectionManagerRequestService.sendRequest()`**.

6. **`ConnectionManagerRequestService`** receives the `Message[]` array and, for text-completion backends, **flattens it into a single `prompt` string** via `TextCompletionService.processRequest()`.
7. Upstream `TextCompletionService.processRequest()` does support instruct-mode formatting for `Message[]` prompts, but only when it is given an instruct preset name.

### Why the instruct template is not applied

The earlier hypothesis in this spec was wrong: the problem is **not** that zTracker fails to set `includeInstruct: true`.

Verified upstream behavior:

- `ConnectionManagerRequestService.defaultSendRequestParams` already defaults `includeInstruct: true`.
- `ConnectionManagerRequestService.sendRequest()` forwards text-completion requests to `TextCompletionService.processRequest()` with:
  - `instructName: includeInstruct ? profile.instruct : undefined`
  - `instructSettings: includeInstruct ? instructSettings : undefined`
- `TextCompletionService.processRequest()` formats a `Message[]` prompt with the instruct template only when `instructName` resolves to a real instruct preset.
- If `instructName` is missing or the preset is not found, it falls back to `prompt.map(x => x.content).join('\n\n')`.

This means the real failure mode is:

```ts
buildPrompt(...) uses: profile.instruct ?? activeInstructName
sendRequest(...) uses: profile.instruct only
```

So when the connection profile does not explicitly store an instruct preset, but SillyTavern still has an active/global instruct preset selected, zTracker can build prompt content using one instruct-context assumption while the transport layer formats the final flattened prompt with **no instruct template at all**.

### Verified upstream behavior

The following host facts are now verified against current upstream SillyTavern behavior:

1. **Service-owned formatting exists**
  - `ConnectionManagerRequestService.sendRequest()` supports `includeInstruct` and `instructSettings`.
  - `includeInstruct` defaults to `true`.

2. **Formatting happens only for text-completion**
  - Chat-completion paths keep `messages[]` and do not apply instruct flattening.
  - Text-completion paths pass the prompt array into `TextCompletionService.processRequest()`.

3. **Preset selection is profile-based at transport time**
  - The request service derives `instructName` from `profile.instruct`.
  - It does not, by itself, fall back to the currently active global instruct preset.

4. **`ignoreInstruct` is respected**
  - `TextCompletionService.constructPrompt()` checks `message.ignoreInstruct` and skips instruct wrapping for those messages.

5. **System-prompt wrapping is not the double-wrap source here**
  - Upstream `formatInstructModeSystemPrompt()` is effectively a no-op and explicitly marked deprecated.
  - The double-wrap risk is therefore not caused by a separate system-prompt formatter automatically wrapping the system prompt before transport.

6. **Fallback without instruct is intentionally plain concatenation**
  - If the transport layer has no usable instruct preset name, it concatenates message contents with blank lines.

7. **No current host override for instruct preset name is visible**
  - `ConnectionManagerRequestService.sendRequest()` accepts `includeInstruct` and `instructSettings`, but not an `instructName` override.
  - `ConnectionManagerRequestService.constructPrompt()` also derives the instruct preset name from `profile.instruct` only.
  - The exported `sillytavern-utils-lib` request types mirror this limitation: `SendRequestCustomOptions` exposes `includeInstruct` and `instructSettings`, but not a resolved instruct preset name.

8. **`instructSettings` cannot replace preset selection on its own**
  - Upstream `TextCompletionService.processRequest()` only applies instruct formatting when `options.instructName` resolves to a real instruct preset.
  - `options.instructSettings` is merged into an already selected preset inside `constructPrompt()`.
  - If `instructName` is missing, the request falls back to plain concatenation before `instructSettings` can help.

### What must be aligned

Tracker generation originally resolved prompt configuration from a mixture of two sources:

- **Saved zTracker connection-profile fields** such as `profile.preset`, `profile.context`, `profile.sysprompt`, and `profile.instruct`
- **Active SillyTavern runtime settings** such as `context.powerUserSettings.sysprompt.name` and `context.powerUserSettings.instruct.preset`

The instruct mismatch was the most visible breakage:

```ts
buildPrompt(...) uses: profile.instruct ?? activeInstructName
sendRequest(...) uses: profile.instruct only
```

But the broader design issue was the same across the rest of prompt selection: saved profile selectors could diverge from the prompt configuration actually active in SillyTavern.

This spec is therefore about eliminating that mismatch so active SillyTavern runtime state drives tracker generation anywhere the extension relies on host-owned prompt assembly.

That applies to:

1. how tracker-generation prompt inputs are assembled,
2. how the final text-completion prompt string is formatted, and
3. how profile-mode tracker system prompt selection is resolved.

### Additional audit result: tracker injection already uses active host prompt config

The later extension-wide audit confirmed that the injection path did not need the same fix. `generate_interceptor` receives the chat array after SillyTavern has already assembled it with the active host prompt configuration. zTracker only injects tracker context into that live chat array, so injection already inherits the currently active SillyTavern prompt settings by design.

### Additional context: difference between API types

| API type | Prompt format | Instruct template relevance |
|----------|---------------|-----------------------------|
| `textgenerationwebui` (text-completion) | Single `prompt` string | **Critical** — model expects instruct tokens |
| `openai` / `claude` (chat-completion) | `messages[]` array with roles | Not needed — API server applies its own formatting |

The instruct template is only relevant for text-completion API types. Chat-completion APIs receive the structured `messages[]` array and the API server handles role formatting natively.

## Impact

- **Degraded output quality**: Instruct-tuned models (which are the vast majority of locally-hosted models) perform poorly when prompts lack the expected turn delimiters. The model cannot reliably distinguish system instructions from chat content from format requirements.
- **Inconsistent behavior**: The same zTracker configuration produces well-structured prompts for chat-completion APIs (OpenAI, Claude) but broken prompts for text-completion APIs (llamacpp, koboldcpp).
- **User confusion**: Users who carefully configure their instruct template in SillyTavern expect it to apply to all LLM interactions, including extension-triggered generations.

## Goals

- Cover the full tracker-generation request path across supported APIs and ensure the configured SillyTavern instruct template is applied wherever the transport requires flattened prompt formatting.
- Apply the user's currently active SillyTavern instruct template when sending tracker generation requests to text-completion APIs.
- Ensure tracker generation follows the active SillyTavern runtime prompt configuration instead of stale saved connection-profile selector fields.
- Explicitly preserve the current behavior for chat-completion APIs where the backend already receives structured `messages[]` and handles role formatting natively.
- Ensure the instruct template is applied consistently for all prompt engineering modes (Native, JSON, XML, TOON).
- Preserve zTracker's explicit saved tracker system prompt override mode where the user intentionally chooses a tracker-specific saved system prompt.

## Non-goals

- Adding a custom instruct template editor inside zTracker settings — the instruct template is managed by SillyTavern core.
- Changing how `buildPrompt()` from `sillytavern-utils-lib` works internally.
- Rewriting the `generate_interceptor` injection path, which already operates on SillyTavern's host-built chat array.
- Changing how chat-completion APIs receive the prompt.

## Detailed design

### Align tracker generation with active SillyTavern runtime selectors

The implemented direction keeps prompt formatting host-owned. zTracker does not build instruct wrappers locally. Instead, tracker generation now prefers active SillyTavern runtime configuration anywhere the extension depends on host-owned prompt assembly and transport.

The effective behavior is:

```ts
const resolvedInstructName = activeInstructName;
const resolvedSystemPromptName =
  trackerSystemPromptMode === 'saved'
    ? savedTrackerSystemPromptName
    : activeGlobalSystemPromptName;

buildPrompt(..., {
  instructName: resolvedInstructName,
  syspromptName: resolvedSystemPromptName,
  presetName: undefined,
  contextName: undefined,
});

if (selectedApi === 'textgenerationwebui') {
  sendTextCompletionTrackerRequest({
    requestMessages: sanitizedPrompt,
    instructName: resolvedInstructName,
    presetName: profile.preset,
  });
}
```

This keeps instruct-token application inside SillyTavern's own text-completion service while making tracker generation respect the active host prompt state instead of whichever selector values happened to be saved on the chosen zTracker profile. Because the stable request-service path still does not expose an `instructName` override, the implementation currently uses `SillyTavern.getContext().TextCompletionService.processRequest()` as an isolated bridge. That dependency is intentional technical debt and should move back to the stable request service once upstream exposes the needed override.

### Implemented behavior

1. `getPromptPresetSelections()` no longer forwards saved `profile.preset` and `profile.context` selector names for tracker generation.
2. For text-completion tracker generation, `instructName` now resolves from the active SillyTavern runtime instruct preset.
3. `resolveTrackerSystemPromptName()` now uses the active SillyTavern global system prompt in profile mode instead of `profile.sysprompt`.
4. zTracker still preserves the explicit saved tracker-system-prompt override when `trackerSystemPromptMode === 'saved'`.
5. `prepareTrackerGeneration()` returns the resolved transport instruct name alongside the built messages.
6. `makeRequestFactory()` routes text-completion tracker requests through a request-local helper that calls SillyTavern's `TextCompletionService.processRequest()` with the resolved `instructName` instead of mutating the shared profile.
7. The text-completion helper keeps its own abort controller and pending-request bookkeeping so cancellation still works without touching the shared profile state.
8. Chat-completion request behavior remains unchanged.
9. Injection behavior remains unchanged because it already operates on SillyTavern's live prompt array after prompt assembly.

### Notes on double-wrapping risk

- `ignoreInstruct` already provides the host-level mechanism to suppress wrapping for selected messages.
- Upstream system-prompt formatting is not doing independent wrapping here.
- The main remaining double-wrap risk is not conceptual duplication of two formatters; it is passing already instruct-shaped content into a transport path that also wraps it. That still needs end-to-end verification during implementation.

### Clarified decisions

The following product and design decisions are now fixed for this spec:

1. **Scope**
  - This spec covers the full tracker-generation flow across API types.
  - The behavioral change is expected on text-completion transports, because those flatten `Message[]` into a single `prompt` string.
  - Chat-completion paths remain intentionally unchanged unless verification reveals a real mismatch.
  - Injection behavior is part of the audit scope, but no code change is required there because it already follows active host prompt state.

2. **Ownership**
  - zTracker should prefer SillyTavern request-service support.
  - zTracker should not implement its own instruct-template formatter unless a separate future spec explicitly chooses that path.
  - Until SillyTavern exposes an instruct-name override on the stable request-service path, zTracker may use the isolated `TextCompletionService.processRequest()` bridge described above as a compatibility stopgap.

3. **Fallback policy**
  - The current implementation does not introduce a zTracker-local instruct formatter.
  - The remaining upstream gap is only the lack of a stable request-service override for `instructName`; once that exists, this implementation should move back to the stable request-service path.

4. **Injected-message roles**
  - Keep the current injected roles.
  - Tracker snapshots stay `system` messages.
  - Schema/format instructions stay `user` messages.

5. **Active-vs-saved selector policy**
  - Tracker-generation and injection requests must follow the configs currently active in SillyTavern.
  - Saved zTracker profile selector fields must not override active host prompt configuration unless the setting explicitly represents a tracker-owned override.

6. **Double-wrapping policy**
  - Avoid double-wrapping even if that requires extra verification work.
  - Any implementation that risks partially wrapped system prompts plus globally applied instruct formatting is not acceptable.

### Remaining verification questions

1. **Concurrency**
  - The request-local transport removed the shared-profile mutation risk.
  - The remaining overlap risk is limited to concurrent tracker requests for the same message id sharing one pending-request slot; that would be the next area to harden if real-world usage exposes overlap.

### Message role mapping

When the instruct template is applied, each message in the `Message[]` array should be wrapped according to its `role`. The mapping should be:

| Message origin | Current role | Instruct behavior |
|----------------|-------------|-------------------|
| System prompt (zTracker preset or profile) | `system` | System wrapper (e.g. `<\|im_start\|>system … <\|im_end\|>`) |
| Chat messages (user turns) | `user` | User/input wrapper |
| Chat messages (assistant turns) | `assistant` | Assistant/output wrapper |
| Previous tracker snapshot | `system` | System wrapper |
| Schema/format instructions | `user` | User/input wrapper |
| (implied) Assistant response start | — | Output prefix to prime the model |

### Prompt structure after fix (conceptual)

For a text-completion API with instruct template applied:

```
[System wrapper start]
  zTracker system prompt
[System wrapper end]

[User wrapper start]
  Character A's dialogue (user turn)
[User wrapper end]

[Assistant wrapper start]
  Character B's response (assistant turn)
[Assistant wrapper end]

[System wrapper start]
  Previous tracker snapshot (JSON)
[System wrapper end]

[User wrapper start]
  More dialogue…
[User wrapper end]

[User wrapper start]
  Schema instructions + format template + example
[User wrapper end]

[Assistant response prefix]
```

## Affected files

| File | Change |
|------|--------|
| `src/ui/tracker-actions.ts` | Send text-completion tracker requests through a request-local helper that passes the active runtime instruct preset into SillyTavern's text-completion service |
| `src/ui/tracker-action-helpers.ts` | Resolve tracker-generation selectors from active runtime state and stop forwarding saved `preset` and `context` selector names |
| `src/system-prompt.ts` | Resolve profile-mode tracker system prompt selection from the active SillyTavern global system prompt |
| `src/components/settings/SystemPromptSettingsSection.tsx` | Update settings copy to reflect that profile mode uses the active SillyTavern prompt |
| `src/components/settings/TrackerInjectionSection.tsx` | Clarify in the UI that injection happens after SillyTavern prompt assembly |
| `src/__tests__/system-prompt.test.ts` | Update regression coverage for active global system prompt resolution |
| `src/__tests__/tracker-actions.prompt-assembly.test.ts` | Add regression coverage for active runtime instruct/system-prompt behavior and transport restoration |
| `CHANGELOG.md` | Record the behavior fix under `Unreleased` |

## Testing strategy

### Unit tests

- Verify that text-completion prompt assembly uses the active runtime instruct preset instead of stale saved `profile.instruct` data.
- Verify that tracker-generation prompt selection no longer forwards saved `preset` and `context` selector names.
- Verify that profile-mode tracker system prompt resolution uses the active global system prompt.
- Verify that tracker request transport passes the active runtime instruct state as request-local transport data without mutating the selected connection profile.
- Verify that stale saved instruct values are ignored by the transport when no active instruct preset is selected.

### Integration / smoke test

- Configure a text-completion connection profile whose saved selector fields differ from the prompt settings currently active in SillyTavern.
- Enable debug logging or inspect the outgoing request through the host/network tooling.
- Verify that the final text-completion request follows the active SillyTavern instruct preset instead of degrading to blank-line concatenation.
- Verify that tracker-generation system prompt selection follows the active SillyTavern system prompt when tracker system prompt mode is not `saved`.
- Verify that the selected connection profile stays unchanged after the request completes.
- Verify that injection still reflects the active SillyTavern prompt configuration without additional zTracker prompt rebuilding.

### Regression

- Verify that chat-completion API requests (OpenAI, Claude) are unchanged.
- Verify that all prompt engineering modes (Native, JSON, XML, TOON) work correctly with instruct wrapping.
- Verify that omitting saved `preset` and `context` selectors still preserves correct host behavior.
- Verify no double-wrapping or stray duplicate instruct sequences in the final text-completion prompt.

## Migration

No user-facing migration is required for the transport change itself. Users who manually worked around stale profile selectors or the broken text-completion transport by embedding instruct tokens directly into custom prompts may still want to remove those workarounds after live verification.

## Dependencies

- Depends on SillyTavern continuing to own instruct formatting for text-completion requests.
- Depends on active runtime prompt selectors remaining available through `SillyTavern.getContext()`.
- Depends on `SillyTavern.getContext().TextCompletionService.processRequest()` remaining available on the current host surface until the stable request-service path exposes an `instructName` override.
- `manifest.json` now gates this path behind `minimum_client_version: 1.17.0`, which is the currently tested SillyTavern baseline for this repository.

## Verification

Verified against current upstream SillyTavern behavior before implementation:

- `ConnectionManagerRequestService.defaultSendRequestParams` defaults `includeInstruct` to `true`.
- `ConnectionManagerRequestService.sendRequest()` forwards text-completion requests with `instructName: profile.instruct`.
- `TextCompletionService.processRequest()` only applies instruct formatting when `instructName` resolves to a real preset.

Verified in this repository after implementation:

- Added regression coverage proving tracker generation now uses the active SillyTavern instruct preset for text-completion assembly.
- Added regression coverage proving profile-mode tracker system prompt resolution now uses the active SillyTavern global system prompt.
- Added regression coverage proving text-completion transport now receives the active instruct preset as request-local state without mutating the selected profile.
- Added regression coverage proving stale saved instruct values are ignored during transport when no active instruct preset is selected.
- Confirmed during code audit that injection already operates on SillyTavern's live prompt array and therefore already follows active host prompt configuration.
- `npm test` passed.
- `npm run build` passed.
