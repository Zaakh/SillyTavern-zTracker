# Spec: Virtual character for tracker snapshot injection

Status: Open
Last updated: 2026-04-13

## Summary

Add an opt-in checkbox that makes embedded tracker snapshots appear as turns from a **virtual character** instead of using the selected role with a redundant header. The character name is derived from the existing `embedZTrackerSnapshotHeader` setting (default `"Tracker:"`), producing clean speaker attribution (e.g. `Tracker:`) rather than confusing composites like `[INST]Assistant: Tracker:`.

## Motivation

When zTracker embeds tracker snapshots into the generation chat array via the `generate_interceptor`, the injected message is assigned one of the three standard roles (`user`, `assistant`, `system`). SillyTavern's prompt assembly then wraps that message with role-specific formatting:

- **Instruct mode** adds prefix/suffix sequences (e.g. `[INST]` / `[/INST]`) and may prepend the speaking character's name via `formatInstructModeChat()` depending on the `names_behavior` setting.
- **Chat Completion mode** sets the `role` field and may prepend the character name into `content` or set a `name` property on the API message (depending on `names_behavior`).

This leads to confusing prompt constructs, especially in instruct mode:

| Selected role | Resulting prompt fragment (typical) |
|---|---|
| `assistant` | `[output_sequence]\nAssistant: Tracker:\n\`\`\`json ...` |
| `user` | `[input_sequence]\nUser: Tracker:\n\`\`\`json ...` |
| `system` | `[system_sequence]\nTracker:\n\`\`\`json ...` |

The redundant role label preceding the tracker header is noise. For smaller models (≤ 12 B parameters) this double-labelling can actively confuse the model about who is "speaking" and what the tracker content represents, because the model may interpret `Assistant: Tracker:` as the assistant *talking about* a tracker rather than an authoritative data injection.

A virtual character avoids the collision: the injected message carries its own speaker identity (the tracker label) via the `name` field, and SillyTavern uses that name for attribution instead of appending a separate header.

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

The injected message does **not** set a `name` field today.

### Header

`embedZTrackerSnapshotHeader` (default `"Tracker:"`) is prepended to the message content as a text prefix.

## Upstream SillyTavern behavior (verified against 1.17 source)

### Instruct mode (Text Completion)

`formatInstructModeChat(name, mes, isUser, isNarrator, ...)` in `instruct-mode.js`:

- The `name` parameter comes from the message's `.name` field in the chat array.
- When `names_behavior` is `ALWAYS` (or `FORCE` for groups), the output is: `[prefix_sequence]\n${name}: ${content}\n[suffix_sequence]`.
- When `names_behavior` is `NONE`, no name is prepended.
- The **role** determines which prefix/suffix sequences are used:
  - `user` → `input_sequence` / `input_suffix`
  - `assistant` → `output_sequence` / `output_suffix`
  - `system` → `system_sequence` / `system_suffix` (often empty, or same as user if `system_same_as_user` is checked)

**Key finding**: The `name` field **replaces** the default character name in the attribution — so `{role: 'assistant', name: 'Tracker'}` produces `[output_sequence]\nTracker: content` instead of `[output_sequence]\nCharName: content`. However, the instruct prefix/suffix wrapping is **always applied** based on the role; setting `name` does not suppress it.

### Chat Completion mode

`setOpenAIMessages()` in `openai.js`:

- Always reads `const name = chat[j].name` and includes it in the message object.
- `names_behavior` controls how the name is surfaced:
  - `NONE`: name not prepended to content.
  - `DEFAULT`: name prepended for group chats and forced avatars.
  - `CONTENT`: name always prepended to content.
  - `COMPLETION`: name passed as the `name` property on the API message via `Message.setName()`.
- The `name` field is always propagated to the internal `Message` object regardless of mode.
- `ChatCompletion.getChat()` includes `name` in the output: `...(message.name && { name: message.name })`.

### API compatibility of `name` on assistant messages

- **OpenAI Chat Completions API**: Historically supported `name` on both user and assistant roles. The newer Responses API dropped it. The legacy Chat Completions API still accepts it but behaviour is model-dependent.
- **Local backends** (text-gen-webui, kobold, etc.): Receive text completion strings, not JSON messages — the `name` field is not directly sent. It only affects the text prompt via instruct-mode formatting.
- **Anthropic / Claude via proxy**: Most proxies strip or ignore unknown fields. The `name` field is unlikely to cause errors but may be silently dropped.
- **Risk**: Low. SillyTavern already sets `name` on all chat messages; an extra `name` on an injected message follows the same pattern.

## Problem statement

The standard roles cause SillyTavern's prompt formatter to add its own speaker attribution (instruct sequences, character names) *on top of* the tracker header, producing double-labelled turns that confuse models and waste tokens.

## Goals

- Add an opt-in option that sets the `name` field on injected tracker messages to the tracker label, allowing SillyTavern to use it for speaker attribution.
- When the option is active, omit the header prefix from content to avoid redundancy (the `name` field carries the label).
- Keep backward compatibility: the option is off by default; existing role behaviour is unchanged when it's off.

## Non-goals

