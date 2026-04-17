# Spec: zTracker prompt macro for manual tracker injection

Status: Approved
Last updated: 2026-04-16

## Summary

Add a zTracker macro that expands into tracker content at SillyTavern prompt-build time, so users can manually place tracker context in a prompt template with syntax like `{{zTracker}}`.

This spec targets the SillyTavern macro system documented under `macros.register()` and uses it as a prompt-time escape hatch when the normal message-injection path is not desirable or is being rewritten downstream.

## Motivation

The existing injection flow uses the global generate interceptor and inserts tracker snapshots as a message in the chat array. That path is useful for automatic embedding, but it is not always ideal when:

- downstream request handling rewrites injected roles,
- a user wants explicit control over where tracker text appears in the final prompt,
- debugging needs a direct manual injection point that bypasses message-role semantics.

A macro gives users a deterministic, template-level way to include tracker content where they want it, without relying on a synthetic chat message being preserved through the transport stack.

## Scope

- Register a synchronous SillyTavern macro that expands to zTracker tracker text.
- Support both the modern `macros.register()` API and the legacy `registerMacro()` API for version compatibility.
- Provide a predictable default expansion with no arguments, e.g. `{{zTracker}}`.
- Optionally support a small argument surface for format or presentation choices.
- Keep the existing generate-interceptor injection path intact.
- Keep the macro strictly synchronous, because SillyTavern macro handlers cannot return a promise.

## Non-goals

- Replacing the current tracker-generation pipeline.
- Reworking existing automatic snapshot injection.
- Adding asynchronous macro behavior.
- Introducing a new prompt-engineering output format.
- Creating a full SillyTavern-native prompt templating subsystem.

## Existing behavior and constraints

### Current injection flow

Tracker snapshots are currently inserted into normal generation context through the global interceptor in [`src/ui/ui-init.ts`](src/ui/ui-init.ts:481-485), which calls [`includeZTrackerMessages()`](src/tracker.ts:187-260).

That flow is automatic and operates on the chat array, not on a prompt template string.

### Relevant tracker formatting helpers

zTracker already has reusable logic that can be used to generate macro output:

- [`formatEmbeddedTrackerSnapshot()`](src/embed-snapshot-transform.ts:1)
- [`includeZTrackerMessages()`](src/tracker.ts:187-260)
- the tracker data stored on the current chat message via [`applyTrackerUpdateAndRender()`](src/tracker.ts:319-358)

## Detailed design

### 1. Macro name

Register a macro named `zTracker`.

Suggested behavior:

- `{{zTracker}}` → current tracker snapshot in the default embedded format
- `{{zTracker format}}` → optional explicit format selector, if supported

The simplest version should require no arguments and return a string that matches the current embedded tracker representation.

### 2. Macro output source

The macro should read from the active chat context and locate the tracker data currently attached to the relevant message.

Preferred source order:

1. The tracker already attached to the current target message, if the macro is invoked in a message-scoped context.
2. The most recent tracker-bearing message found by searching the active chat history backwards.
3. A graceful empty string if no tracker exists.

If the SillyTavern macro environment exposes message/chat context, the handler should use that context first; otherwise, it should fall back to the global `SillyTavern.getContext().chat`.

### 3. Return shape

The macro should return a plain string, not a message object.

The initial implementation should return one of:

- the tracker snapshot text only,
- or the snapshot text with the configured header prefix, depending on the chosen UX.

Recommended default:
- return the same content that [`formatEmbeddedTrackerSnapshot()`](src/embed-snapshot-transform.ts:1) would emit for embedding, including fence/wrapper choice.

### 4. Argument surface

Keep the first version small.

Possible future arguments:

- `raw` → return unwrapped tracker text
- `json` → return a JSON-fenced tracker snapshot
- `minimal` → return the minimal embed preset output
- `toon` → return the TOON embed preset output

If arguments are supported, register them via the macro metadata system so the macro is discoverable in SillyTavern UI and docs.

### 5. Registration lifecycle

Register the macro during extension startup from the UI init path in [`src/ui/ui-init.ts`](src/ui/ui-init.ts:228-485), where the extension already wires runtime behavior into `SillyTavern.getContext()`.

Recommended lifecycle:

1. On init, attempt to register `zTracker` using the modern API.
2. If the modern API is not yet available, listen for the `APP_READY` event and retry registration.
3. Fall back to the legacy `registerMacro` API if the modern system is unavailable in the current SillyTavern version.
4. If the macro already exists, either replace it explicitly or unregister first, depending on the SillyTavern API semantics.
5. On unload or reinit, unregister or overwrite safely to avoid duplicate registrations.

### 6. Manual prompt injection use case

