# Spec: Consolidate schema-derived tracker metadata helpers

Status: Open
Last updated: 2026-04-21

## Summary

Reduce duplication in schema-derived tracker metadata by centralizing helper logic that is currently split between `src/tracker-parts.ts` and `src/ui/tracker-action-helpers.ts`.

This is intentionally tracked as a follow-up spec rather than a branch-local refactor because it would touch `src/ui/tracker-action-helpers.ts`, which is outside the main code paths already changed on `feat/partial-tracker-cleanup`.

## Motivation

The partial-cleanup branch already added or expanded schema-aware logic in the tracker core:

- `resolveTopLevelPartsOrder()` in `src/tracker-parts.ts` parses `x-ztracker-dependsOn`;
- `buildPartsMeta()` in `src/ui/tracker-action-helpers.ts` separately parses `x-ztracker-dependsOn` again;
- `getArrayItemIdentityKey()` and `sanitizeArrayItemFieldKeys()` already live in `src/tracker-parts.ts`, so schema-derived metadata is only partially centralized today.

That split has two costs:

1. schema-extension behavior must be changed in more than one place;
2. `src/ui/tracker-action-helpers.ts` contains schema logic that does not really belong to the UI layer.

This is not a correctness bug today, but it is unnecessary code volume and creates drift risk.

## Current duplication

### Dependency parsing

`src/tracker-parts.ts` uses a local `normalizeDependsOn()` helper for part ordering.

`src/ui/tracker-action-helpers.ts` reimplements equivalent `x-ztracker-dependsOn` parsing inside `buildPartsMeta()`.

### Array-part metadata derivation

`buildPartsMeta()` also derives:

- array-item identity key;
- per-item editable field list;
- dependency metadata.

Those are schema-derived concerns, not UI concerns.

## Goals

- Keep one source of truth for parsing `x-ztracker-dependsOn`.
- Reduce total LOC across the schema and UI helper modules.
- Keep schema-derived metadata logic close to other schema helpers.
- Leave runtime behavior unchanged for `partsOrder` and `partsMeta` consumers.

## Non-goals

- Refactoring the branch-local targeted regeneration flows in `src/ui/tracker-actions.ts`.
- Changing the shape of persisted tracker metadata.
- Changing cleanup semantics, pending-redaction matching, or render behavior.
- Moving unrelated DOM or prompt-assembly helpers.

## Proposal

### 1. Centralize dependency normalization

Expose one shared helper for `x-ztracker-dependsOn` parsing instead of keeping separate logic in two modules.

Possible shapes:

- `normalizeDependsOn(value)` exported from `src/tracker-parts.ts`; or
- a small dedicated schema helper module if that yields less overall code.

### 2. Centralize array-part metadata derivation

Move the schema-only part of `buildPartsMeta()` behind one reusable helper.

Possible shapes:

- `getArrayPartMeta(schema, partKey)`; or
- `buildSchemaPartsMeta(schema)`.

The helper should be responsible for deriving:

- `idKey`;
- `fields`;
- `dependsOn`.

### 3. Keep UI helpers UI-focused

After centralization, `src/ui/tracker-action-helpers.ts` should either:

- call the shared schema helper directly; or
- stop owning `buildPartsMeta()` entirely if moving it out reduces code further.

The preferred option is whichever produces the smallest and clearest result.

## Acceptance criteria

- Only one implementation parses `x-ztracker-dependsOn`.
- `resolveTopLevelPartsOrder()` and parts metadata generation reuse the same dependency parsing logic.
- Schema-derived metadata no longer has duplicated parsing rules across schema and UI helper modules.
- Existing `partsMeta` and `partsOrder` behavior remains unchanged.

## Validation

- Run targeted tests covering schema helpers and tracker actions.
- Run the normal project build.
- Confirm no UI behavior changes in parts-menu rendering or cleanup target derivation.

## Open questions

- Is it smaller overall to keep `buildPartsMeta()` as a thin wrapper in `src/ui/tracker-action-helpers.ts`, or should it move fully into `src/tracker-parts.ts`?
- Would a new dedicated schema-metadata module reduce code, or would it just add indirection without enough savings?