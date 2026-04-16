# Spec: Use SillyTavern's selected chat type for tracker generation

Status: Completed
Last updated: 2026-04-02

## Goal

Make zTracker follow the chat type currently selected in SillyTavern when generating trackers. zTracker must not make its own Chat Completion vs instruct/Text Completion decision.

## Summary

zTracker currently builds tracker-generation prompts from the connection profile selected in zTracker settings and passes profile-specific preset fields such as `preset`, `context`, and `instruct` into SillyTavern prompt assembly. The code mostly delegates final prompt construction to SillyTavern utilities, but the extension still exposes mode-specific behavior in its own flow and in its documentation.

This spec changes the ownership boundary:
- **SillyTavern is the source of truth** for the active chat type / completion mode.
- zTracker may still select **which connection profile** to use for tracker generation.
- zTracker must **not** independently decide whether tracker generation should behave like Chat Completion or instruct/Text Completion.
- Tracker generation should follow the same mode SillyTavern would use for that profile at the moment the request is made.

## Motivation

The current behavior is confusing for users because zTracker still looks and feels like it has special rules for different completion modes.

Concrete signals of that confusion today:
- The README explicitly tells users to configure different profile fields for **Text Completion** and **Chat Completion**.
- `prepareTrackerGeneration()` in `src/ui/tracker-actions.ts` passes profile-specific preset selections into `buildPrompt(...)`, including `instruct` when present.
- zTracker's tracker-generation path therefore still appears to care about which completion style is being used, even though SillyTavern should own that decision.

The desired behavior is simpler: if the user changes the active mode in SillyTavern, zTracker should follow it automatically instead of having its own parallel interpretation.

## Current behavior (baseline)

### Prompt assembly

1. `prepareTrackerGeneration()` looks up the zTracker-selected connection profile.
2. It resolves `profile.api` and maps that through `CONNECT_API_MAP`.
3. It calls `buildPrompt(apiMap.selected, ...)` and passes the runtime-owned prompt selectors returned by `getPromptPresetSelections(apiMap.selected, { ... })`.
4. Those prompt selectors are limited to the active instruct/system-prompt state SillyTavern needs for text-completion assembly.

Relevant current code:
- `src/ui/tracker-actions.ts`
- `src/ui/tracker-action-helpers.ts`

### User-visible result

- zTracker behavior is still described in terms of **Text Completion** vs **Chat Completion**.
- The prompt-build path is still coupled to profile fields that are mode-specific, especially `instruct`.
- Even if SillyTavern does the final prompt formatting, zTracker is still shaping the mode-specific inputs instead of treating SillyTavern's current mode as authoritative.

## Problem statement

zTracker should not own mode selection logic. Whether the current code is making that decision directly or indirectly through profile-field assumptions, the observable result is still the same: users have to think about zTracker in terms of Chat Completion vs instruct/Text Completion.

That ownership is wrong. SillyTavern already knows which chat type is active and how the request should be formatted. zTracker should only assemble tracker-specific content and then hand off to SillyTavern using the currently selected mode.

## Goals

- Use SillyTavern's currently selected chat type as the only source of truth for tracker generation mode.
- Remove zTracker-owned branching or assumptions about Chat Completion vs instruct/Text Completion wherever feasible.
- Keep tracker generation compatible with the selected zTracker connection profile for API key, model, and other profile-specific settings.
- Make tracker generation automatically follow mode changes made in SillyTavern without requiring a separate zTracker mode choice.
- Update user-facing docs so they no longer describe tracker generation as needing different zTracker-side behavior for Chat Completion vs Text Completion.

## Non-goals

- Removing zTracker's connection-profile selector.
- Changing prompt-engineering modes such as Native API / JSON / XML / TOON.
- Redesigning SillyTavern's own profile or prompt-management UI.
- Changing tracker-specific prompt content, schema handling, or render logic.

## Detailed design

### 1. Treat SillyTavern runtime state as authoritative

At tracker-generation time, zTracker should resolve the effective chat type from SillyTavern runtime state rather than inferring it from its own local assumptions.

Design rule:
- zTracker may select the connection profile.
- SillyTavern must determine whether that request is handled as Chat Completion or instruct/Text Completion.

If the current generator path already respects the active SillyTavern mode when called with `profileId`, keep that behavior and remove any redundant zTracker-side mode selection.

### 2. Narrow zTracker's responsibility during prompt assembly

`prepareTrackerGeneration()` should be responsible for:
- choosing the tracker target range,
- injecting tracker-specific context,
- selecting system-prompt source,
- applying tracker-specific world-info rules,
- adding tracker prompt instructions.