The macro exists so users can place tracker text manually inside their own prompt template, for example:

```text
System instructions...

{{zTracker}}

Continue the response using the tracker above.
```

This avoids reliance on the chat-array injection path and makes tracker inclusion explicit in the prompt body.

### 7. Availability boundary

The `{{zTracker}}` macro is intended for user-authored prompt/template text that is processed before zTracker assembles or submits its own request.

That includes supported SillyTavern template surfaces and any external prompt text that zTracker feeds through the same synchronous macro-expansion helper before compiling the final request payload.

It does **not** change the internal zTracker Handlebars templates themselves; those continue to render `schema` and `example_response` as before.

### 8. Relationship to existing injection settings

The macro should not replace or alter:

- [`embedZTrackerRole`](src/config.ts:69-75)
- [`includeLastXZTrackerMessages`](src/config.ts:68-75)
- [`embedZTrackerSnapshotHeader`](src/config.ts:74-85)

Instead, it should reuse those settings as the source of truth for formatting where practical.

## Open questions

1. Should the macro's discovery and formatting logic remain consistent with the existing automatic injection system (`includeZTrackerMessages`)?
   - **Yes.** The macro uses the same backwards-search strategy to find the latest valid tracker snapshot and the same `formatEmbeddedTrackerSnapshot` helper. This ensures that presets, headers, and regex transforms are applied identically whether the tracker is injected automatically or via the `{{zTracker}}` macro.
2. Should the macro return the snapshot with fence markup, or should a raw-text variant be the default?
   - Follow the settings. If fencing is enabled, include the fence markup; otherwise, return raw text.
3. Do we want one macro only, or a small family such as `{{zTracker}}`, `{{zTrackerRaw}}`, and `{{zTrackerMinimal}}`?
   - Only one for now. Can revisit.
4. Should the macro live in the generation prompt path only, or also be exposed for other SillyTavern template surfaces that support macros?
   - Expose it for other SillyTavern template surfaces that support macros.
5. If the tracker is unavailable, should the macro return an empty string or a visible placeholder comment for debugging?
   - Return an empty string for production use, but a visible placeholder comment for debugging.

## Implementation notes

- The handler must be synchronous because SillyTavern macro handlers cannot return promises.
- The registration logic should be registry-agnostic, handling both modern and legacy SillyTavern APIs internally.
- Keep the macro logic in an import-safe helper so tests can exercise it without booting the full extension.
- Prefer reuse of existing tracker formatting helpers over duplicating embed formatting logic.
- Keep the macro output deterministic so it can be covered with snapshot tests.

## Codebase change map

| File | Intended change |
|---|---|
| [`src/ui/ui-init.ts`](src/ui/ui-init.ts:228-485) | Trigger macro registration on init or `APP_READY`. |
| [`src/tracker-macro.ts`](src/tracker-macro.ts:1) | Implement registry-agnostic registration and the expansion handler. |
| [`src/embed-snapshot-transform.ts`](src/embed-snapshot-transform.ts:1) | Reuse the existing tracker formatting helpers for macro output. |
| [`src/tracker.ts`](src/tracker.ts:187-260) | Optionally expose a helper that resolves the latest tracker-bearing message for macro use. |
| [`src/__tests__/`](src/__tests__) | Add tests for macro registration and returned text. |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md:5-14) | Document the new macro and the manual injection workflow. |
| [`readme.md`](readme.md:1) | Add a short user-facing note about `{{zTracker}}`. |

## Acceptance criteria

- `zTracker` macro can be registered through `SillyTavern.getContext().macros.register()` or `registerMacro()`.
- The macro handles registration timing appropriately (e.g., retrying on `APP_READY`).
- The macro returns deterministic tracker text in a synchronous handler.
- Users can place the macro in a prompt template and manually inject tracker context.
- The macro does not break the existing interceptor-based embedding flow.
- Tests cover macro registration and the returned expansion for at least one tracker fixture.

## Tasks checklist

- [x] Decide the macro name and argument surface
- [x] Define the tracker source-of-truth helper for macro expansion
- [x] Implement registry-agnostic macro registration
- [x] Add retry logic for `APP_READY` availability
- [x] Add lifecycle cleanup or safe overwrite behavior
- [x] Add tests for macro output and registration
- [ ] Document the macro in developer and user docs
- [x] Smoke test the macro in a live SillyTavern prompt template

## Verification plan

- Unit test macro registration and unregistration behavior.
- Unit test that `{{zTracker}}` returns the expected tracker text for a known fixture.
- Manually verify in SillyTavern that inserting `{{zTracker}}` into a prompt template emits the tracker text exactly where expected.
- Confirm existing automatic injection still works independently of the macro.
