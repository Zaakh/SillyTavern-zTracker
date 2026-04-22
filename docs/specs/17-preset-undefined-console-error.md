# Spec: Fix "Preset undefined not found" during tracker generation

Status: Completed
Last updated: 2026-04-22

## Goal

Stop the browser console error `Preset undefined not found` that is triggered by zTracker tracker generation in SillyTavern 1.17.

## What we know

- The error is thrown from SillyTavern's `preset-manager.js`, but it is triggered by zTracker's tracker-generation flow.
- The original `buildPrompt(...)` call path was already normalized to omit blank preset slots and to use active SillyTavern runtime prompt state instead of saved profile selectors.
- The remaining live console error reproduced during full tracker regeneration for `textgenerationwebui` profiles.
- That path still called `TextCompletionService.processRequest(...)` with `instructName: undefined` in the request-local transport options.
- SillyTavern 1.17 still treats that explicit undefined preset slot as a preset lookup attempt, which logs `Preset undefined not found` even though generation continues.

## Root cause

zTracker's text-completion transport forwarded a request-local instruct selector object with `instructName: undefined` instead of omitting the field entirely when no active instruct preset was selected.

## Scope

- Keep the normalized `buildPrompt(...)` behavior already in the codebase.
- Remove the last explicit undefined preset forwarding from the text-completion request transport in `src/ui/tracker-actions.ts`.
- Preserve current behavior for valid active instruct selections and saved system prompts.

## Fix

1. Reproduced the console error by clicking `Regenerate Tracker` in a live SillyTavern 1.17 session.
2. Confirmed the direct `buildPrompt(...)` path was already omitting inactive preset slots.
3. Narrowed the remaining issue to `sendTextCompletionTrackerRequest(...)`, which passed `instructName: undefined` into `TextCompletionService.processRequest(...)`.
4. Changed the request-local options object to omit `instructName` when no active instruct preset exists.
5. Updated regression coverage so the text-completion transport must not include `instructName` in that case.

## Acceptance criteria

- Triggering zTracker no longer logs `Preset undefined not found` in the browser console.
- Tracker generation still succeeds with the affected profile types.
- A regression test or clearly documented manual verification covers the fixed case.

## Verification

- Updated `src/__tests__/tracker-actions.prompt-assembly.test.ts` so the text-completion transport must omit `instructName` entirely when no active instruct preset exists.
- Ran `npm test -- --runInBand src/__tests__/tracker-actions.prompt-assembly.test.ts` successfully.
- Ran `npm run build` successfully.
- Live SillyTavern verification must be done against the committed feature-branch build, because the local host workflow for this repo only treats committed extension artifacts as the authoritative version under test.