- Creating an actual SillyTavern character card for the virtual speaker.
- Changing the content format or transform pipeline of embedded snapshots.
- Affecting the tracker *generation* prompt assembly (this spec targets the `generate_interceptor` embedding path only).
- Suppressing instruct prefix/suffix wrapping (that is role-based and outside zTracker's control).

## Detailed design

### 1. Add a new boolean setting

```ts
/** When true, set `name` on injected tracker messages to the tracker label and omit the header prefix. */
embedZTrackerAsCharacter: boolean;
```

Default: `false` (off).

This is orthogonal to `embedZTrackerRole` — the role dropdown continues to control which role the message uses (`user`, `assistant`, `system`). The checkbox controls whether the `name` field is set and the header prefix is suppressed.

### 2. Derive character name from tracker label

```ts
const label = (settings.embedZTrackerSnapshotHeader ?? DEFAULT_EMBED_SNAPSHOT_HEADER)
  .replace(/:+\s*$/, '')   // strip trailing colon(s) + whitespace
  .trim() || 'Tracker';    // fallback if empty
```

### 3. Modify `includeZTrackerMessages()` injection

When `embedZTrackerAsCharacter` is `true`:

```ts
const characterName = deriveCharacterName(settings);

copyMessages.splice(foundIndex + 1, 0, {
  content,                    // no header prefix
  role: embedRole,
  is_user: embedRole === 'user',
  is_system: embedRole === 'system',
  name: characterName,
  mes: content,
} as unknown as T);
```

When `false`, behaviour is identical to today (no `name`, header prepended to content).

### 4. Header behaviour

| `embedZTrackerAsCharacter` | `name` on message | `content` starts with |
|---|---|---|
| `false` (default) | *(not set)* | `Tracker:\n\`\`\`json ...` |
| `true` | `Tracker` | `` ```json ... `` |

The header is omitted from content because the `name` field already carries the speaker identity. Keeping it would produce `Tracker: Tracker:\n...` when SillyTavern's "Include Names" is active.

### 5. Prompt assembly implications

#### Instruct mode with `names_behavior: ALWAYS`

| Before (current) | After (checkbox on, role=assistant) |
|---|---|
| `[output_seq]\nAssistant: Tracker:\n\`\`\`json ...` | `[output_seq]\nTracker: \`\`\`json ...` |

The instruct prefix/suffix wrapping (`[output_seq]` etc.) is still applied — zTracker cannot suppress it. But the speaker name changes from the default character name to the tracker label, which is the primary improvement.

#### Instruct mode with `names_behavior: NONE`

| Before | After (checkbox on) |
|---|---|
| `[output_seq]\nTracker:\n\`\`\`json ...` | `[output_seq]\n\`\`\`json ...` |

With names disabled, the header was the only label. Enabling the checkbox removes it from content and puts it on `name`, but since names are not displayed, the tracker data becomes unlabelled. This is acceptable — the user explicitly chose both settings.

#### Chat Completion mode with `names_behavior: COMPLETION`

The `name` property is passed through to the API message:

```json
{ "role": "assistant", "name": "Tracker", "content": "```json\n{...}\n```" }
```

This is the cleanest outcome: no double-labelling, and the API receives the speaker identity natively.

#### Recommended role for virtual-character use

`system` is recommended when using this feature with instruct mode, because system sequences are often empty or neutral, avoiding the `[INST]`/`[/INST]` wrapping that `assistant` would add. The spec does not enforce a role — the user can combine the checkbox with any role.

### 6. UI change

Add a checkbox below the role dropdown in the Tracker Injection section:

```html
<label title="When enabled, the tracker label is used as the speaker name on the injected message instead of adding a header prefix. This avoids double-labelling like 'Assistant: Tracker:' in instruct mode.">
  <input type="checkbox" />
  Inject as virtual character
</label>
```

The checkbox is only meaningful when `includeLastXZTrackerMessages > 0`. It can be visually grouped with the existing role and header controls.

## Decisions (closed)

1. **UI approach**: Opt-in checkbox, not a new role value. The role dropdown stays unchanged. (User preference.)
2. **Default**: Off. Existing behaviour is preserved for upgrades and new installs.
3. **Instruct wrapping**: Cannot be suppressed by the extension — this is SillyTavern-owned behaviour. The `name` field improves speaker attribution but does not remove instruct prefix/suffix sequences.

## Remaining open questions

1. **Smoke-test**: Confirm the `name` field on injected messages produces the expected attribution in a live SillyTavern 1.17 session, for both instruct and Chat Completion mode.
2. **`names_behavior: NONE` interaction**: Should the checkbox be disabled or show a warning when names are disabled in SillyTavern? With names disabled, enabling the checkbox removes the header from content but the `name` field goes unused — the tracker data becomes unlabelled. A tooltip warning may suffice.
3. **`ignoreInstruct` as a future enhancement**: Setting `ignoreInstruct: true` on the injected message could suppress instruct prefix/suffix wrapping entirely, making the virtual character fully standalone. This is deferred — it needs upstream verification and may have side effects on prompt flow.

## Acceptance criteria

- [ ] New boolean setting `embedZTrackerAsCharacter` (default `false`).
- [ ] When enabled, injected messages carry `name` derived from the tracker label and omit the header prefix from content.
- [ ] When disabled, behaviour is identical to the current implementation.
- [ ] UI checkbox is present with a clear tooltip.
- [ ] Existing `user` / `assistant` / `system` role selection is unchanged and works with both checkbox states.
- [ ] Existing tests pass; new tests cover the virtual-character path in `includeZTrackerMessages()`.
- [ ] Smoke-tested against SillyTavern 1.17 in both instruct and Chat Completion mode.
