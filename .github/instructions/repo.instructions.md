---
applyTo: '**'
---

Maintenance: Last reviewed 2026-04-02. Update when project structure, build flow, or AI-agent guidance changes.

# Repo instructions: SillyTavern-zTracker

These instructions apply to all files in this repository.

## Project context
- This repo builds a **SillyTavern UI extension** (browser-side) named **zTracker**.
- The latest release version of SillyTavern is 1.17, we test against it, and we aim to maintain compatibility with it and future releases.
- The extension generates structured “tracker” data for chat messages (via an LLM connection profile), stores it in chat history (`message.extra.zTracker.*`), and renders it above the message.

## Changelog and versioning
- **Any new feature or bugfix must be mentioned in `CHANGELOG.md`** (add it under `Unreleased`, then move into a release section when versioning). The changelog is meant to be read by humans, keep it concise.
- Follow SemVer and "Keep a Changelog".
- Canonical version lives in `package.json`.
	- `manifest.json` is derived; do not manually edit its version.
	- Use `npm version <patch|minor|major>` for releases.
	- Use `npm run sync-version` when needed to update derived version fields.
- A release is not complete until `package.json`, the newest versioned `CHANGELOG.md` section, and the newest git tag all match.

## Release checklist
- Confirm working tree is clean: `git status`.
- Update `CHANGELOG.md`: move items from `Unreleased` into a new version section.
- Update `readme.md` for any user-visible feature change.
- Run verification:
	- `npm test`
	- `npm run build`
- Commit any build artifacts that changed (e.g. `dist/index.js`) before running `npm version`, as it requires a clean working tree.
- Create the release (this bumps `package.json`, syncs `manifest.json`, and stages it automatically): `npm version <patch|minor|major>`.
- Double-check release completeness after `npm version`: `package.json`, `manifest.json`, the latest `CHANGELOG.md` section, and the latest git tag must all point at the same release version.
- Sanity check release artifacts exist and are current:
	- `dist/index.js`
	- `dist/style.css`
	- `dist/templates/*.html`
- Push commit + tag: `git push --follow-tags`.

## Readme updates  
- Any new feature must also have a concise explanation in `readme.md` under the appropriate section.
- Keep formatting to a minimum; focus on clarity and usefulness.

## IMPORTANT: Code style
- Brevity and clarity are preferred. Avoid boilerplate where possible.  
- Split complex logic into small, testable functions in separate modules, especially in `src/`.
- Avoid large monolithic functions, classes or files.
- We prefer "less code", so avoid unnecessary abstractions or patterns and try to re-use existing helpers/utilities.
- Use soft size targets for human review and agent exploration.
- Keep most `src/` files under ~300 lines. Re-evaluate past ~400. Allow ~600+ only for strongly cohesive declarative files, schemas, fixtures, or generated output.
- Keep classes, React components, and long-lived managers under ~150 lines. Split responsibilities past ~200 unless the extra length is mostly simple markup or configuration.
- Keep functions and methods under ~40 lines. Refactor past ~60 unless the function is straightforward glue code.
- Prefer cohesive feature-local modules over monolithic cross-feature service files.
- Do not split code into tiny wrappers purely to satisfy a size target.
- Break up oversized test files once they stop mapping cleanly to one module or one behavior cluster.
- IMPORTANT: Any code change must improve the code quality of the project. Goal is to have a lean codebase. Leave the code better than you found it.

## Comments
- Use comments to explain the "why" behind non-obvious code, especially for complex logic or workarounds.
- Important: Each file, function, method, and class **must** have a brief explanation describing its purpose and behavior.

## Build and required artifacts
- This extension is loaded by SillyTavern from `manifest.json` and expects built assets:
	- `dist/index.js`
	- `dist/style.css`
- Build the extension before any SillyTavern smoke test and commit the changes. The extension must be updated in SillyTavern after that!
- Commit the changed build artifacts before treating a SillyTavern smoke test as valid for branch review or release work.
- Assume a live SillyTavern instance may still be serving stale extension assets until the current repo build artifacts are present and committed.

### Do not copy build outputs between projects
- Do not copy `dist/*` assets between this repo and any SillyTavern repo/folder.
- Rebuild this repo (`npm run dev`/`npm run build`) and update SillyTavern manually (or install/link this repo as the extension folder) so sources and artifacts stay consistent.
- For local development, prefer:
	- `npm install`
	- `npm run dev` (watch build)
- For production builds, use `npm run build`.

## Testing expectations
- Run `npm test` after changing executable/compilable source code, especially logic in `src/`.
- Keep new logic import-safe and testable (prefer small helpers in modules like `src/parser.ts`, `src/tracker.ts`, etc.).
- Avoid importing `src/index.tsx` in Jest tests (it wires browser/SillyTavern side effects). Test helpers instead.
- When a live smoke test reveals a mishaped tracker reply, add the captured reply as test data whenever it is safe to repair so parser repair coverage keeps improving.
- Testing e2e in SillyTavern requires a build, a commit and manual extension update!

## Rendering and schema safety
- Tracker HTML rendering uses Handlebars compiled with `{ strict: true, noEscape: true }`.
	- With `strict: true`, missing fields referenced by templates will throw.
	- Keep schema fields and the associated HTML template in sync to avoid render failures (which may cause trackers to be removed defensively).

## SillyTavern integration guidelines
- Prefer `SillyTavern.getContext()` APIs over importing SillyTavern internals.
- Be careful with prompt interception (`generate_interceptor`): clone inputs if mutations must be ephemeral.
- Preserve speaker attribution during tracker generation sanitization. SillyTavern prompt assembly may keep instruct/text-completion speaker names on `message.source.name` instead of flattening them into `message.content`, and dropping that field can reduce the final prompt to anonymous `[INST]...[/INST]` turns.
- Tracker-generation and injection requests MUST use the configs currently active in SillyTavern (e.g. the active instruct template), as the saved settings in the selected connection profile may differ from the active settings. 

## GitHub Copilot skill
- For SillyTavern extension development work, load `.github/skills/sillytavern-extension-development/SKILL.md`.
- Use that skill for general SillyTavern extension knowledge: manifest changes, `SillyTavern.getContext()` integrations, events, prompt interceptors, upstream compatibility review, and host-level testing guidance.
- Use `docs/DEVELOPMENT.md` for zTracker-specific commands, validation commands, release workflow, and contributor operations in this repository.
- Keep the skill and its reference files current instead of recreating separate SillyTavern guidance docs under `docs/`.

## Security and data handling
- Do not store secrets (API keys/tokens) in extension settings.
- Avoid `eval()`/`Function()` and unsafe DOM insertion patterns.

## Further reading
- At `https://github.com/bmen25124/SillyTavern-Utils-Lib` you can find the `sillytavern-utils-lib` library, which this extension uses for prompt building and other SillyTavern-related utilities.
- For general SillyTavern extension guidance, use `.github/skills/sillytavern-extension-development/`.
- For zTracker-specific development and release workflow, use `docs/DEVELOPMENT.md`.

## Maintenance
IMPORTANT: Keep this file up to date. Whenever you discover or learn something about the project's purpose, behavior, or workflow, update this instruction file accordingly.
