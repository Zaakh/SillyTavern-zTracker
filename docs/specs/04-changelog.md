# Spec: Add CHANGELOG.md

Status: Completed
Last updated: 2026-01-22

## Goal
Add a `CHANGELOG.md` and keep it updated as zTracker evolves.

## Current state
- Root changelog lives at [CHANGELOG.md](CHANGELOG.md#L1-L12) using Keep a Changelog format with `Unreleased` and a dated `1.0.0` (2026-01-22) entry.
- README links to the changelog and now includes a brief guideline for keeping it updated ([readme.md#L52-L59](readme.md#L52-L59)).

## Open questions to clarify first
1. Format preference:
   - Keep a Changelog format? (recommended) -> yes
2. Where should it live?
   - Root-level `CHANGELOG.md` is conventional. -> yes
3. Release cadence:
   - Update changelog on every PR/merge, or only when cutting releases? -> on every version bump

## Proposed approach
- Create root-level `CHANGELOG.md` using “Keep a Changelog” style.
- Start with `1.0.0` entry describing the fork’s first release.

## Acceptance criteria
- `CHANGELOG.md` exists at repo root.
- Includes at least `1.0.0` section.
- (Optional) Linked from README.

## Tasks checklist
- [x] Decide format (Keep a Changelog)
- [x] Create root-level `CHANGELOG.md`
- [x] Add `1.0.0` release entry
- [x] Link changelog from README (optional)
- [x] Add contributor guideline for updating it (optional)
