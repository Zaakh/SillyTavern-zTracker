# Spec: Tracker snapshot injection into LLM context (configurable)

Status: Open
Last updated: 2026-01-21

## Goal
Ensure existing tracker data is reliably added to the prompt context for LLM calls, and provide a UI option to control how many prior tracker snapshots are injected.

## Current behavior (baseline)
- Tracker snapshots are injected by:
  - the tracker generation flow, and
  - a `generate_interceptor` that modifies outgoing generation chat arrays.
- There is already a setting similar to `includeLastXWTrackerMessages`.

## Open questions to clarify first
1. Scope: which generations should receive tracker injection?
   - Only zTracker’s own generation requests, or *all* SillyTavern generations via interceptor?
2. Semantics:
   - `0` should mean “none”, but do we also want an “all” option?
3. Message formatting:
   - Should injected tracker be JSON fenced code blocks (current approach) or a shorter/structured system message?
4. Deduplication:
   - Should we include the most recent tracker even if it belongs to the immediately previous message?
5. Safety:
   - Should we cap injected snapshots by token estimate or hard limit?

## Proposed behavior
- Setting name (TBD): `includeLastXTrackerSnapshots`
  - `0`: none
  - `N>0`: include up to N most recent snapshots, oldest → newest
- Injection content format:
  - Stable and easy to parse by the model:
    - `Tracker:\n```json\n{...}\n````

## Acceptance criteria
- UI control exists and persists.
- Interceptor and internal generation path both honor the same setting.
- When configured to `N`, exactly up to `N` snapshots are injected.
- Cancellation and regeneration flows still behave correctly.

## Tasks checklist
- [ ] Decide injection scope (interceptor-only vs both)
- [ ] Decide semantics (0/All/Cap)
- [ ] Implement setting + UI
- [ ] Ensure interceptor uses latest settings at runtime
- [ ] Add tests for snapshot insertion logic
