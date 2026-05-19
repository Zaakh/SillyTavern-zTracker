# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- zTracker settings now separate the default schema preset for new chats from the current chat schema preset used by full tracker generation.

### Fixed

- Current chat schema preset fallback now updates immediately when the selected preset becomes unavailable, instead of waiting for a later full generation to normalize chat metadata.
- TOON prompt-engineering tracker generation now sends a leaner schema and example prompt, reducing prompt bloat while keeping the same structured-output contract.

## [1.11.5] - 2026-05-18

### Added

- zTracker can now generate trackers from either the currently active SillyTavern connection or a specific saved connection profile.

### Fixed

- Full tracker redo now still works on early chat messages, even when `Skip First X Messages` would normally block first-time tracker generation there.
- Tracker regeneration now follows the active SillyTavern text-generation backend more reliably, including live connection aliases, runtime-selected backends, and live server URLs.

## [1.11.4] - 2026-05-13

### Changed

- Chat schema switching now documents and reinforces the existing lazy-switch behavior: future full tracker regenerations use the selected chat schema, while older trackers keep their saved schema until you run a full tracker regeneration for those messages.

## [1.11.3] - 2026-05-13

### Fixed

- Schema JSON and HTML preset editors now keep local drafts until you explicitly save, with disabled Save buttons and inline validation feedback for invalid drafts.

## [1.11.2] - 2026-05-13

### Fixed

- Tracker updates now roll back cleanly when chat saving fails, so the UI no longer claims changes were unsaved while still showing the new tracker state.
- Schema HTML edits now stay local until the Handlebars template parses successfully, matching the existing invalid-JSON draft behavior.
- Re-initializing the extension UI no longer duplicates message buttons or global click handlers.

### Changed

- Numeric tracker settings are now clamped to valid whole-number ranges in both the settings UI and startup repairs.

## [1.11.1] - 2026-05-05

### Fixed

- Full tracker generation now reliably uses the active chat's schema preset instead of falling back to the global selection.
- Manual tracker edits are now validated before saving, so broken tracker data is less likely to be stored.
- Stored trackers are now kept when a rerender fails, and affected messages show a warning badge instead of silently losing data.

### Changed

- Tracker values are now HTML-escaped by default during rendering. Templates that intentionally render raw HTML must opt in.

## [1.11.0] - 2026-05-05

### Added

- Added a `System Prompt Source` option so tracker generation can use different prompt presets than the active chat profile.

### Fixed

- Tracker generation now resolves the active SillyTavern presets correctly for both chat-completion and text-completion profiles.
- Embedded tracker messages configured as `system` now stay `system` instead of falling back to `assistant`.

## [1.10.3] - 2026-04-28

## [1.10.2] - 2026-04-27

### Fixed

- Mid-chat tracker snapshots injected into text-completion prompts now preserve valid `[INST]...[/INST]` framing across embed-role settings.

## [1.10.1] - 2026-04-22

### Fixed

- Text-completion tracker generation now uses the active SillyTavern context preset, avoiding `Preset undefined not found` errors during regeneration.

## [1.10.0] - 2026-04-22

### Added

- Added a tracker-generation `Conversation role handling` setting so user turns can be relabeled as assistant turns before a tracker request is sent.

### Fixed

- Embedded tracker snapshots now keep their configured roles when conversation-role normalization is enabled.

## [1.9.0] - 2026-04-21

### Added

- Added tracker cleanup tools for clearing selected parts, array items, or fields before optionally regenerating them.

### Fixed

- Parts and field menus no longer expose bogus `required` entries from JSON Schema metadata.
- Prompt-engineered tracker generation is less likely to be confused by placeholder-heavy schema examples.
- Tracker cleanup now follows array items more reliably across regenerations and keeps using the message's stored schema preset.

## [1.8.0] - 2026-04-17

### Added

- Manual tracker updates now show a message-local status badge during generation and regeneration.

## [1.7.2] - 2026-04-17

### Fixed

- Text-completion tracker generation now follows SillyTavern's live prompt formatting more closely, preserving speaker names and reducing malformed prompt failures.
- Outgoing auto mode now pauses the host reply cleanly while zTracker runs, avoids duplicate replies, and keeps its pending and stop state visible.

## [1.7.1] - 2026-04-16

### Changed

- zTracker now requires SillyTavern 1.17+.

### Fixed

- Tracker generation now uses the prompt selectors currently active in SillyTavern instead of stale saved profile values.
- Outgoing auto mode now waits more reliably for tracker generation before the first host auto-reply and clears stale hold state when chats change.
- Schema preset changes now persist more reliably, and invalid local schema drafts are no longer overwritten silently.

## [1.7.0] - 2026-04-14

### Added

- Added a per-character auto-mode exclusion toggle so selected characters can skip automatic tracker generation without disabling manual generation.

### Fixed

