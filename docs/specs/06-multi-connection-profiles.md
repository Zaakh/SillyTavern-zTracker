# Spec: Multiple connection profiles support

Status: Completed
Last updated: 2026-01-23

## Goal
Support multiple connection profiles in zTracker.

Note: Closed as "not needed" — current single-profile selection is sufficient.

## Current behavior (today)
- zTracker already supports selecting **one** connection profile in settings.
- The selected profile is persisted as `profileId: string`.
- If `profileId` is empty, generation fails with an actionable error (it does **not** silently reuse a default profile).

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
  - Extend existing `profileId` into ordered list `profileIds: string[]`.
  - Migration: if legacy `profileId` is set and `profileIds` is empty, initialize `profileIds = [profileId]`.
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
- [x] Decide “multiple profiles” semantics (no longer needed)
- [x] Define failure detection rules (no longer needed)
- [x] Implement settings model + migration (no longer needed)
- [x] Implement UI (no longer needed)
- [x] Implement generation fallback logic (no longer needed)
- [x] Add tests for selection/fallback behavior (no longer needed)
