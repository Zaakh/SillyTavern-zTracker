# Spec: Virtual character for tracker snapshot injection

Status: Open
Last updated: 2026-04-13

## Summary

Add a new injection role option that inserts embedded tracker snapshots as a **virtual separate character** instead of reusing the standard System / Assistant / User roles. The character name is derived from the existing `embedZTrackerSnapshotHeader` setting (default `"Tracker:"`), producing clean speaker attribution (e.g. `Tracker:`) rather than confusing composites like `[INST]Assistant: Tracker:`.

## Motivation

When zTracker embeds tracker snapshots into the generation chat array via the `generate_interceptor`, the injected message is assigned one of the three standard roles (`user`, `assistant`, `system`). SillyTavern's prompt assembly then wraps that message with role-specific formatting:

- **Instruct mode** adds tokens like `[INST]` / `[/INST]` and may prepend the speaking character's name.
- **Chat Completion mode** sets the `role` field, optionally adding a `name` property.

This leads to confusing prompt constructs, especially in instruct mode:

| Selected role | Resulting prompt fragment (typical) |
|---|---|
| `assistant` | `[INST]Assistant: Tracker:\n\`\`\`json ...` |
| `user` | `User: Tracker:\n\`\`\`json ...` |
| `system` | `[System] Tracker:\n\`\`\`json ...` |

The redundant role label preceding the tracker header is noise. For smaller models (≤ 12 B parameters) this double-labelling can actively confuse the model about who is "speaking" and what the tracker content represents, because the model may interpret `Assistant: Tracker:` as the assistant *talking about* a tracker rather than an authoritative data injection.

A virtual character avoids the collision entirely: the injected message carries its own speaker identity (the tracker label) and SillyTavern formats it as a distinct turn without prepending a misleading role name.

## Current behavior (baseline)

### Setting

`embedZTrackerRole` accepts `'user' | 'assistant' | 'system'` (default `'user'`).

### Injection point

`includeZTrackerMessages()` in `src/tracker.ts` splices a synthetic message into the cloned chat array:

```ts
copyMessages.splice(foundIndex + 1, 0, {
  content,
  role: embedRole,
  is_user: embedRole === 'user',
  is_system: embedRole === 'system',
  mes: content,
} as unknown as T);
```

### Header

`embedZTrackerSnapshotHeader` (default `"Tracker:"`) is prepended to the message content as a text prefix.

## Problem statement

The standard roles cause SillyTavern's prompt formatter to add its own speaker attribution (role tokens, character names) *on top of* the tracker header, producing double-labelled turns that confuse models and waste tokens.

## Goals

- Introduce a fourth injection option that makes the tracker snapshot appear as a turn from a **virtual character** whose name matches the tracker label.
- Eliminate the double-labelling problem by letting SillyTavern handle speaker attribution through the character name rather than a standard role.
- Keep backward compatibility: existing `user` / `assistant` / `system` choices continue to work unchanged.

## Non-goals

- Creating an actual SillyTavern character card for the virtual speaker.
- Changing the content format or transform pipeline of embedded snapshots.
- Affecting the tracker *generation* prompt assembly (this spec targets the `generate_interceptor` embedding path only).
- Changing how the header text is rendered inside the message content.

## Detailed design

### 1. Extend `embedZTrackerRole` with a new value

Add `'character'` to the union:

```ts
embedZTrackerRole: 'user' | 'assistant' | 'system' | 'character';
```

When `'character'` is selected, the injected message should:

- Use `role: 'assistant'` as the underlying transport role (assistant is the closest semantic match for an authoritative non-user speaker; SillyTavern also uses assistant-role for character turns).
- Set `name` to the sanitised tracker label derived from `embedZTrackerSnapshotHeader` (stripped of trailing colon / whitespace).
- Omit the header prefix from `content` — the speaker name already carries that information, so repeating it inside the message body would re-introduce redundancy.
- Set `is_user: false`, `is_system: false`.

### 2. Derive character name from tracker label

```
label = (settings.embedZTrackerSnapshotHeader ?? DEFAULT_EMBED_SNAPSHOT_HEADER)
          .replace(/:+\s*$/, '')   // strip trailing colon(s) + whitespace
          .trim()
```

Fallback to `'Tracker'` if the result is empty.

### 3. Prompt assembly expectations

SillyTavern's instruct-mode formatter uses the `name` field on a message to emit speaker attribution. A message like:

```json
{ "role": "assistant", "name": "Tracker", "content": "```json\n{...}\n```" }
```

should render in the prompt as:

```
Tracker: ```json
{...}
```
```

This avoids the `[INST]Assistant:` wrapper because the message carries an explicit speaker name that overrides the default role label.

> **Open question A**: Verify that SillyTavern's instruct formatter actually respects `name` on assistant-role messages and uses it as the speaker label instead of the default assistant name. If not, an alternative approach (e.g. using a custom role string or `ignoreInstruct` flag) may be needed.

> **Open question B**: In Chat Completion mode (OpenAI-style API), the `name` field in the `messages` array is passed through to the API. Confirm that the target APIs (OpenAI, Anthropic via proxy, local backends) handle a `name` on assistant messages gracefully or ignore it.

### 4. UI change

Add a fourth option to the role dropdown in Settings:

```html
<option value="character">Character (use tracker label)</option>
```

Update the tooltip to explain that this option makes the tracker appear as a virtual speaker.

### 5. Header behaviour when `character` is selected

When `embedZTrackerRole === 'character'`, the header prefix is **not** prepended to `content` (the speaker name replaces it). This keeps the injected turn clean:

| Role | `name` | `content` starts with |
|---|---|---|
| `user` / `assistant` / `system` | *(not set)* | `Tracker:\n\`\`\`json ...` |
| `character` | `Tracker` | `` ```json ... `` |

If the user has cleared `embedZTrackerSnapshotHeader` to an empty string, the character name falls back to `'Tracker'` and the content has no header (same as today for empty headers).

## Open questions

1. **Instruct-mode name support** (Question A above): Does SillyTavern's instruct formatter use the `name` field on non-user messages as speaker attribution? Needs verification against SillyTavern 1.17.
2. **API compatibility** (Question B above): Do all supported backend APIs tolerate a `name` field on assistant-role messages?
3. **Default**: Should `'character'` become the new default for fresh installs, or should `'user'` remain the default for backward compatibility?

## Acceptance criteria

- [ ] `embedZTrackerRole` type union includes `'character'`.
- [ ] When `'character'` is selected, injected messages carry `name` derived from the tracker label and omit the header prefix from content.
- [ ] Existing `user` / `assistant` / `system` behaviour is unchanged.
- [ ] UI dropdown shows the new option with a clear explanation.
- [ ] Works correctly in instruct mode (speaker attribution is the tracker label, not "Assistant").
- [ ] Works correctly in Chat Completion mode (message is accepted by the API).
- [ ] Existing tests pass; new tests cover the `'character'` path in `includeZTrackerMessages()`.
- [ ] Smoke-tested against SillyTavern 1.17 in both instruct and Chat Completion mode.
