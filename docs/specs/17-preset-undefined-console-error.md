# Spec: Investigate "Preset undefined not found" console error

Status: Open
Last updated: 2026-04-01

## Goal

Identify the root cause of the `[ERROR] Preset undefined not found @ preset-manager.js:767` error
that appears in the browser console when zTracker triggers a generation request in SillyTavern 1.15.0,
and determine whether it is a zTracker bug or a SillyTavern regression.

## Observed behavior

During smoke testing with SillyTavern `1.15.0 'release' (bba91e38f)` and zTracker `1.4.0`:

- The error fires **twice** immediately after zTracker clicks the generate endpoint.
- Network log shows `POST /api/backends/text-completions/generate => 200 OK`, meaning generation itself succeeds.
- The rendered tracker is complete and correct — the error does **not** block tracker output.
- Error origin: `preset-manager.js:767` (SillyTavern internal).
- Error text: `Preset undefined not found` (×2).
- The connection profile used was `openrouter-text nvidia/nemotron-3-nano-30b-a3b:free`.

## Hypotheses

1. **zTracker passes an undefined preset name** during generation prompt assembly or connection profile injection.
2. **SillyTavern 1.15.0 changed preset-manager API** — a preset name that existed or was optional in 1.14.x 
   now must be resolved and throws when missing.
3. **The connection profile references a non-existent preset** (e.g. a `syspromptName` field pointing to a 
   deleted or renamed preset).

## Investigation steps

### 1. Reproduce the error

- Rebuild (`npm run build`) if not already current.
- Open SillyTavern at `http://127.0.0.1:8000/` with Playwright.
- Select a chat, click the zTracker truck button on a message.
- Capture `browser_console_messages(onlyErrors: true)` immediately after generation.
- Confirm the two `Preset undefined not found` errors reproduce.

### 2. Locate the call site in SillyTavern source

- In SillyTavern devtools, set a breakpoint on `preset-manager.js:767` (or search for the throw/log site).
- Trigger generation again and inspect the call stack:
  - What function calls into preset-manager at line 767?
  - What argument is `undefined` — is it a preset name, a preset object, or an ID?

### 3. Trace what zTracker sends

- Inspect the `POST /api/backends/text-completions/generate` request payload captured by `browser_network_requests()`.
- Check `src/ui/tracker-actions.ts` → `generateTracker()` → `st_generate()` call.
- Check whether the connection profile object passed to `st_generate` includes a `preset` or `presetName` field, 
  and whether it can be `undefined`.
- Key files to audit:
  - `src/config.ts` — `ConnectionProfile` type fields
  - `src/ui/tracker-actions.ts` — how connection profile is applied before calling `st_generate`

### 4. Check SillyTavern 1.15.0 changelog

- Review SillyTavern release notes / git log between `1.14.x` and `1.15.0` for changes to `preset-manager`.
- Look for new mandatory fields or changed preset resolution logic.

### 5. Determine ownership

- If the undefined value originates from zTracker code or config: fix in zTracker.
- If it originates purely from SillyTavern internals with no zTracker input: file an upstream SillyTavern issue.

## Acceptance criteria

- Root cause identified and documented.
- If zTracker is responsible: a fix is implemented, tested, and the console error no longer appears.
- If SillyTavern is responsible: an upstream issue is filed and this spec is updated with a link.
- Either way: a brief entry is added to `CHANGELOG.md` under `[Unreleased]`.
