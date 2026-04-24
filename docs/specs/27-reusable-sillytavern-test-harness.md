# Spec: Reusable SillyTavern test harness

Status: Open
Last updated: 2026-04-24

## Summary

Add a small, reusable test harness for SillyTavern host behavior so tests can share the same fake runtime primitives instead of rebuilding partial mocks in each suite.

This spec complements:

- `02-testing-strategy.md` by filling the remaining host-integration gap.
- `02-B-entrypoint-wiring-tests.md` by defining the reusable harness that those wiring tests need.

The goal is not to emulate all of SillyTavern. The goal is to provide a narrow, explicit, repo-local harness for the host behaviors that zTracker actually depends on.

## Motivation

The current test suite is strong for import-safe logic and moderately strong for jsdom UI behavior, but it is uneven at the host boundary.

What we already have:

- Pure and near-pure logic tests for parser, schema helpers, tracker injection, cleanup logic, and rendering.
- A good shared helper for `createTrackerActions()` tests in `src/test-utils/tracker-actions-test-helpers.ts`.
- Targeted jsdom tests for `ui-init` behavior.

What is still missing:

- No general-purpose fake SillyTavern runtime for UI/init/wiring tests.
- No shared event-source harness that records registrations and triggers handlers consistently.
- No shared DOM scaffold for common host nodes such as extension settings containers, extension menus, and message-template anchors.
- No small entrypoint boot helper that can validate initialization without importing arbitrary side effects into each test manually.
- No single place documenting which parts of SillyTavern are intentionally mocked and which are out of scope.

The result is that tracker-actions tests are reusable, while adjacent host-integration tests still assemble local one-off mocks. That increases duplication and makes future host-wiring tests harder to add.

## Current state (baseline)

### Existing reusable piece

`src/test-utils/tracker-actions-test-helpers.ts` already provides a useful harness for tracker-generation tests:

- shared `jest.unstable_mockModule(...)` setup for internal modules and `sillytavern-utils-lib`
- `makeContext()` for a minimal installed `SillyTavern.getContext()` shape
- `installSillyTavernContext()` to attach the fake host global
- shared prompt/generator mocks and reset helpers

This is worth keeping.

### Current gaps

#### 1. Host runtime coverage is slice-specific

The existing helper is tuned for tracker-actions tests. It does not cover host behavior needed by broader UI/init/boot tests, such as:

- event registration inspection
- deterministic event triggering
- extension menu/settings DOM scaffolding
- message-template attachment scaffolding
- common host methods like `renderExtensionTemplateAsync`, `saveSettingsDebounced`, `saveMetadata`, and `Popup.show.*`

#### 2. UI/init tests still build local ad hoc hosts

`src/__tests__/ui-init.test.ts` and `src/__tests__/ui-init.auto-mode-exclusion.test.ts` create their own handler maps, local `globalThis.SillyTavern` stubs, and DOM setup instead of sharing a common host harness.

That is manageable for a few suites, but it does not scale well when we add:

- entrypoint smoke tests
- interceptor registration tests
- selector-assumption tests
- more event-driven UI flows

#### 3. Entrypoint tests are still awkward

`src/index.tsx` still initializes through import-time side effects. `docs/specs/02-B-entrypoint-wiring-tests.md` correctly identifies this as a missing testability seam.

Without a reusable harness, every future entrypoint test will need to manually:

1. prepare globals
2. prepare DOM
3. import the entrypoint in the right order
4. inspect the resulting wiring

That setup should live in one place.

#### 4. The test boundary is not documented clearly enough

`docs/DEVELOPMENT.md` correctly says to avoid importing `src/index.tsx` in normal tests, but it does not yet explain:

- which host behaviors are shared via helpers
- which host behaviors are intentionally left unmocked
- when to use the reusable harness versus a narrow one-off stub
- when a live SillyTavern smoke test is still required

## Goals

- Add a reusable SillyTavern host test harness under `src/test-utils/`.
- Keep the harness minimal, explicit, and focused on zTracker's real host dependencies.
- Reuse the same host primitives across tracker-actions, ui-init, and future entrypoint wiring tests.
- Make it cheap to add new event-driven tests without rebuilding host scaffolding.
- Make the mocked host boundary easy to understand and document.

## Non-goals

- Reproducing all of SillyTavern in Jest.
- Simulating browser layout, CSS, or full extension loading semantics.
- Replacing live SillyTavern smoke tests where host behavior must be confirmed end-to-end.
- Creating a generic external package or framework. This harness should stay repo-local and shaped around zTracker.

## Proposed design

### Principle: prefer narrow reusable layers over a giant fake host

The harness should be built from small helpers that can be composed per test suite. Tests should only pull in the host pieces they actually need.

### Layer 1: Host runtime builder

Add a shared helper, for example `src/test-utils/sillytavern-host-harness.ts`, that exposes a runtime builder such as:

```ts
const host = createSillyTavernHost({
  chat: [...],
  characters: [...],
  characterId: 0,
});

installSillyTavernHost(host.context);
```

The builder should provide stable defaults for common host state used by zTracker:

