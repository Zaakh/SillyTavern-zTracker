# Spec: Add CHANGELOG.md

Status: Open
Last updated: 2026-01-21

## Goal
Add a `CHANGELOG.md` and keep it updated as zTracker evolves.

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
- [ ] Decide format
- [ ] Create file + initial content
- [ ] Add contributor guideline for updating it (optional)
