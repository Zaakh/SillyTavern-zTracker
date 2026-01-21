# Spec: Entrypoint wiring tests (SillyTavern integration)

Status: Open
Last updated: 2026-01-21

## Goal
Add "host-integration" tests that verify `src/index.tsx` wires zTracker into SillyTavern correctly.

These tests are meant to catch regressions in:
- event listener registration
- generate interceptor registration
- DOM selector assumptions for attaching UI

This spec intentionally stays below full E2E (no real SillyTavern process/browser required), but goes beyond pure jsdom helper tests by validating the entrypoint’s integration points.

## Background
Phase 1 tests focus on deterministic modules we own (`parser`, `schema-to-example`, `tracker` helpers). However, `src/index.tsx` contains host wiring and import-time side effects. Breakages here are common when:
- SillyTavern changes DOM structure/IDs
- event names/registration APIs change
- the interceptor global name changes or isn’t registered

## Scope (Phase 1.5 / bridging)

### In scope
1. **Event listener wiring**
   - Verify `eventSource.on(...)` is called for the expected SillyTavern events.
   - Verify handlers call `generateTracker(messageId)` when appropriate.

2. **Generate interceptor registration**
   - Verify the global interceptor function is registered (e.g. `globalThis.ztrackerGenerateInterceptor`).
   - Verify it mutates the provided chat prompt as expected (inserts tracker snapshots) without crashing.

3. **DOM selector assumptions (smoke)**
   - Verify UI initialization attempts to attach:
     - message button icon into `#message_template .mes_buttons .extraMesButtons`
     - extension menu content into `#extensionsMenu`
   - These tests are *smoke tests*: they verify "doesn’t silently no-op" and "doesn’t throw" when required nodes exist.

### Out of scope
- Running a real SillyTavern instance.
- Full browser rendering/CSS/layout validation.
- Network/API generation flows (`Generator`, `buildPrompt`) beyond verifying the wiring calls.
- Verifying the visual correctness of injected HTML.

## Proposed approach

### Test harness
- Use Jest + jsdom.
- Provide a **minimal fake** `globalThis.SillyTavern.getContext()` object:
  - `eventSource.on` as a spy
  - `chat`, `saveChat`, `renderExtensionTemplateAsync`, `callGenericPopup`, `Popup.show.confirm` as no-op/mocks
  - minimal `extensionSettings` needed by `generateTracker` guardrails
- Provide minimal DOM scaffolding for required selectors.

### Import strategy (important)
Because `src/index.tsx` executes at import time, each test must:
1. Set up `globalThis.SillyTavern` and required DOM nodes
2. Dynamically import the entrypoint (so side effects run)
3. Assert that wiring was performed

To keep tests stable, this likely requires one or more small refactors:
- export an explicit `main()` or `initialize()` function from `src/index.tsx`, and have the file call it only in production, OR
- keep import-side effects but guard them behind `if (globalThis.SillyTavern)` and allow tests to control execution.

## Acceptance criteria
- A new test suite validates:
  - expected `eventSource.on` registrations are made
  - `globalThis.ztrackerGenerateInterceptor` is defined and callable
  - UI initialization touches expected selectors without throwing
- Tests run reliably via `npm test` on Windows.

## Tasks checklist
- [ ] Decide whether to refactor entrypoint for testability (preferred)
- [ ] Add a `SillyTavern` context mock helper for wiring tests
- [ ] Add jsdom DOM scaffolding helpers for required selectors
- [ ] Add tests for event wiring
- [ ] Add tests for interceptor registration and basic behavior
- [ ] Add tests for DOM selector smoke
- [ ] Document what is mocked and why
