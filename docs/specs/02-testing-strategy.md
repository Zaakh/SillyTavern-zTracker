# Spec: Testing strategy (unit + integration)

Status: Completed
Last updated: 2026-01-21

## Goal
Add unit and integration tests that catch regressions while remaining realistic for a **SillyTavern UI extension**.

## Scope
- Unit tests for pure logic.
- “Integration-ish” tests for DOM rendering behavior.
- Optional E2E test harness research (may be deferred).

## Open questions to clarify first
1. What level of test automation do we want?
   - Unit + jsdom only (fast) vs also Playwright E2E (heavier but closer to real).
2. What CI environment is expected?
   - GitHub Actions? Windows-only? cross-platform?
3. Are we willing to refactor `src/index.tsx` to isolate logic from side effects at import time?
   - This is usually required to test reliably.
4. Should we validate tracker outputs against schema?
   - If yes, which library (Ajv, Zod, etc.)?

## Clarified decisions

### Phase 1 (baseline)
- Automation: Unit + jsdom only. Defer Playwright until basics are stable.
- CI: Windows-only (for now).
- Refactor: Yes — isolate testable logic away from `src/index.tsx` import-time side effects.
- Schema validation: Defer (no Ajv/Zod in baseline).

### Phase 2 (advanced / optional)
- Add Playwright E2E harness once unit/jsdom tests are reliable.
- Consider JSON Schema validation (Ajv) if we want stricter guarantees.

## Proposed approach

### Phase 1 (baseline)
- ✅ Refactor entrypoint: move pure/pure-ish logic into import-safe modules (`src/tracker.ts`, `src/extension-metadata.ts`).
- ✅ Unit tests in Node for pure logic (`parser`, `schema-to-example`, tracker injection helpers).
- ✅ Integration-ish tests in jsdom for DOM rendering behavior (`renderTracker`).
- ✅ Document how to run tests + describe mock/stub expectations (see `docs/SILLYTAVERN_DEV_NOTES.md`).

### Why “minimal first” is intentional
For a SillyTavern UI extension, full-stack E2E is comparatively expensive and brittle because the host app/runtime is outside this repo’s control.
The baseline strategy follows common guidance (test pyramid / testing trophy): prioritize fast, deterministic tests for the logic we own, and add a small number of broader tests only where they buy unique confidence.

### jsdom limitations (important)
jsdom is an approximation of a browser environment. It is suitable for verifying DOM insertion/removal and basic event behavior, but it will not reliably catch:
- Layout/CSS rendering issues (no real layout engine)
- Browser-specific API differences and timing quirks
- Host-app integration issues that depend on SillyTavern’s real DOM structure and event lifecycle

### Coverage map (Phase 1)
**Covered:**
- Parsing (JSON/XML fenced block extraction, invalid input behavior)
- Schema-to-example generation
- Snapshot injection logic (`includeZTrackerMessages`)
- DOM helper behavior for tracker rendering (`renderTracker`)

**Not covered (known gaps):**
- Full extension boot (`src/index.tsx`) and wiring (event handlers, interceptor registration)
- Real SillyTavern DOM/CSS compatibility (selectors, placement within actual message markup)
- Real API/generation flows (Generator/buildPrompt) and network behaviors
These are deferred to Phase 2 and/or targeted integration tests.

### Unit tests (Node)
Test pure or near-pure modules:
- Parsing: JSON/XML fenced block parsing and error behavior.
- Schema-to-example generation.
- Tracker snapshot injection logic (how many, ordering, non-duplication).

### Integration-ish tests (jsdom)
- `renderTracker` behavior: when extra data exists, DOM elements appear; when deleted, DOM is removed.
- Handlebars strict rendering failure behavior (should fail fast and not save bad data).

Implementation note: strict rendering failure is enforced via a small rollback helper (`applyTrackerUpdateAndRender`) which updates message data, attempts render, and restores the prior state if rendering throws.

### Optional E2E (research)
- Playwright to boot a local SillyTavern instance with extension mounted.
- Verify minimal smoke flow: load chat → click tracker button → tracker renders.

## Research items
- Best way to stub/mimic `SillyTavern.getContext()` + `eventSource` + `Popup` in tests.
- Whether `sillytavern-utils-lib` provides testing utilities or stable mocks.

## Acceptance criteria
- `npm test` passes reliably on Windows.
- Minimum coverage:
  - parser tests
  - schema-to-example tests
  - snapshot injection tests
  - at least one jsdom render test
- Document how to run tests locally and what is being mocked. ➜ **Pending:** add README/docs blurb summarizing `npm test`, SillyTavern stubs, and what jsdom covers.
- Document how to run tests locally and what is being mocked. (See `docs/SILLYTAVERN_DEV_NOTES.md` → "Testing workflow".)

## Phase 2 triggers (when to add Playwright)
Add Playwright only after Phase 1 is stable and we have a repeatable harness. Concrete triggers:
- Phase 1 suite is stable (no flaky failures) across several iterations/releases
- A documented local setup exists to boot SillyTavern with the extension mounted
- We can identify stable selectors/locators for the extension UI (avoid brittle DOM assumptions)

When added, keep E2E minimal: 1–2 smoke tests for critical user flows (extension loads, tracker renders; optional edit/delete/regenerate).

## Notes
- `src/index.tsx` has import-time side effects (SillyTavern context access, generator creation, UI boot). Tests should avoid importing the entrypoint.
- jsdom tests should exercise isolated DOM helpers rather than the full extension boot.

## Tasks checklist
- [x] Decide unit vs E2E scope (Phase 1: unit + jsdom only; defer Playwright)
- [x] Add test folder structure and helpers
- [x] Add unit tests (parser/schema/injection)
- [x] Add jsdom tests (render)
- [x] Decide on schema validation library (optional) (defer)
- [ ] Add CI workflow (optional, Windows-only)
- [x] Document local test workflow + mocking approach
