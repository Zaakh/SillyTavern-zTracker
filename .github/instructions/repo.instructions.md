---
applyTo: '**'
---

# Repo instructions: SillyTavern-zTracker

These instructions apply to all files in this repository.

## Project context
- This repo builds a **SillyTavern UI extension** (browser-side) named **zTracker**.
- The extension generates structured “tracker” data for chat messages (via an LLM connection profile), stores it in chat history (`message.extra.zTracker.*`), and renders it above the message.

## Changelog and versioning
- **Any new feature or bugfix must be mentioned in `CHANGELOG.md`** (add it under `Unreleased`, then move into a release section when versioning).
- Follow SemVer and Keep a Changelog.
- Canonical version lives in `package.json`.
	- `manifest.json` is derived; do not manually edit its version.
	- Use `npm version <patch|minor|major>` for releases.
	- Use `npm run sync-version` when needed to update derived version fields.

## Release checklist
- Confirm working tree is clean: `git status`.
- Update `CHANGELOG.md`: move items from `Unreleased` into a new version section.
- Update `readme.md` for any user-visible feature change.
- Run verification:
	- `npm test`
	- `npm run build`
- Create the release (this bumps `package.json` and syncs derived versions like `manifest.json`): `npm version <patch|minor|major>`.
- Sanity check release artifacts exist and are current:
	- `dist/index.js`
	- `dist/style.css`
	- `dist/templates/*.html`
- Push commit + tag: `git push --follow-tags`.

## Readme updates  
- Any new feature must also have a concise explanation in `readme.md` under the appropriate section.
- Keep formatting to a minimum; focus on clarity and usefulness.

## Code style
- Brevity and clarity are preferred. Avoid boilerplate where possible.  
- Split complex logic into small, testable functions in separate modules, especially in `src/`.
- Avoid large monolithic functions, classes or files.
- We prefer "less code", so avoid unnecessary abstractions or patterns and try to re-use existing helpers/utilities.

## Build and required artifacts
- This extension is loaded by SillyTavern from `manifest.json` and expects built assets:
	- `dist/index.js`
	- `dist/style.css`
- For local development, prefer:
	- `npm install`
	- `npm run dev` (watch build)
- For production builds, use `npm run build`.

## Testing expectations
- Run `npm test` after changing executable/compilable source code, especially logic in `src/`.
- Keep new logic import-safe and testable (prefer small helpers in modules like `src/parser.ts`, `src/tracker.ts`, etc.).
- Avoid importing `src/index.tsx` in Jest tests (it wires browser/SillyTavern side effects). Test helpers instead.

## Rendering and schema safety
- Tracker HTML rendering uses Handlebars compiled with `{ strict: true, noEscape: true }`.
	- With `strict: true`, missing fields referenced by templates will throw.
	- Keep schema fields and the associated HTML template in sync to avoid render failures (which may cause trackers to be removed defensively).

## SillyTavern integration guidelines
- Prefer `SillyTavern.getContext()` APIs over importing SillyTavern internals.
- Be careful with prompt interception (`generate_interceptor`): clone inputs if mutations must be ephemeral.

## Security and data handling
- Do not store secrets (API keys/tokens) in extension settings.
- Avoid `eval()`/`Function()` and unsafe DOM insertion patterns.

## Further reading
- At `https://github.com/bmen25124/SillyTavern-Utils-Lib` you can find the `sillytavern-utils-lib` library, which this extension uses for prompt building and other SillyTavern-related utilities.
- For extension integration/testing tips and SillyTavern-specific guidance, see `docs/SILLYTAVERN_DEV_NOTES.md`.
