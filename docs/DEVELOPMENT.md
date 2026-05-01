# Development (zTracker)

This document is for contributors and maintainers. It covers local development, testing, and versioning/release workflow for this repository.

## Development & testing

Working on the extension locally?

- Install dependencies once with `npm install`.
- Run `npm test` to execute the Jest suite (parser/schema helpers + jsdom render tests).
- Run `npm run dev` for a watch build while you iterate.
- Run `npm run debug:tracker-context:json` to print one sample JSON-mode tracker-generation request, including the final prompt array after zTracker snapshot injection and the `json_schema` payload passed to the generator.
- Run `npm run debug:tracker-context:xml` to print one sample XML prompt-engineering tracker-generation request, including the final prompt array and rendered XML instructions.
- Run `npm run debug:tracker-context:toon` to print one sample TOON prompt-engineering tracker-generation request, including the final prompt array and rendered TOON instructions.

Test boundaries to remember:

- Keep executable logic in import-safe modules under `src/` so Jest can load it without booting the full extension entrypoint.
- Avoid importing `src/index.tsx` in tests because it wires browser and SillyTavern side effects.
- Use jsdom for DOM behavior and lightweight injected context objects for host-state dependent helpers.
- Use `src/test-utils/sillytavern-host-harness.ts` for shared host-boundary setup such as `SillyTavern.getContext()`, event registration, `#send_but`, `#message_template`, and `#form_create` scaffolding.
- Prefer `bootExtensionForTest()` when a suite needs to initialize `initializeGlobalUI()` or another explicit boot seam; keep suite-local wrappers as thin composition over the shared harness instead of rebuilding host install logic.
- Keep using narrower local fixtures for pure logic tests; the shared host harness is for host-boundary behavior, not as a default test dependency.
- Register any custom Handlebars helpers explicitly in tests that need them.

## AI agent split

For GitHub Copilot or other coding agents:

- Use `.github/skills/sillytavern-extension-development/` for general SillyTavern extension knowledge such as manifest fields, `SillyTavern.getContext()`, events, interceptors, upstream compatibility, and generic host-level validation strategy.
- Use this document for zTracker-specific commands, local build and test workflow, release steps, and contributor operations in this repository.
- Keep repo-only procedures here instead of moving them into the general skill.

## Versioning

- Canonical version lives in `package.json`; `manifest.json` is derived. Do not edit manifest version manually.
- `npm run sync-version` updates derived files; it runs automatically before dev/build/test and during `npm version`.
- CI can run `npm run check-version` (strict mode) to fail fast on drift without rewriting files.
- Bump versions with `npm version <patch|minor|major>` to keep SemVer tags and changelog aligned.
- When bumping versions, stage changes under the `Unreleased` section in `CHANGELOG.md`, then move them into a dated release section (e.g., `1.0.0 - YYYY-MM-DD`).
- See [../CHANGELOG.md](../CHANGELOG.md) for release history.
