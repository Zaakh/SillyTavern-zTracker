# Spec: Rename extension to zTracker

Status: Open
Last updated: 2026-01-21

## Goal
Rename the extension from **WTracker** to **zTracker** in a way that is clear to users and does not accidentally break existing stored tracker data.

## Scope
- Rename user-facing extension name in UI and metadata.
- Rename internal extension keys used for:
  - `extensionSettings` storage
  - per-message `message.extra` tracker payload
  - per-chat `chatMetadata`
  - global prompt interceptor function name
- Ensure template loading paths remain valid after rename.

## Open questions to clarify first
1. Migration policy:
   - Do we want a non-breaking migration from old keys (`WTracker`) to new keys (`zTracker`), or is this a breaking fork?
2. Folder name / install path:
   - What will the extension folder be named in SillyTavern after installation? (This affects template paths like `third-party/<folder>`.)
3. Branding:
   - Is the display name exactly `zTracker` (lowercase z) or `ZTracker`?
4. Backward compatibility window:
   - If we migrate, do we keep reading the legacy key for a while, or do a one-time copy and then drop support?

## Decisions (record once chosen)
- Chosen display name:
- Chosen internal key:
- Migration approach:

## Implementation plan (high level)
- Update `manifest.json` fields (`display_name`, `version`, `homePage`, `generate_interceptor`).
- Update internal constants (extension key, extension name).
- Update any hard-coded template base paths.
- Add a startup migration routine (if chosen).

## Acceptance criteria
- Shows as `zTracker` in Manage Extensions.
- Tracker generation, rendering, edit/delete/regenerate still works.
- Existing chats keep tracker data (if migration is chosen).
- No console errors related to template loading or missing interceptor.

## Tasks checklist
- [ ] Decide display name and internal key
- [ ] Decide migration approach
- [ ] Implement rename
- [ ] Implement migration (if chosen)
- [ ] Update docs (README + screenshots if needed)
- [ ] Add/update tests covering migration behavior

## Notes
- `generate_interceptor` must be a global function name (assigned to `globalThis`).
- Chat metadata references must be retrieved from `SillyTavern.getContext().chatMetadata` at time of use (don’t store references long-term).
