# Spec: Testing strategy (unit + integration)

Status: Open
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
- ☐ Add docs for how to run tests + describe mock/stub expectations.

### Unit tests (Node)
Test pure or near-pure modules:
- Parsing: JSON/XML fenced block parsing and error behavior.
- Schema-to-example generation.
- Tracker snapshot injection logic (how many, ordering, non-duplication).

### Integration-ish tests (jsdom)
- `renderTracker` behavior: when extra data exists, DOM elements appear; when deleted, DOM is removed.
- Handlebars strict rendering failure behavior (should fail fast and not save bad data).

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