- `chat`
- `chatMetadata`
- `characters`
- `characterId`
- `name1` / `name2`
- `extensionSettings`
- `powerUserSettings`
- `eventSource`
- `Popup.show.confirm` / `Popup.show.input`
- `saveChat`, `saveMetadata`, `saveSettingsDebounced`
- `renderExtensionTemplateAsync`
- `writeExtensionField`
- `getPresetManager`

The harness should return both:

- the installed context object
- direct handles to spies/controllers used by assertions

### Layer 2: Event source controller

Provide a reusable event-source primitive instead of each test managing its own `Map<string, handler>`.

Suggested shape:

```ts
const events = createEventSourceHarness();

events.on.mock.calls
events.getHandlers('MESSAGE_SENT')
events.emit('MESSAGE_SENT', 3)
events.emit('CHAT_CHANGED')
```

This should support:

- asserting which events were registered
- retrieving one or many handlers for a named event
- triggering handlers in registration order
- optional reset between tests

This is the most important missing reusable primitive for UI and entrypoint tests.

### Layer 3: DOM scaffold helpers

Add small DOM builders for the host nodes that zTracker expects to exist.

Suggested helpers:

- `installBaseExtensionDom()`
- `installMessageTemplateDom()`
- `installExtensionsMenuDom()`
- `installSettingsContainerDom()`
- `installChatMessageDom(messageId, options)`

These helpers should cover selectors that are currently implicit across tests, including:

- `#extensionsMenu`
- `#extensions_settings`
- `#message_template`
- `.mes`
- `.mes_buttons`
- `.extraMesButtons`

The purpose is not to mirror all host markup. The purpose is to make selector assumptions explicit and reusable.

### Layer 4: Boot helper for host wiring tests

Add a higher-level helper for the tests that need to validate initialization order or import-time wiring.

Suggested shape:

```ts
const boot = await bootExtensionForTest({
  host,
  dom: { settings: true, extensionsMenu: true, messageTemplate: true },
});
```

This helper should:

1. install the host global
2. install the requested DOM scaffold
3. import the target module in a controlled way
4. return handles for assertions

Initially this may target `initializeGlobalUI()` or a small extracted entrypoint function rather than `src/index.tsx` directly.

### Layer 5: Tracker-actions helper should depend on the shared host layer

`src/test-utils/tracker-actions-test-helpers.ts` should remain, but it should gradually stop owning a parallel fake host implementation.

Instead it should compose:

- the generic host runtime builder
- tracker-actions-specific mocks
- tracker-actions-specific reset helpers

This keeps the current productive test style while reducing divergence between slices.

## Recommended incremental rollout

### Phase 1: Extract the reusable host primitives

Add:

- shared host runtime builder
- shared event-source harness
- shared DOM scaffold helpers

Do not refactor the whole test suite at once.

### Phase 2: Migrate the most duplicated suites

Migrate:

- `ui-init.test.ts`
- `ui-init.auto-mode-exclusion.test.ts`
- selected tracker-actions tests that currently install the host context manually

The migration should prove that the harness works for both UI and non-UI slices.

### Phase 3: Add missing wiring tests

Use the harness to implement the still-open coverage from `02-B-entrypoint-wiring-tests.md`:

- event registration smoke tests
- interceptor registration tests
- DOM attachment selector smoke tests

### Phase 4: Document the boundary

Update `docs/DEVELOPMENT.md` with a short section explaining:

- which helpers exist
- when to use them
- what is still intentionally tested only in live SillyTavern

## What would be most useful to add first

If we do not want to build the entire harness at once, the highest-value additions are:

1. `createEventSourceHarness()`
2. `createSillyTavernHost()` with stable defaults
3. `installBaseExtensionDom()` for shared selectors

Those three pieces unlock most of the missing tests with the least design risk.

## Open questions

1. Should entrypoint tests import `src/index.tsx` directly, or should we first extract a tiny boot function to keep the import-side effects controlled?
2. How much of `tracker-actions-test-helpers.ts` should be migrated immediately versus left in place until the new host harness proves itself?
3. Which selector assumptions are stable enough to encode in shared DOM helpers, and which should remain local to the test that needs them?
4. Do we want one combined harness file or separate `host`, `events`, and `dom` helpers under `src/test-utils/`?

## Acceptance criteria

- A shared host harness exists under `src/test-utils/`.
- At least two existing suites are migrated to use it.
- Event-driven tests no longer need per-file handler maps or bespoke `globalThis.SillyTavern` setup.
- The harness is explicitly documented as a minimal fake host, not a full SillyTavern emulator.
- The harness is sufficient to implement the currently open entrypoint wiring tests.

## Validation plan

- Run `npm test` after introducing the harness.
- Run focused Jest suites for migrated tests first, then the full suite.
- If the harness is used for entrypoint or selector smoke tests, pair the automated tests with one live SillyTavern smoke check after a fresh build.

## Tasks checklist

- [ ] Add shared event-source harness helper
- [ ] Add shared SillyTavern host runtime builder
- [ ] Add shared DOM scaffold helpers for common selectors
- [ ] Rebase tracker-actions helpers onto the shared host layer where it reduces duplication
- [ ] Migrate at least two existing suites to the new harness
- [ ] Implement the open entrypoint wiring tests using the harness
- [ ] Document the test harness boundary in `docs/DEVELOPMENT.md`
