# Spec: Fix "Preset undefined not found" during tracker generation

Status: Open
Last updated: 2026-04-01

## Goal

Stop the browser console error `Preset undefined not found` that is triggered by zTracker tracker generation in SillyTavern 1.17.

## What we know

- The error is thrown from SillyTavern's `preset-manager.js`, but it is triggered by zTracker's tracker-generation flow.
- zTracker currently passes `profile?.preset`, `profile?.context`, and `profile?.instruct` directly into `buildPrompt(...)` in `src/ui/tracker-actions.ts`.
- After the SillyTavern update, some valid zTracker connection profiles can leave one or more of those fields unset.
- When that happens, tracker generation can still proceed, but SillyTavern logs `Preset undefined not found` to the console.

## Suspected root cause

zTracker treats profile preset fields as optional at the call site, while the current SillyTavern preset-resolution path no longer tolerates `undefined` for every preset slot used during tracker prompt building.

## Scope

- Audit the tracker-generation prompt build path in `src/ui/tracker-actions.ts`.
- Determine which preset fields are required for each profile mode/API.
- Normalize or omit undefined preset names before calling `buildPrompt(...)`.
- Preserve current behavior for valid saved system prompts and existing profile-based prompt selection.

## Fix direction

1. Reproduce with a profile that has missing preset fields.
2. Confirm which field is `undefined` at the `buildPrompt(...)` call.
3. Change zTracker to avoid passing undefined preset names into SillyTavern preset resolution.
4. Verify tracker generation still works for both chat-completions and text-completions profiles.

## Acceptance criteria

- Triggering zTracker no longer logs `Preset undefined not found` in the browser console.
- Tracker generation still succeeds with the affected profile types.
- A regression test or clearly documented manual verification covers the fixed case.
