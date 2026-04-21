# Spec: Normalize chat roles for tracker generation

Status: Completed
Last updated: 2026-04-21

## Summary

Add a tracker-generation-only prompt-assembly mode that treats all recent chat turns as `assistant` messages before zTracker sends the request to the model.

The goal is to reduce model bias around "who said it" during tracker extraction. From the tracker's point of view, the important part is usually the scene content itself, not whether a turn came from the user or the character. System-role messages remain reserved for tracker-generation instructions and other host-owned prompt context.

This is a prompt-assembly feature only. It does not change message rendering, stored chat history, tracker injection into normal generations, or SillyTavern's live chat prompt outside zTracker's tracker-generation flow.

## Motivation

Current tracker generation preserves the user/assistant split that comes back from `buildPrompt()`. That is usually correct for conversational roleplay, but it can add unnecessary weighting for extraction tasks:

- some models over-prioritize user turns and underweight assistant turns when the task is actually scene-state extraction;
- users may feel pressure to tune prompts around role labels even when they only want the model to summarize content changes;
- the feature request is fundamentally about lowering the model's "mental load" so tracker generation can focus on content rather than dialogue ownership.

This is especially plausible for tracker generation because zTracker is not asking the model to continue the scene. It is asking the model to interpret the scene and produce structured state.

## Current behavior (verified)

### Tracker-generation prompt flow today

The current tracker-generation path is:

1. `prepareTrackerGeneration()` in `src/ui/tracker-actions.ts` calls `buildPrompt(...)` to get the recent prompt messages for the selected API.
2. The result is passed through `includeZTrackerMessages(...)` from `src/tracker.ts`, which can inject prior tracker snapshots into that message list.
3. Optional allowlisted World Info is inserted as a `system` message.
4. `requestStructuredTrackerContent()` appends the final tracker-generation instruction as a trailing `system` message.
5. `makeRequestFactory()` calls `sanitizeMessagesForGeneration(...)` before the request is sent.
6. For `textgenerationwebui`, the sanitized messages are also passed through the special text-completion prompt-construction path so instruct formatting can still happen.

### Role behavior today

- Dialogue turns keep the roles produced by `buildPrompt()`.
- `sanitizeMessagesForGeneration()` preserves those roles and only strips metadata.
- For text-completion APIs, `sanitizeMessagesForGeneration(..., { inlineNamesIntoContent: true })` prefixes assistant/user turns with speaker names when available, but it does not rewrite roles.
- Tracker-generation instructions are already appended as `system` messages for both Native and prompt-engineered modes.
- The text-completion path may inject a synthetic user-alignment message from SillyTavern's active instruct settings when the prompt would otherwise begin with an assistant turn. That synthetic message is not chat content; it is host-level prompt scaffolding.

### Existing UX constraints

The tracker-generation settings live in the `Tracker Generation` section, currently split across:

- `GenerationBehaviorSection.tsx`
- `SystemPromptSettingsSection.tsx`
- `GenerationPromptTemplatesSection.tsx`
- `WorldInfoPolicySection.tsx`

There is already an injection-only role setting, `embedZTrackerRole`, exposed in `TrackerInjectionSection.tsx` as `Embed zTracker snapshots as`.

Codebase verification shows that this existing injection role setting must not be reused for the new feature:

- the UI copy describes it as affecting normal-generation injection only;
- the user request is specifically about tracker generation;
- `includeZTrackerMessages(...)` is shared by both tracker generation and `generate_interceptor`, so piggybacking on that setting would make the UX harder to reason about.

The new feature therefore needs its own tracker-generation-local setting and its own normalization step.

## Problem framing

There are two distinct questions here:

1. Should tracker generation preserve the original user/assistant split?
2. If not, where should normalization happen so the behavior is explicit and reversible?

The answer should favor a low-risk, easy-to-understand UX:

