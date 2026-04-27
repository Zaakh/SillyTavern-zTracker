# Tracker Injection Behavior

Maintenance: Last reviewed 2026-04-27. Update when injection logic, shaping rules, or related settings change.

This document describes the current runtime contract for zTracker snapshot injection into normal chat generations. It covers the `generate_interceptor` path only; tracker-generation requests use a different prompt-assembly flow.

## Scope

The injected chat shape is primarily controlled by these settings and runtime hints:

- `includeLastXZTrackerMessages`
- `embedZTrackerRole`
- `embedZTrackerAsCharacter`
- `embedZTrackerSnapshotHeader`
- text-completion alternation safety (`preserveTextCompletionTurnAlternation`)
- host group-chat hint (`isGroupChat`)
- host-confirmed solo reply label (`assistantReplyLabel`)

## Core rules

1. zTracker injects each tracker snapshot immediately after the source message that owns that tracker unless a text-completion safety fallback requires a different shape.
2. `embedZTrackerRole` controls the injected role only for normal generations. It does not affect tracker generation.
3. `embedZTrackerAsCharacter` is best-effort, not absolute. When zTracker can keep the snapshot as a normal standalone message, it derives a speaker name from `embedZTrackerSnapshotHeader` and removes that header from the injected content. When zTracker must emit raw assistant text to preserve a valid reply cue in text-completion chats, the header stays in content and no `name` field is used.
4. Assistant-role text-completion injection has three distinct terminal behaviors:
   - standalone raw assistant text when a single-speaker reply cue is safe;
   - inline fallback into the final user turn when the terminal assistant cue would be ambiguous;
   - anchored standalone assistant insertion after the tracked source turn for mid-chat or multi-character flows.
5. zTracker prefers a host-confirmed solo reply label over history inference when SillyTavern already exposes the active assistant speaker for the current chat.

## Behavior matrix

| Context | Resulting injected shape | Virtual-character effect |
| --- | --- | --- |
| Non-text-completion chats, or non-assistant embed roles | Standalone injected message after the tracked source message | If enabled, zTracker sets `name` from the snapshot header and removes the header from `content` |
| Text completion, assistant role, tracked message is mid-chat | Standalone assistant message after the tracked source message | If enabled, zTracker uses the derived `name` and omits the header from `content` |
| Text completion, assistant role, terminal tracked user in a confirmed single-speaker solo chat | Raw assistant text block at the end of the prompt with `ignoreInstruct: true` and a synthesized real-assistant reply cue | zTracker prefers the host-confirmed solo reply label when available and otherwise falls back to prior assistant history; the tracker label stays in `content` and zTracker does not set `name` in this raw fallback |
| Text completion, assistant role, trailing empty assistant prefill already present | The prefill stays in place and zTracker appends a raw assistant text block after it | The tracker label stays in `content`; zTracker does not set `name` in this raw fallback |
| Text completion, assistant role, terminal tracked user in a group chat or otherwise ambiguous terminal case | Snapshot is inlined into the tracked user turn instead of adding a standalone assistant block | If enabled, the inline header still uses the derived tracker label as plain text |

## Current raw assistant fallback

The most confusing case is the confirmed single-speaker solo-chat fallback for assistant-role text-completion injection. zTracker cannot safely emit a normal named assistant message there because the prompt still has to end on the real assistant reply cue. When SillyTavern exposes the active solo-chat speaker, zTracker uses that host label directly; otherwise it falls back to prior assistant history. In that case zTracker emits raw assistant text shaped like this:

```text
...user turn...
Scene tracker: time: 18:30:00; 09/15/2023 (Friday)
location: Inside a bar
changes: Customer entered the bar and ordered a drink.
Bar:
```

That shape is intentional:

- `Scene tracker:` remains in content so the injected block still has a visible label.
- `Bar:` is appended as the real assistant reply cue.
- `embedZTrackerAsCharacter` does not become a standalone `name` field in this path because the raw fallback bypasses normal instruct/name formatting.

## Practical guidance

- If you want the cleanest virtual-character behavior, prefer non-terminal injection cases or non-text-completion backends.
- If you are debugging a single-speaker text-completion chat and see the tracker label inside content instead of as a separate speaker turn, check whether zTracker is in the raw assistant fallback described above.
- If you are debugging a group chat, expect zTracker to stay conservative and inline ambiguous terminal assistant snapshots into the user turn until the host confirms a safe single-speaker path.
- If you are debugging a solo chat, check the host-owned speaker label first. zTracker now prefers SillyTavern's active solo speaker when it is available and only falls back to assistant-history inference when the host does not expose one.

## References

- `src/tracker.ts` owns the injection shaping logic.
- `src/__tests__/tracker-include.test.ts` contains the helper-level regression cases for the behaviors above.
- `src/ui/ui-init.ts` passes the host hints that distinguish text-completion-safe mode, group-chat mode, and host-confirmed solo reply labels.