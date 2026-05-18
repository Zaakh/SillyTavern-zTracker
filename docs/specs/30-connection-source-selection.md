# Connection Source Selection For Tracker Generation

## Summary

Add an explicit zTracker setting that lets the user choose where tracker generation gets its connection configuration:

- `Use current active SillyTavern connection`
- `Use selected saved connection profile`

This keeps the existing ability to pin zTracker to any saved SillyTavern connection profile, while also allowing zTracker to follow whatever connection/profile is currently active in SillyTavern at generation time.

Confirmed decision:
- "Current connection settings" means the live connection state currently active in SillyTavern when tracker generation starts.
- Active mode must not require those settings to already be saved as a named connection profile.
- If the user has live connection changes that are not saved back into a profile yet, zTracker should still follow those live settings in active mode.

## Current State

- [src/config.ts](../../src/config.ts) persists exactly one connection reference for tracker generation: `profileId: string`.
- [src/components/Settings.tsx](../../src/components/Settings.tsx) always shows a single `Connection Profile` selector backed by `settings.profileId`.
- [src/ui/tracker-actions.ts](../../src/ui/tracker-actions.ts) currently requires `settings.profileId` and throws `Please select a connection profile in settings.` when it is empty.
- zTracker already has adjacent source-selection UI for prompt state. [src/components/settings/SystemPromptSettingsSection.tsx](../../src/components/settings/SystemPromptSettingsSection.tsx) distinguishes between active SillyTavern presets, connection-profile presets, and saved prompts.
- Existing docs and specs already treat SillyTavern runtime state as the source of truth for active prompt settings and chat type in several areas; the connection-profile selector is the remaining place where zTracker still requires an explicitly pinned saved profile.

## Problem Statement

Users currently cannot tell zTracker to simply use the connection that is already active in SillyTavern. They must pick and persist a separate saved connection profile inside zTracker, even when they want tracker generation to follow their current SillyTavern selection.

That creates avoidable friction and splits ownership:

- SillyTavern already owns the live active connection state.
- zTracker still forces a second explicit profile choice.

The settings UI should make both workflows explicit:

- follow the current active SillyTavern connection, or
- pin zTracker to a specific saved connection profile.

## User Value

- Reduces duplicate configuration when the user wants zTracker to follow the same connection they are already using in SillyTavern.
- Preserves the existing advanced workflow where tracker generation should stay pinned to a different saved profile.
- Makes the connection-selection contract as explicit as the existing system-prompt-source controls.

## Goals

- Add an explicit connection-source choice to zTracker settings.
- Support both `active` and `saved-profile` behavior without removing the current saved-profile workflow.
- Resolve the effective connection/profile at generation time so active mode tracks live SillyTavern changes.
- Keep the UI understandable and consistent with the existing source-selection patterns in zTracker.
- Preserve backward compatibility for users who already selected a saved profile.

## Non-Goals

- Supporting multiple fallback profiles or profile lists.
- Replacing SillyTavern's own connection-profile editor or manager.
- Changing prompt-engineering modes, schema behavior, or tracker rendering.
- Reworking the existing system-prompt-source feature beyond the interactions needed for this setting.

## Open Questions

- Which stable SillyTavern runtime API or context field should zTracker use to resolve the currently active live connection state in 1.17 and later?
- If some downstream helper still expects a saved profile object or ID, what is the smallest compatibility layer needed so active mode can continue using live unsaved settings without reintroducing a zTracker-local copy of connection policy?
- In `active` mode, when `System Prompt Source = From connection profile presets`, should that mean the presets attached to the active connection profile at generation time? This is the expected behavior, but it should be verified against the final implementation path.

## Proposed Approach

### Recommended UI shape

Add a new setting above the existing connection-profile selector:

- `Connection Source`
  - `Use current active SillyTavern connection`
  - `Use selected saved connection profile`

Then make the existing `Connection Profile` selector conditional:

- show it only when `Connection Source = Use selected saved connection profile`, or
- keep it visible but disabled in active mode with helper text.

Recommendation:
- Use a separate `Connection Source` dropdown plus a conditional `Connection Profile` selector.
- This is clearer than overloading the existing profile dropdown with a synthetic option like `Current active connection`.

### Options considered

#### Option A: Synthetic entry inside the existing profile dropdown

Effect:
- Add a fake first option such as `Current active SillyTavern connection` to the existing profile selector.

Advantages:
- Smallest visible UI change.
- Reuses the current control.

Disadvantages:
- Mixes a live runtime source with saved profile records in one list.
- Makes saved-state handling, labels, and validation less explicit.

Risks:
- Higher chance of confusing code paths that assume the dropdown always returns a real saved profile ID.

#### Option B: Dedicated source selector plus conditional saved-profile selector

Effect:
- Add a new `Connection Source` setting and keep the existing profile picker only for the saved-profile mode.

Advantages:
- Matches zTracker's existing `System Prompt Source` pattern.
- Keeps runtime-owned versus saved-owned behavior explicit.
- Simplifies validation and migration.

Disadvantages:
- Adds one extra row to settings.

Risks:
- Requires touching a few more UI and settings branches than Option A.

Recommendation:
- Proceed with Option B unless a local SillyTavern API limitation makes active-mode resolution materially harder than expected.

### Settings model

Add a new persisted setting in [src/config.ts](../../src/config.ts):

```ts
connectionSource: 'active' | 'saved';
```

Behavior:

- `saved`: use `settings.profileId` exactly as today.
- `active`: resolve the current live SillyTavern connection state at generation time and ignore `settings.profileId` for request routing.

Migration direction:

