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
- For detailed guidance (module structure, mocks, watch mode), see [SILLYTAVERN_DEV_NOTES.md](SILLYTAVERN_DEV_NOTES.md#testing-workflow).

## Versioning

- Canonical version lives in `package.json`; `manifest.json` is derived. Do not edit manifest version manually.
- `npm run sync-version` updates derived files; it runs automatically before dev/build/test and during `npm version`.
- CI can run `npm run check-version` (strict mode) to fail fast on drift without rewriting files.
- Bump versions with `npm version <patch|minor|major>` to keep SemVer tags and changelog aligned.
- When bumping versions, stage changes under the `Unreleased` section in `CHANGELOG.md`, then move them into a dated release section (e.g., `1.0.0 - YYYY-MM-DD`).
- See [../CHANGELOG.md](../CHANGELOG.md) for release history.