It should not be responsible for deciding which completion family is active.

### 3. Stop treating mode-specific preset slots as zTracker-owned policy

`getPromptPresetSelections(...)` now resolves active runtime instruct and system-prompt selectors for text-completion assembly instead of forwarding saved profile preset slots.

Implementation direction:
- only forward preset fields that are relevant to the chat type SillyTavern says is currently active,
- or delegate the entire preset-selection decision to a SillyTavern helper/runtime API if one is available.

The important constraint is that zTracker must not decide "use instruct" just because an `instruct` field exists on the profile.

### 4. Error messages must describe SillyTavern-owned state

When tracker generation cannot proceed because the selected mode is missing required presets or settings, zTracker should report that in SillyTavern terms.

Examples of preferred wording:
- "The selected SillyTavern chat type is missing a required preset."
- "Tracker generation uses the active SillyTavern chat type for this profile; please complete the missing preset there."

Avoid wording that implies zTracker chose the mode itself.

### 5. Documentation cleanup

When this spec is implemented:
- remove the README section that separately instructs users how to configure Text Completion vs Chat Completion for zTracker,
- document that zTracker follows the active SillyTavern chat type,
- update any troubleshooting text that still implies zTracker has its own mode decision.

## Open questions

1. Which SillyTavern runtime field or helper is the stable source of truth for the active chat type in 1.17 and later?
2. Does `generator.generateRequest({ profileId, ... })` already fully inherit the active mode, making the main gap primarily prompt assembly rather than request dispatch?
3. If SillyTavern allows profile-level configuration that conflicts with a global mode toggle, which source should zTracker follow for tracker generation?
4. Can `buildPrompt(...)` be called in a way that fully delegates mode-specific preset selection to SillyTavern, or is a small compatibility shim still required in zTracker?

## Codebase change map

| File | Intended change |
|------|-----------------|
| `src/ui/tracker-actions.ts` | Resolve active mode from SillyTavern-owned state and remove any redundant zTracker-side mode assumptions during tracker generation. |
| `src/ui/tracker-action-helpers.ts` | Keep `getPromptPresetSelections(...)` limited to runtime-owned text-completion selectors so zTracker no longer treats `instruct` / other preset slots as its own policy decision. |
| `src/__tests__/tracker-actions.prompt-assembly.test.ts` | Add regression coverage that tracker generation only forwards `instructName` when SillyTavern is using a text-completion API family. |
| `readme.md` | Replace the current Text Completion / Chat Completion setup note with a simpler statement that zTracker follows the active SillyTavern chat type. |
| `CHANGELOG.md` | Add an Unreleased entry when implementation begins. |

## Acceptance criteria

- zTracker no longer contains user-visible logic that frames tracker generation as choosing between Chat Completion and instruct/Text Completion.
- Tracker generation follows the chat type currently selected in SillyTavern for the chosen profile/session.
- Changing the relevant SillyTavern chat type and then generating a tracker uses the new mode without any extra zTracker setting change.
- zTracker does not require or prefer the `instruct` preset unless the active SillyTavern mode actually uses it.
- README and related docs no longer instruct users to think in zTracker-specific Chat Completion vs Text Completion terms.
- Tests cover at least one mode switch or mode-resolution regression case.

## Tasks checklist

- [ ] Identify the authoritative SillyTavern runtime source for active chat type
- [ ] Audit prompt assembly for zTracker-owned mode assumptions
- [ ] Audit request dispatch for zTracker-owned mode assumptions
- [ ] Refactor preset-selection handling so mode ownership stays in SillyTavern
- [ ] Add regression tests for mode resolution
- [ ] Update README and CHANGELOG
- [ ] Manually verify tracker generation with both relevant SillyTavern chat types

## Verification plan

- Configure one profile that uses a Chat Completion path and one that uses an instruct/Text Completion path.
- Confirm tracker generation follows the active SillyTavern mode without changing zTracker-specific settings.
- Re-test prompt-engineering modes that sit on top of the generated message array or prompt body.
- Confirm no outdated mode-specific guidance remains in the README after implementation.

## Verification

- Added regression coverage in `src/__tests__/tracker-actions.prompt-assembly.test.ts` to verify `buildPrompt(...)` only receives `instructName` for `textgenerationwebui` profiles and omits it for `openai` chat-completion profiles.
- Ran `npm test -- --runInBand src/__tests__/tracker-actions.prompt-assembly.test.ts` successfully.
- README guidance was updated to describe SillyTavern as the owner of chat-type selection instead of presenting Chat Completion vs Text Completion as a zTracker-side decision.