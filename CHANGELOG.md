# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Text-completion tracker-generation requests now pass the active instruct preset as request-local transport state instead of temporarily mutating the selected connection profile, avoiding cross-request races when multiple generations overlap.
- Outgoing auto mode now blocks only the first host auto-reply start after a user message while tracker generation is pending, instead of continuing to stop every later generation-start event until the tracker run finishes.
- Outgoing auto mode now marks the pending user message while its reply is on hold, showing a message-local "Generating tracker before reply" status until the tracker pass completes or fails.
- Legacy `autoMode: "input"` settings are now migrated to the current SillyTavern enum value during startup, so outgoing auto mode no longer needs a runtime compatibility branch.
- Outgoing auto mode now clears its pending hold state on chat changes, preventing a tracker run from the previous chat from resuming generation in the newly opened chat.
- `manifest.json` now declares `minimum_client_version: 1.17.0` because the request-local text-completion transport is only verified against the current SillyTavern 1.17 host surface.

## [1.7.1] - 2026-04-15

### Fixed

- Tracker generation now resolves prompt selectors from the configs currently active in SillyTavern instead of the saved selector fields on the chosen connection profile, and text-completion transport now passes the active instruct preset as request-local state so the final request matches the live host prompt configuration without mutating the shared profile.
- Auto mode now correctly triggers tracker generation for "Process inputs" again by aligning the settings value with the runtime enum and migrating legacy `input` values to the current SillyTavern setting.
- Outgoing auto mode now aborts the host's first auto-reply pass, waits for tracker generation to finish and save when possible, and then resumes normal chat generation so the next reply uses the freshly updated tracker or still proceeds when tracker generation fails.
- Schema preset changes in the settings UI now persist reliably across create, rename, delete, and reselection flows, and the embed snapshot transform preset manager now uses the same stable preset-selection logic.
- Invalid schema JSON drafts are no longer overwritten silently by schema preset changes or related settings rerenders; zTracker now keeps the local draft on the current preset and warns before preset actions that would discard it.

## [1.7.0] - 2026-04-14

### Added

- Added a per-character auto-mode exclusion toggle on the character panel so zTracker can skip automatic tracker generation for selected characters without disabling manual tracker generation.

### Fixed

- Updated the character-panel toggle injection to match SillyTavern 1.17's current character info button row so the per-character truck button appears in the live character editor.
- The per-character truck toggle now accepts the live host's string-form `characterId` values, so clicking the button correctly updates the selected character's auto-mode exclusion state.

## [1.6.0] - 2026-04-13

### Added

- Added an opt-in `Inject as virtual character` tracker-injection setting that sends embedded tracker snapshots with a speaker name derived from the embed header, avoiding double labels such as `Assistant: Tracker:` when SillyTavern includes names in prompts.

## [1.5.5] - 2026-04-13

### Changed

- Reorganized the zTracker settings UI into separate Tracker Generation and Tracker Injection sections, keeping shared connection-profile and diagnostics controls outside those two areas for faster navigation.
- Moved the Prompt Engineering selector next to the prompt template editors so mode selection and template editing stay in the same settings block.

## [1.5.4] - 2026-04-13

### Added

- Added a live diagnostics snapshot for the last tracker-generation request so debug mode now captures both the pre-sanitize prompt messages and the final sanitized prompt text shown through the zTracker diagnostics panel.
- Added clearer embed-snapshot header diagnostics so the active injected label is shown explicitly and no longer gets confused with the settings placeholder text.

### Fixed

- Tracker generation now supplies valid instruct and system-prompt fallbacks for SillyTavern text-completion prompt assembly, avoiding live `Preset undefined not found` console errors while preserving the configured saved tracker prompt behavior.
- Tracker-generation requests now preserve speaker names from SillyTavern prompt-builder source messages when instruct-mode prompt assembly keeps attribution outside the flattened message content.
- Text-completion tracker-generation requests now inline assistant and user speaker labels into the final prompt content when the downstream API ignores structured `name` metadata, without duplicating labels that are already present.
- Normal instruct-mode chat interception now preserves speaker names from `message.source.name` on regular chat turns, so SillyTavern can still render named dialogue while injected zTracker snapshot messages remain anonymous context blocks.