- Default new installs and existing installs to `connectionSource: 'saved'` so current behavior is preserved.
- Keep the existing `profileId` field unchanged for backward compatibility.
- If an existing install has no saved `profileId`, do not silently switch behavior; require the user to choose `active` explicitly or pick a saved profile.

### Runtime resolution

Introduce a small helper that resolves the effective connection/profile before tracker generation begins.

Expected flow:

1. Read `connectionSource`.
2. If `saved`, resolve the saved profile from `settings.profileId` exactly as today.
3. If `active`, resolve the currently active SillyTavern live connection state from runtime state at the moment generation starts, even if it does not map back to a saved profile.
4. Reuse the resulting effective profile object for:
   - API selection,
   - request dispatch,
   - prompt-building context that still depends on profile data,
   - error messages and debug snapshots.

### Interaction with existing prompt-source features

This feature should compose with the existing system-prompt-source modes rather than replace them.

Expected interaction rules:

- `System Prompt Source = From active SillyTavern presets` remains fully runtime-owned and is unaffected.
- `System Prompt Source = From connection profile presets` should use the presets from the effective profile resolved by `connectionSource`.
- `System Prompt Source = From saved ST prompt` remains independent from connection source.

### Error handling

Active-mode failures should be explicit and SillyTavern-oriented.

Preferred examples:

- `No active SillyTavern connection could be resolved for tracker generation.`
- `The active SillyTavern connection is missing required profile data.`

Avoid errors that still imply the user must always pick a saved zTracker profile when `connectionSource = 'active'`.

## Risks and Dependencies

- Depends on a stable SillyTavern runtime way to identify the active connection/profile.
- Active mode may expose edge cases where the live runtime state differs from what is stored on a saved profile.
- Existing tests and helpers currently assume `settings.profileId` is always the source of truth, so they will need targeted updates.
- Debug output and user-facing messages should reflect the effective connection source to avoid support confusion.

## Affected Areas

- [src/config.ts](../../src/config.ts): add `connectionSource` type/defaults.
- [src/components/Settings.tsx](../../src/components/Settings.tsx): add `Connection Source` UI and conditionally show or disable the existing profile selector.
- [src/ui/tracker-actions.ts](../../src/ui/tracker-actions.ts): resolve the effective connection/profile from `connectionSource` before prompt assembly and request dispatch.
- [src/ui/debug.ts](../../src/ui/debug.ts): report the effective connection source and runtime-selected transport fields in tracker diagnostics.
- [src/__tests__/](../../src/__tests__): add or update tests covering active-mode resolution, saved-mode backward compatibility, and related error handling.
- [readme.md](../../readme.md): document the two connection-source modes.
- [CHANGELOG.md](../../CHANGELOG.md): add an Unreleased entry when implementation begins.

## Acceptance Criteria

- zTracker settings expose an explicit `Connection Source` choice.
- Users can choose `Use current active SillyTavern connection` without also selecting a saved zTracker connection profile.
- Users can still pin zTracker to any saved SillyTavern connection profile.
- In active mode, changing the active SillyTavern connection and then generating a tracker uses that new active connection without further zTracker changes.
- In active mode, live connection changes that are currently active in SillyTavern are used even if they have not been saved into a named connection profile.
- In saved mode, existing behavior remains unchanged for installs that already use `profileId`.
- Error messages distinguish between active-mode resolution failures and saved-profile-selection failures.
- Tests cover at least one active-mode path and one saved-mode regression path.

## Implementation Plan

1. Confirm the stable SillyTavern runtime API for resolving the current active live connection state.
2. Add `connectionSource` to [src/config.ts](../../src/config.ts) with backward-compatible defaults.
3. Update [src/components/Settings.tsx](../../src/components/Settings.tsx) to add the new source selector and conditional saved-profile picker.
4. Add a helper in the tracker-generation path to resolve the effective connection from either active runtime state or `settings.profileId`.
5. Update tracker-generation error messages and debug output to report the effective connection source clearly.
6. Add focused tests for active mode, saved mode, and unresolved-active-connection failures.
7. Update [readme.md](../../readme.md) and [CHANGELOG.md](../../CHANGELOG.md).
8. Run a critical review for stale wording that still assumes `profileId` is always required.

## Status

In Implementation

## Verification

- Added active-mode regression coverage in [src/__tests__/tracker-actions.prompt-assembly.test.ts](../../src/__tests__/tracker-actions.prompt-assembly.test.ts) for both chat-completion and `textgenerationwebui` tracker generation without a saved `profileId`, including reuse of a live active profile id when the host exposes one.
- Added focused settings UI coverage in [src/__tests__/settings-ui.test.ts](../../src/__tests__/settings-ui.test.ts) for the `Connection Source` toggle and conditional saved-profile selector.
- Expanded tracker diagnostics coverage in [src/__tests__/ui-debug.test.ts](../../src/__tests__/ui-debug.test.ts) so debug snapshots now record the effective connection source and runtime-selected transport fields.
- Ran `npm test` successfully.
- Ran `npm run build` successfully.
- Updated [src/config.ts](../../src/config.ts), [src/components/Settings.tsx](../../src/components/Settings.tsx), [src/ui/tracker-actions.ts](../../src/ui/tracker-actions.ts), [src/ui/debug.ts](../../src/ui/debug.ts), [readme.md](../../readme.md), and [CHANGELOG.md](../../CHANGELOG.md) to match the implemented behavior.
- Local automated validation is complete, but live SillyTavern smoke testing is still pending. The remaining host-level check is to verify that switching the active connection in the real UI changes tracker generation immediately in `Connection Source = Use current active SillyTavern connection` mode, including when the active connection has unsaved changes.