- preserve the current behavior by default;
- add one clearly named tracker-generation option;
- normalize only tracker-generation chat turns, not the whole extension;
- keep the feature orthogonal to prompt engineering, injection, and system-prompt selection.

## Goals

- Add a tracker-generation-only mode that rewrites user and assistant chat turns to `assistant` before the request is sent.
- Keep the default behavior unchanged for existing users.
- Make the feature understandable from the settings UI without requiring knowledge of OpenAI-style role semantics.
- Keep system prompts and tracker-generation instructions clearly separated from normalized dialogue turns.
- Apply the mode consistently across Native, JSON, XML, and TOON tracker generation.
- Apply the mode consistently across text-completion and chat-completion request paths.

## Non-goals

- Changing how normal chat generations work.
- Changing `generate_interceptor` behavior.
- Reusing or redefining the existing tracker-injection role setting.
- Rewriting saved chat history or message metadata.
- Changing how tracker snapshots are rendered above messages.
- Redesigning prompt-engineering templates.

## Decisions (closed)

- Use a task-focused setting label rather than foregrounding `assistant` in the main control label.
- Keep prior embedded tracker snapshot roles unchanged in the initial version; this feature only normalizes real chat turns.
- Keep the feature intentionally narrow and only add the requested `all_assistant` mode for now.

## Proposed UX

### Setting location

Add the new control to `Tracker Generation`, inside `GenerationBehaviorSection.tsx`, close to the existing context-window controls (`Include Last X Messages`, `Skip character card in tracker generation`).

This keeps the feature near the other settings that shape the tracker-generation input rather than the output format.

### Setting shape

Use a select, not a checkbox.

Chosen label direction:

`Conversation role handling`

Chosen options:

- `Preserve user and assistant roles` (default)
- `Treat all chat turns as assistant`

Reasoning:

- a select leaves room for future modes without another UI migration;
- "conversation role handling" describes the user-facing intent better than a low-level name like "message role normalization";
- "Treat all chat turns as assistant" is explicit about the effect and avoids vague wording like "simplify roles".

### Help text / tooltip

Recommended tooltip copy:

"Controls how recent chat messages are labeled during tracker generation. This only affects zTracker's tracker request, not normal chat generation or tracker injection."

Optional helper text when the non-default mode is selected:

"Useful when the model should focus on scene content rather than who said it. System prompts and tracker instructions stay separate."

This keeps the main control task-focused while leaving the more technical `assistant` detail in the option text and tooltip.

### Defaults

- Default to `Preserve user and assistant roles`.
- Do not auto-migrate existing users to the new mode.

This is a behavioral change with prompt-quality tradeoffs, not a correctness fix, so opt-in is the safer UX.

## Detailed design

### New setting

Add a new tracker-generation setting in `src/config.ts`.

Recommended shape:

```ts
export type TrackerGenerationConversationRoleMode = 'preserve' | 'all_assistant';
```

And in `ExtensionSettings`:

```ts
trackerGenerationConversationRoleMode: TrackerGenerationConversationRoleMode;
```

Default:

```ts
trackerGenerationConversationRoleMode: 'preserve';
```

### Normalization scope

Normalize only real conversation turns used for tracker generation:

- rewrite `user` to `assistant`;
- keep `assistant` as `assistant`;
- leave `system` untouched.
- leave previously embedded tracker snapshot roles unchanged.

This keeps the feature focused on the user-vs-assistant weighting problem that motivated the request.

### Placement in the request pipeline

Apply the normalization during tracker-generation prompt assembly, after the base prompt messages have been collected and any tracker snapshots / allowlisted World Info have been inserted, but before the request is sanitized and sent.

This gives one shared normalization point for:

- Native structured generation;
- prompt-engineered generation;
- text-completion prompt construction;
- chat-completion request payloads.

The preferred implementation shape is a small helper near the existing prompt-message helpers in `src/tracker.ts`, then call it from `prepareTrackerGeneration()` in `src/ui/tracker-actions.ts`.

