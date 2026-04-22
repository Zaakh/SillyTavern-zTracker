# Spec: Fix "Preset undefined not found" during tracker generation

Status: Completed
Last updated: 2026-04-22

## Goal

Stop the browser console error `Preset undefined not found` that is triggered by zTracker tracker generation in SillyTavern 1.17.

## What we know

- The error is thrown from SillyTavern's `preset-manager.js`, but it is triggered by zTracker's tracker-generation flow.
- The original `buildPrompt(...)` call path was already normalized to omit blank saved profile preset slots and to use active SillyTavern runtime prompt state instead of saved profile selectors.
- The remaining live console error reproduced during full tracker regeneration for `textgenerationwebui` profiles.
- Live tracing showed zTracker was still calling SillyTavern `buildPrompt(...)` without a `contextName`, and SillyTavern 1.17 still resolves the text-completion context preset even when that selector is missing.
- The text-completion transport also forwarded `instructName: undefined` in its fallback request options when no active instruct preset existed.

## Root cause

zTracker still left one text-completion preset slot unresolved for SillyTavern 1.17: it forwarded the active instruct preset name but not the active context preset name during `buildPrompt(...)`, which caused SillyTavern's context preset manager to receive `undefined` and log `Preset undefined not found`. A smaller adjacent bug also forwarded `instructName: undefined` through the fallback text-completion request transport.

## Scope

- Keep the normalized `buildPrompt(...)` behavior already in the codebase.
- Pass the active runtime context preset name into text-completion prompt assembly in `src/ui/tracker-action-helpers.ts`.
- Remove the last explicit undefined preset forwarding from the fallback text-completion request transport in `src/ui/tracker-actions.ts`.
- Preserve current behavior for valid active instruct selections and saved system prompts.

## Fix

1. Reproduced the console error by clicking `Regenerate Tracker` in a live SillyTavern 1.17 session.
2. Confirmed the direct `buildPrompt(...)` path was already omitting inactive preset slots.
3. Added live instrumentation around SillyTavern preset managers and `TextCompletionService` to capture the exact remaining undefined preset lookup.
4. Confirmed the remaining lookup was the text-completion `context` preset, which `buildPrompt(...)` still resolved from `contextName`.
5. Changed zTracker to pass the active runtime context preset name for `textgenerationwebui` prompt assembly and to omit `instructName` when no active instruct preset exists.
6. Updated regression coverage for both the active context preset path and the fallback transport path.

## Acceptance criteria

- Triggering zTracker no longer logs `Preset undefined not found` in the browser console.
- Tracker generation still succeeds with the affected profile types.
- A regression test or clearly documented manual verification covers the fixed case.

## Verification

- Updated `src/__tests__/tracker-actions.prompt-assembly.test.ts` so text-completion prompt assembly forwards the active runtime context preset and the fallback text-completion transport omits `instructName` entirely when no active instruct preset exists.
- Ran `npm test -- --runInBand src/__tests__/tracker-actions.prompt-assembly.test.ts` successfully.
- Ran `npm run build` successfully.
- Live SillyTavern verification must be done against the committed feature-branch build, because the local host workflow for this repo only treats committed extension artifacts as the authoritative version under test.
