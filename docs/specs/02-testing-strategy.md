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

## Proposed approach

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
- Document how to run tests locally and what is being mocked.

## Tasks checklist
- [ ] Decide unit vs E2E scope
- [ ] Add test folder structure and helpers
- [ ] Add unit tests (parser/schema/injection)
- [ ] Add jsdom tests (render)
- [ ] Decide on schema validation library (optional)
- [ ] Add CI workflow (optional)
