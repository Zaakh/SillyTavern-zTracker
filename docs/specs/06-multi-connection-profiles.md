# Spec: Multiple connection profiles support

Status: Open
Last updated: 2026-01-21

## Goal
Support multiple connection profiles in zTracker.

## Open questions to clarify first
1. What does “support multiple profiles” mean?
   - A) Fallback list (try in order until success)
   - B) Rules-based selection (based on API type/model/schema)
   - C) Multi-output (generate multiple trackers) — likely too complex initially
2. What counts as a “failure” that triggers fallback?
   - structured output returns `{}`
   - request errors
   - parse failures (JSON/XML)
   - template render failures
3. UX:
   - Should the UI show which profile succeeded?
   - Should we expose per-profile settings (max tokens, prompt mode), or keep them global?
4. Performance:
   - Should we stop after the first success (recommended), or try multiple anyway?

## Proposed initial design (fallback list)
- Settings:
  - Replace single `profileId` with ordered list `profileIds: string[]`.
- UI:
  - Multi-select connection profiles + reorder.
- Runtime:
  - Try each profile in order until one produces a usable tracker.
  - Provide clear feedback when all fail.

## Acceptance criteria
- User can configure >1 connection profile.
- On generation:
  - zTracker tries profiles in configured order.
  - On first success, it stops and uses that result.
  - If all fail, it reports an actionable error.
- Abort/cancel works cleanly.

## Tasks checklist
- [ ] Decide “multiple profiles” semantics
- [ ] Define failure detection rules
- [ ] Implement settings model + migration
- [ ] Implement UI
- [ ] Implement generation fallback logic
- [ ] Add tests for selection/fallback behavior