## [1.5.3] - 2026-04-02

### Fixed

- Tracker generation now omits an unset connection-profile system-prompt selection before calling SillyTavern prompt assembly, avoiding live browser errors such as `Preset undefined not found` when the profile uses the global/default system prompt.
- Embedded zTracker snapshots in normal generations no longer masquerade as named chat turns, so tracker state stays separated from dialogue via the configured embed role and header alone.

## [1.5.2] - 2026-04-02

### Changed

- Consolidated SillyTavern extension-development guidance into the new general skill at `.github/skills/sillytavern-extension-development/` and retired the older standalone SillyTavern notes from `docs/`.

### Fixed

- Tracker prompt assembly now only forwards instruct presets when the selected SillyTavern connection profile uses a text-completion API family, so zTracker no longer treats the mere presence of `profile.instruct` as a mode decision for chat-completion profiles.

## [1.5.1] - 2026-04-02

### Fixed

- Tracker generation now omits unset or blank connection-profile preset slots before calling SillyTavern prompt assembly, avoiding browser console errors such as `Preset undefined not found` while preserving valid preset selections.

## [1.5.0] - 2026-04-01

### Added

- Added a `Skip character card in tracker generation` setting so tracker extraction can optionally ignore character-card prompt fields such as description, personality, and scenario.

## [1.4.0] - 2026-04-01

### Added

- Added a `Skip First X Messages` tracker-generation setting so zTracker can ignore the opening messages in a chat until there is enough context to produce useful tracker data.

## [1.3.1] - 2026-03-30

### Added

- Added an on-demand `npm run debug:tracker-context:json` harness that prints one captured JSON-mode tracker-generation request, including injected tracker snapshots and the structured-output schema payload.
- Added matching `npm run debug:tracker-context:xml` and `npm run debug:tracker-context:toon` harnesses for the prompt-engineered XML and TOON generation paths.
- Added inspectable markdown request snapshots under `test-output/` for the live-like JSON, XML, and TOON tracker-generation examples.
- Added matching plain-text prompt snapshots under `test-output/` for the same JSON, XML, and TOON examples; these now target the live verified raw text-completion transport shape rather than a role-labeled inspection view.

### Fixed

- Tracker generation now requests named turns from SillyTavern prompt assembly so one-on-one chats can preserve speaker attribution like `Tobias:` and `Bar:` for clearer pronoun resolution.
- Tracker-generation requests now strip SillyTavern/UI-only message fields such as `source`, `mes`, temporary `zTrackerFound` markers, and related helper flags before sending prompt context to the LLM.
- Tracker-context debug harnesses now use a live-like `Bar` fixture across JSON, XML, and TOON so the captured local request shape matches SillyTavern's real prompt-engineered tracker context more closely.
- The shipped TOON prompt now more explicitly forbids JSON-like wrappers and braces, reinforces scalar and array layout rules, and auto-migrates installs that still have the previous weaker default TOON prompt.
- Live verification showed that the current tracker-generation path also includes character-card prompt content from `buildPrompt(...)` and is flattened downstream into a raw `prompt` string for the active text-completion connection profile.

## [1.3.0] - 2026-03-20

### Added

- Embedded tracker snapshots now support a built-in **TOON (compact)** transform preset, using tab-delimited TOON for lower-token prompt context while preserving structured data fidelity.
- TOON is now available as a prompt-engineering mode alongside JSON and XML.

### Fixed

- Prompt-engineering now translates the canonical JSON schema into XML or TOON correctly, and existing installs upgrade older shipped XML/TOON prompt templates automatically.
- zTracker now installs a versioned recommended saved system prompt preset so older saved prompts can coexist safely.
- XML and TOON reply repair now covers additional live small-model failure shapes, including broken opening XML tags and TOON object-array blocks.
- Malformed model payloads are now logged uniformly for JSON, XML, and TOON parser failures, and prompt-engineered render rollbacks keep the raw payload attached for diagnosis.
- Tracker updates now warn when dependency-linked arrays are inconsistent, such as a listed character missing its matching detail entry.
- Production builds no longer emit webpack's default web-app performance warnings for the extension's single-file bundle.