- The character-panel toggle now works correctly in SillyTavern 1.17's current character editor.

## [1.6.0] - 2026-04-13

### Added

- Added an opt-in `Inject as virtual character` setting for embedded tracker snapshots, reducing doubled speaker labels in prompts.

## [1.5.5] - 2026-04-13

### Changed

- Reorganized the settings UI into separate Tracker Generation and Tracker Injection sections, and moved prompt-engineering controls closer to their templates.

## [1.5.4] - 2026-04-13

### Added

- Added richer diagnostics in the zTracker settings panel, including the last tracker-generation request and clearer embed-header information.

### Fixed

- Tracker generation now avoids `Preset undefined not found` errors when text-completion prompt assembly needs fallback presets.
- Speaker names are now preserved more reliably in both tracker generation and normal chat interception.

## [1.5.3] - 2026-04-02

### Fixed

- Tracker generation now skips unset system-prompt selections instead of triggering `Preset undefined not found` errors.
- Embedded tracker snapshots no longer appear as named chat turns during normal generations.

## [1.5.2] - 2026-04-02

### Fixed

- Chat-completion profiles no longer mis-handle instruct presets during tracker generation.

## [1.5.1] - 2026-04-02

### Fixed

- Blank or unset preset slots no longer trigger `Preset undefined not found` errors during tracker generation.

## [1.5.0] - 2026-04-01

### Added

- Added a `Skip character card in tracker generation` setting so tracker extraction can ignore character-card prompt content when needed.

## [1.4.0] - 2026-04-01

### Added

- Added a `Skip First X Messages` tracker-generation setting so zTracker can wait for more chat context before extracting a tracker.

## [1.3.1] - 2026-03-30

### Fixed

- Tracker generation now preserves speaker attribution more reliably in one-on-one chats.
- Tracker-generation requests now send cleaner chat context to the model for more reliable results.
- The default TOON prompt now steers models toward cleaner TOON output, and older installs upgrade to the improved template automatically.

## [1.3.0] - 2026-03-20

### Added

- Added a built-in `TOON (compact)` transform preset for embedded tracker snapshots.
- Added TOON as a prompt-engineering mode alongside JSON and XML.

### Fixed

- XML and TOON generation now stays aligned with the current schema more reliably, and older installs upgrade to the improved shipped templates automatically.
- XML and TOON reply repair now handles more malformed model responses.
- zTracker now warns when dependency-linked arrays become inconsistent.

## [1.2.1] - 2026-03-17

### Fixed

- Tracker generation now tolerates a wider set of near-valid JSON formatting defects before failing.

## [1.2.0] - 2026-03-17

### Added

- Tracker generation can now use either the selected connection profile's system prompt or a specifically chosen saved SillyTavern system prompt.
- zTracker now installs a recommended `zTracker` system prompt preset and warns when that tracker-only prompt matches SillyTavern's active global system prompt.

### Fixed

- Tracker-only saved system prompt mode no longer mutates SillyTavern's global prompt preference during prompt assembly.

## [1.1.4] - 2026-03-06

### Fixed

- Parts menus now clean up correctly after tracker edits and partial regenerations, so duplicate or stuck overlays are less likely.
- `Regenerate individual parts` menus now close reliably after field regeneration.

## [1.1.3] - 2026-01-28

### Fixed

- Parts menu array submenus are no longer clipped to the tracker height.

## [1.1.2] - 2026-01-28

### Fixed

- Minimal embedded tracker snapshots are now more compact and LLM-friendly.

## [1.1.1] - 2026-01-28

### Fixed

- Aligned the `Regenerate individual parts` icon in the tracker controls.

## [1.1.0] - 2026-01-27

### Added

- Added sequential per-part tracker generation with dependency-aware ordering.
- Added per-part, per-array-item, and per-field regeneration controls on messages.
- Added schema annotations for part ordering and array identity via `x-ztracker-dependsOn` and `x-ztracker-idKey`.

### Fixed

- Parts menus now show better item previews, render above chat content, and inherit theme styling correctly.
- Field-level regeneration prompts now omit the old field value to reduce accidental repetition.
- Full regeneration no longer resends the previous tracker as prompt context, and embedded snapshot injection now also covers regenerate flows.

## [1.0.2] - 2026-01-26

### Added

- Hover tooltips for zTracker settings.

## [1.0.1] - 2026-01-26

### Fixed

- Fixed HTML template loading when installed under the default SillyTavern folder name (`SillyTavern-zTracker`).

## [1.0.0] - 2026-01-26

### Added

- Added a World Info policy for tracker generation, including allowlist mode by lorebook name or entry UID.
- Added an allowlist picker UI for easier World Info selection.
- Added diagnostics tooling and debug logging for extension troubleshooting.
- Added configurable embedded tracker roles and snapshot headers.
- Added named, savable regex transform presets for embedded tracker snapshots.
