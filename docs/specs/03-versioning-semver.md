# Spec: Single-source versioning + SemVer (start 1.0.0)

Status: Done
Last updated: 2026-01-21

## Goal
Adopt semantic versioning and keep the version defined in **one authoritative place**, starting at **1.0.0**, with automatic sync to all other required locations.

## Scope
- Decide the canonical source of truth.
- Sync version into:
  - `manifest.json.version`
  - `package.json.version` (if not canonical)
  - any in-code version constants (if kept)

## Decisions (answers to the open questions)
- Canonical version source: `package.json.version` is the single source of truth; `manifest.json.version` is derived from it.
- In-code version constant: none. Rely on `package.json.version` and keep settings migration tracked separately via `formatVersion`.
- Release process: tag releases in git (e.g., `v1.0.0`) and add changelog entries per the changelog spec; bump SemVer before tagging.
- Settings migration version: keep `formatVersion` distinct from SemVer and change it only when migration logic changes.

## Implementation approach
- Add a script: `scripts/sync-version.mjs`:
  - Reads canonical version
  - Writes derived versions (at minimum `manifest.json.version`; targets array is extensible)
  - Fails if versions diverge or required fields are missing (strict mode via `--check`)
- Wire script into npm scripts:
  - `predev`, `prebuild`, `pretest`
  - `version` so `npm version` keeps files in sync before the git commit/tag step
  - `check-version` for CI drift detection (`npm run check-version`)

## Acceptance criteria
- Bumping the version in the canonical file updates all other locations deterministically.
- No manual editing of version strings in multiple files.

## Tasks checklist
- [x] Decide canonical source
- [x] Decide whether to keep in-code version constant
- [x] Implement sync script + npm hooks
- [x] Update versions to 1.0.0
- [x] Add a short doc note (README or docs)