### Naming and speaker attribution

Role normalization must not remove speaker names.

- For chat-completion paths, keep the existing `name` field behavior unchanged where already supported.
- For text-completion paths, keep the current `inlineNamesIntoContent: true` behavior so normalized assistant turns still render as `Bar: ...` / `Tobias: ...` in the flattened prompt.

This preserves attribution while reducing role-based weighting.

### Synthetic text-completion alignment turn

Do not change the existing user-alignment-message behavior in `sanitizeMessagesForGeneration()`.

That alignment message is SillyTavern prompt scaffolding for instruct-mode text completion, not scene dialogue. It may still appear as a `user` turn even when conversation-role handling is set to `all_assistant`.

This is acceptable and should be documented in tests so the behavior is explicit rather than surprising.

### System-role boundaries

For the initial version, keep these behaviors unchanged:

- tracker system prompt selection remains controlled by `trackerSystemPromptMode`;
- allowlisted World Info remains inserted as `system`;
- the final tracker instruction / prompt-engineering instruction remains a trailing `system` message.

This keeps the feature targeted and avoids turning it into a broader system-message redesign.

### Future extensibility

Although the UI should use a select, the initial implementation should only expose the two modes already defined in this spec:

- `preserve`
- `all_assistant`

The select is justified as a low-cost UX hedge, not as a commitment to add more modes immediately.

## Acceptance criteria

- A new tracker-generation setting exists for conversation role handling.
- The default preserves current behavior.
- When `all_assistant` is selected, tracker-generation dialogue turns are sent as `assistant` regardless of whether the original turn was user or assistant.
- Existing system prompts, World Info injections, and final tracker instructions remain `system` messages.
- Speaker attribution is still preserved.
- Native, JSON, XML, and TOON tracker generation all use the same normalized-role behavior.
- `generate_interceptor` and normal chat generations are unchanged.

## Codebase verification

### Files likely to change when implemented

| File | Reason |
|---|---|
| `src/config.ts` | Add the new setting type, stored field, and default. |
| `src/components/settings/GenerationBehaviorSection.tsx` | Add the new user-facing control in Tracker Generation. |
| `src/tracker.ts` | Add a small helper that rewrites tracker-generation conversation roles without stripping names. |
| `src/ui/tracker-actions.ts` | Call the helper in the tracker-generation prompt-assembly flow. |
| `src/__tests__/tracker-include.test.ts` or a nearby helper-focused test file | Cover role normalization behavior directly. |
| `src/__tests__/tracker-actions.prompt-assembly.test.ts` | Verify the setting changes outgoing tracker-generation message roles without affecting system messages. |

### Files verified as relevant but not expected to own the feature

| File | Reason |
|---|---|
| `src/components/settings/TrackerInjectionSection.tsx` | Existing injection-role UX is separate and should remain separate. |
| `src/ui/prompt-engineering.ts` | Prompt-engineering instructions are already appended as `system`; this feature should not change template logic. |
| `src/system-prompt.ts` | System-prompt selection is already isolated and should remain unchanged. |

## Validation plan

When this is implemented:

1. Add unit coverage for the role-normalization helper itself.
2. Add prompt-assembly tests that verify `user -> assistant` rewriting in tracker generation.
3. Verify system messages remain system messages.
4. Verify text-completion prompt assembly still preserves speaker prefixes and the user-alignment message behavior.
5. Run `npm test`.
6. Run `npm run build`.

## Verification

- Added the new tracker-generation setting and default in `src/config.ts`.
- Added the settings UI control in `src/components/settings/GenerationBehaviorSection.tsx`.
- Added a tracker-generation role-normalization helper in `src/tracker.ts` and applied it in `prepareTrackerGeneration()` inside `src/ui/tracker-actions.ts`.
- Added helper-level and prompt-assembly tests for both chat-completion and text-completion paths.
- Validation completed with `npm test` and `npm run build`.

