# Spec: Reusable SillyTavern test harness

Status: Implemented
Last updated: 2026-04-27

## Summary

Add a small, repo-local SillyTavern host test harness for the host behaviors that zTracker actually depends on.

This harness is meant to reduce duplicated host setup in Jest, make host-boundary tests cheaper to write, and support the still-missing wiring coverage defined in `02-B-entrypoint-wiring-tests.md`.

It should also cover the current host-boundary behaviors already exercised around generate-interceptor context hints, outgoing auto-mode host controls, and character-panel DOM syncing.

This spec intentionally does not propose a generalized fake SillyTavern test framework.

## Goals

- Add a reusable host harness under `src/test-utils/` for zTracker's host-boundary tests.
- Keep the harness narrow, explicit, and shaped around real zTracker dependencies.
- Reuse the same host primitives across `ui-init`, tracker-action host tests, and future wiring tests.
- Make selector assumptions and event registrations easy to test without rebuilding ad hoc setup in each suite.
- Document the boundary clearly so tests stay lean and maintainable.

## Non-goals

- Reproducing all of SillyTavern in Jest.
- Creating a generalized integration-test framework for arbitrary host behavior.
- Simulating browser layout, CSS, or full extension loading semantics.
- Replacing live SillyTavern smoke tests for end-to-end host validation.

## Required architecture

### Principle

Prefer a minimal shared harness over a generalized test suite.

The improvement this repo needs is a small set of reusable host primitives. The repo does not need a broad fake-host architecture or a large abstraction layer that attempts to emulate SillyTavern as a whole.

### Layer 1: host runtime builder

Add a shared host builder, for example `src/test-utils/sillytavern-host-harness.ts`, with a shape similar to:

```ts
const host = createSillyTavernHost({
  chat: [...],
  characters: [...],
  characterId: 0,
});

installSillyTavernHost(host.context);
```

The builder must provide stable defaults for the host state zTracker uses, including:

- `chat`
- `chatMetadata`
- `characters`
- `characterId`
- `mainApi`
- `selected_group`
- `name1` and `name2`
- `extensionSettings`
- `powerUserSettings`
- `eventSource`
- `generate` and `stopGeneration`
- `Popup.show.confirm` and `Popup.show.input`
- `saveChat`, `saveMetadata`, and `saveSettingsDebounced`
- `renderExtensionTemplateAsync`
- `writeExtensionField`
- `getPresetManager`

The builder must return both the assembled context and direct handles to assertion-friendly spies and controllers.

### Layer 2: event source harness

Add a reusable event-source primitive so tests do not keep their own handler maps.

Suggested shape:

```ts
const events = createEventSourceHarness();

events.on.mock.calls
events.getHandlers('MESSAGE_SENT')
events.emit('MESSAGE_SENT', 3)
events.emit('CHAT_CHANGED')
```

The event harness must support:

- asserting which events were registered
- retrieving one or many handlers for a named event
- triggering handlers in registration order
- resetting state between tests when needed

This is the highest-value shared primitive and should be treated as required, not optional.

### Layer 3: DOM scaffold helpers

Add small DOM scaffold helpers for the host nodes zTracker expects.

Suggested helpers:

- `installBaseExtensionDom()`
- `installMessageTemplateDom()`
- `installExtensionsMenuDom()`
- `installSettingsContainerDom()`
- `installSendButtonDom()`
- `installCharacterPanelDom()`
- `installChatMessageDom(messageId, options)`

These helpers should cover the selectors zTracker relies on, including:

- `#extensionsMenu`
- `#extensions_settings`
- `#message_template`
- `#send_but`
- `#form_create`
- `.mes`
- `.mes_buttons`
- `.extraMesButtons`

For character-panel tests, the scaffold only needs to provide one supported action-row shape that zTracker can target reliably. It must not try to mirror every possible host layout variation.

These helpers must stay intentionally small. They exist to make selector assumptions explicit and reusable, not to mirror host markup in detail.

### Layer 4: boot helper for wiring tests

Add a thin boot helper for tests that need to validate initialization and wiring.

Suggested shape:

```ts
const boot = await bootExtensionForTest({
  host,
  dom: { settings: true, extensionsMenu: true, messageTemplate: true },
});
```

This helper must:

1. install the host global
2. install the requested DOM scaffold
3. import or invoke the target boot surface in a controlled order
4. return handles needed for assertions

This helper should target the smallest boot seam available. It must not turn `src/index.tsx` import-side effects into the default testing surface for unrelated tests.

### Layer 5: compose existing tracker-action helpers

`src/test-utils/tracker-actions-test-helpers.ts` should remain focused on tracker-action-specific mocks, but host setup should be composed from the shared host layer where that reduces duplication.

The goal is one shared host foundation with slice-specific helpers layered on top, not multiple parallel fake-host implementations.

## What must be avoided

- Do not build a giant fake SillyTavern runtime.
- Do not add a generalized test suite that tries to model all host behavior.
- Do not hide selector assumptions or event registration behind abstractions that make failures harder to read.
- Do not force pure or import-safe logic tests to depend on the harness when a narrow local stub is sufficient.
- Do not move more behavior into entrypoint-style tests than necessary.
- Do not treat the harness as a replacement for one real SillyTavern smoke test when host integration must be confirmed end to end.

## Intended use

Use the harness for tests that verify host-boundary behavior such as:

- event registration and event-driven behavior
- interceptor registration
- generate-interceptor host hints such as solo-vs-group state and assistant reply labels
- DOM attachment to required SillyTavern selectors
- outgoing auto-mode behavior that depends on host stop/resume controls and the live send button
- character-panel button sync that depends on host-owned panel nodes
- UI initialization that depends on host globals or shared host nodes

Do not use the harness for pure logic tests that can stay import-safe with smaller fixtures.

## Acceptance criteria

- A shared SillyTavern host harness exists under `src/test-utils/`.
- The harness includes a host runtime builder, an event-source harness, and DOM scaffold helpers.
- At least two existing suites are migrated to use the shared harness.
- Event-driven tests no longer need per-file handler maps or bespoke `globalThis.SillyTavern` setup.
- The harness is sufficient to implement the currently open wiring coverage from `02-B-entrypoint-wiring-tests.md`.
- The harness is sufficient for current `ui-init` coverage that depends on interceptor context fields, `#send_but`, and `#form_create`.
- `docs/DEVELOPMENT.md` documents the harness as a minimal fake host and explains when not to use it.

## Validation plan

- Run focused Jest suites for migrated tests.
- Run `npm test` after introducing the harness.
- If new wiring tests cover selector assumptions or boot behavior, pair them with one live SillyTavern smoke check after a fresh build.