## [1.2.1] - 2026-03-17

### Fixed

- Tracker generation now tolerates a small set of near-valid JSON formatting defects before failing, including repeated fences, balanced JSON wrapped in prose, trailing commas, smart quotes used as JSON delimiters, and leading invisible characters. Repair attempts are logged so prompt/parser issues remain diagnosable.

## [1.2.0] - 2026-03-17
### Added

- Tracker generation can now use either the selected connection profile's system prompt or a specifically chosen saved SillyTavern system prompt.
- zTracker now installs a recommended `zTracker` system prompt preset for tracker generation and exposes the selector in extension settings.
- zTracker settings now warn when the tracker-only saved system prompt matches SillyTavern's currently active global system prompt, because that configuration can make normal chat generations use the extraction prompt too.

### Fixed

- Tracker-only saved system prompt mode no longer temporarily mutates SillyTavern's global prompt-preference setting during prompt assembly, avoiding cross-generation leakage.

## [1.1.4] - 2026-03-06
### Fixed

- Parts menu no longer appears twice (with a duplicate stuck in the upper-left corner) after editing tracker data and then triggering a partial regeneration. When the tracker DOM was re-rendered the portaled menu list was not cleaned up because the now-disconnected `<details>` element could not fire a `toggle` event to the document; the cleanup now runs directly in that case.
- “Regenerate individual parts” menus can now be closed reliably after regenerating a field. Switching between message menus no longer leaves stale portaled overlays behind due to async `toggle` close-event timing.

## [1.1.3] - 2026-01-28

### Fixed

- Parts menu array submenus are no longer clipped to the tracker height.

## [1.1.2] - 2026-01-28

### Fixed

- Minimal embedded tracker snapshots are more compact and LLM-friendly (no blank lines/trailing whitespace, fewer unnecessary quotes, bracket-wrapped array items).

## [1.1.1] - 2026-01-28

### Fixed

- Align the “Regenerate individual parts” (list) icon in the tracker controls.

## [1.1.0] - 2026-01-27

### Added

- Sequential per-part tracker generation mode (dependency-aware via current tracker snapshot).
- Per-part and per-array-item regeneration controls on messages.
- Schema annotations for part ordering and array identity: `x-ztracker-dependsOn` and `x-ztracker-idKey`.
- Per-field regeneration for object array items (e.g., regenerate `characters.outfit` for a single character).

### Fixed

- Parts menu usability: array submenus show item previews (instead of generic "items") and render above chat content.
- Parts menu styling is theme-aware and avoids transparent backgrounds.
- Field-level regeneration prompts omit the old field value to reduce accidental repetition.
- Full tracker regeneration no longer sends the prior tracker as prompt context; part/item regeneration redacts the target content to reduce repetition anchoring.
- Embedded tracker snapshot injection now considers the last message in the prompt chat array (fixes missing injection for SillyTavern Options → Regenerate).

## [1.0.2] - 2026-01-26

### Added
- Hover tooltips for zTracker settings to explain what options do.

## [1.0.1] - 2026-01-26

### Fixed
- Fix HTML template loading when installed under the default SillyTavern folder name (`SillyTavern-zTracker`) to avoid 404s like `/third-party/zTracker/dist/templates/*.html`.

## [1.0.0] - 2026-01-26

### Added
- World Info policy for tracker generation: include all, exclude all, or allowlist by lorebook name / entry UID.
- Allowlist picker UI (refresh + search + add/remove) to avoid manual entry.
- Debug logging toggle and Diagnostics tool for quickly verifying extension template URLs.
- Setting to choose the role used when embedding zTracker snapshots into normal generations (user/system/assistant).
- Named, savable regex transform presets for embedded zTracker snapshots (default JSON + minimal top-level formatting).
- Setting to customize (or remove) the embedded snapshot header line.

### Changed
- Extension template bundling now uses `dist/templates` to match SillyTavern’s packaged artifact expectations.
- Extension install folder is detected at runtime for template rendering (no hardcoded third-party folder name).

