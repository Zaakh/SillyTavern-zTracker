# Spec: Single-source versioning + SemVer (start 1.0.0)

Status: Open
Last updated: 2026-01-21

## Goal
Adopt semantic versioning and keep the version defined in **one authoritative place**, starting at **1.0.0**, with automatic sync to all other required locations.

## Scope
- Decide the canonical source of truth.
- Sync version into:
  - `manifest.json.version`
  - `package.json.version` (if not canonical)
  - any in-code version constants (if kept)

## Open questions to clarify first
1. Canonical version source:
   - `package.json` (recommended for Node tooling) or `manifest.json` (aligned with ST extension metadata)?
2. Do we want an in-code version constant at all?
   - If used only for migrations, we could rely on settings schema versioning instead.
3. Release process:
   - Will releases be tagged in git and accompanied by changelog entries?
4. Do we want “formatVersion” (settings migration version) to be separate from SemVer?

## Proposed decision
- Canonical: `package.json.version`
- `manifest.json.version` is derived
- Settings migration version (`formatVersion`) is separate and only changes when migration logic changes

## Implementation approach
- Add a script: `scripts/sync-version.mjs`:
  - Reads canonical version
  - Writes derived versions
  - Fails if versions diverge (optional strictness)
- Wire script into npm scripts:
  - `predev`, `prebuild`, `pretest` (optional)

## Acceptance criteria
- Bumping the version in the canonical file updates all other locations deterministically.
- No manual editing of version strings in multiple files.

## Tasks checklist
- [ ] Decide canonical source
- [ ] Decide whether to keep in-code version constant
- [ ] Implement sync script + npm hooks
- [ ] Update versions to 1.0.0
- [ ] Add a short doc note (README or docs)
