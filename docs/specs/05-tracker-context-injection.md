# Spec: Tracker snapshot injection into LLM context (configurable)

Status: Completed
Last updated: 2026-01-23

## Goal
Ensure existing tracker data is reliably added to the prompt context for LLM calls, and provide a UI option to control how many prior tracker snapshots are injected.

## Current behavior (baseline)
- Tracker snapshots are injected by:
  - the tracker generation flow, and
  - a `generate_interceptor` that modifies outgoing generation chat arrays.
- There is already a setting similar to `includeLastXzTrackerMessages`.

## Current implementation (verified)

### Scope
- Injection applies to:
   - zTracker’s own tracker generation prompt-building flow, and
   - all SillyTavern generations routed through the global interceptor hook.

### Setting semantics
- Implemented setting name: `includeLastXZTrackerMessages`
   - `0`: none
   - `N > 0`: inject up to N distinct tracker snapshots found in the chat
- There is no explicit “all snapshots” sentinel; users can approximate this by choosing a large N.

### Message formatting
- Injected content is a user message:
   - `Tracker:\n```json\n{...}\n````

### Selection / ordering / deduplication
- Snapshots are discovered by scanning backwards through the chat and selecting messages that contain tracker data.
- The implementation avoids reusing the same tracker-bearing message more than once per injection pass.
- Each injected snapshot is inserted immediately after the message it was discovered on (so snapshots appear near their original point in history).
- The most recent message in the array is intentionally skipped during discovery, so we don’t inject a snapshot from the message currently being generated/sent.

### Safety / caps
- There is no token-estimate cap or hard truncation logic beyond the user-configured N.

## Decisions (closed)
1. Scope: both (zTracker generation + global interceptor)
2. Semantics: `0 = none`, `N > 0 = up to N`; no dedicated “all” option for now
3. Formatting: JSON fenced code block (current approach)
4. Deduplication: do not repeat the same tracker-bearing message within one injection operation; do not include the snapshot from the most recent message being processed
5. Safety: no token cap yet (defer until needed)

## Proposed behavior
Implemented as described above.

## Acceptance criteria
- UI control exists and persists.
- Interceptor and internal generation path both honor the same setting.
- When configured to `N`, exactly up to `N` snapshots are injected.
- Cancellation and regeneration flows still behave correctly.

## Tasks checklist
- [x] Decide injection scope (interceptor-only vs both)
- [x] Decide semantics (0/All/Cap)
- [x] Implement setting + UI
- [x] Ensure interceptor uses latest settings at runtime
- [x] Add tests for snapshot insertion logic

