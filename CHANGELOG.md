# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.16.1] - 2026-10-21

### Changed

- Internal: test files now type-check cleanly; added `npm run typecheck` (also runs before `npm test`).

## [2.16.0] - 2026-10-21

### Added

- **Export to lorebook...** and **Replace linked entry** buttons on each tracker block: copy a tracker into a World Info entry (new entry, or overwrite the content of the entry created by the last export). Entries are complete, saved immediately and confirmed by re-reading the book; Replace keeps hand-edited keys, order and position and never creates silently.
- **Suggest title** in the export dialog sends the tracker to the live connection to propose an entry title, only when pressed.
- Built-in **Flat** snapshot transform preset (`[Topic: <title>` + `key: value` lines + `]`), available to every existing Module without changing its selection.

### Changed

- New Modules and the shipped Module templates now select the **Flat** snapshot preset by default; existing Modules keep their current preset.

## [2.15.0] - 2026-10-21

### Changed

- Snapshot transform presets are now one list shared by all Modules; each Module only remembers which preset it selects. Editing a preset applies to every Module that selects it, and the editor shows how many Modules share it. Built-in presets (Default, Minimal, TOON) can be edited but no longer deleted; deleting another preset sends the Modules that selected it back to Default.
- Existing settings upgrade automatically and one-way, with no change to what any Module injects. Identical per-Module copies collapse into one preset; when a Module's edited copy conflicts with another preset under the same key, it is kept under a new key (for example `minimal-2`) and that Module is repointed to it. Older versions cannot read the upgraded settings. Known limit: Minimal's whitespace and code-fence handling is tied to the key `minimal`, so an edited Minimal that gets renamed (for example `minimal-2`) formats with the generic top-level-lines rules instead.
- Module export embeds the selected preset when it is custom or an edited built-in, and import merges it into the shared list (renaming on a clash), so an exported Module formats identically on another install. Shipped Module templates now reference built-in presets by key only.

## [2.14.0] - 2026-10-20

### Changed

- Settings drawer layout: **Add** and **Import** sit in the Modules header, while Up/Down, Clone, Export and a separated, red **Delete** sit under the list. Module rows show their generation position and a hint explains that a Module can only chain in Modules listed above it.
- **Save JSON** / **Save HTML** now sit directly under their textarea (before lint findings), **Generate HTML from schema** sits between the two editors, and **Restore JSON and HTML to default** moved to the bottom as a secondary button.
- The Design brief actions are labeled buttons below the brief, **Generate schema (draft)** and **Generate prompts (applies now)**, with a labeled **Cancel** while running.
- World Info allowlist: the add row reads Search, Select, Add; **Refresh book list** and **Recheck** are grouped as secondary actions; the row remove button is an icon. The grammar **Test** button no longer sits inside the checkbox label.
- Buttons share one look (primary, secondary, danger); icon buttons that name their target (rename/delete preset, remove book, restore default) have accessible names that say which value they act on. The preset selector notes that the preset list is shared by all Modules.

### Removed

- The **Generation Order** drawer, which only repeated the Module list. Reorder with the Up/Down buttons under the Module list.

## [2.13.0] - 2026-10-16

### Added

- The schema lint reports token-wasting nesting as notes: a `maxItems: 1` array, an array of one-field objects, a non-root one-field object, and same-shaped sibling arrays (merge into one array with a `kind` field). Flattening changes the stored data shape, so the template must change with it. Generate schema now tells the model to avoid these and re-asks (up to twice) if a reply still contains a wrapper.

## [2.12.0] - 2026-10-16

### Added

- A **Module State** selector (Off / Manual / Auto) replaces the Module Enabled checkbox, and the Module list shows the same state. Manual Modules generate only on demand but are still injected and chainable.
- The message truck menu always lists the Manual and Auto Modules, even when only one exists, instead of generating immediately.

### Changed

- The separate **Auto Mode Enabled** checkbox is merged into the Module State selector; **Direction** is unchanged. The Generation Order and character-panel hints now say **Off** instead of disabled.

### Fixed

- Saved tracker blocks of an Off Module are labeled with the Module name instead of its internal id.

## [2.11.0] - 2026-10-16

### Added

- Each World Info allowlist book now has an **activation** setting: **Engine rules** (SillyTavern decides which entries activate: keywords, constants, inclusion groups, probability, recursion, budget) or **Always inject all** (every enabled entry, verbatim, as before). New rows default to Engine rules; existing rows migrate to Always inject all, so nothing changes until you opt in.

### Changed

- **Include-all** World Info is now scanned by zTracker as a dry run instead of the prompt builder's real run, and is injected as one system message (wrapped with the active chat-completion preset's World Info format) instead of the preset's before/after slots. Tracker generation no longer starts, advances or clears sticky/cooldown timers and no longer fires SillyTavern's World Info activated event. As a consequence sticky and cooldown are not applied to tracker generations, and depth, Author's Note and outlet positions are not reproduced (their content is joined into the same message).

### Fixed

- World Info inclusion groups, keyword/constant triggering, probability and character filters are now honored for allowlisted books set to **Engine rules**; allowlist mode previously injected every enabled entry and ignored all of them.

## [2.10.0] - 2026-10-13

### Added

- **Design brief** per Module plus two model-backed buttons in the Schema editor. **Generate schema** asks the *global active connection* for a Schema JSON draft (checked by the schema dialect lint and repaired from its findings, at most 2 repair rounds); **Generate prompts** writes a tailored system prompt and base prompt and applies them immediately (saved preset `zTracker-<moduleId>-generated`; your selected global system prompt is left as it was). Both are cancellable, bound to the Module/preset they started on, and announce overwrites inline without a dialog. **Generate HTML** is unchanged. All three buttons have explanatory tooltips.

## [2.9.0] - 2026-10-13

### Added

- World Info allowlist books now have an **activation scope**: inject a book always (default), only when it is attached to the open chat's character card (any member of a group chat) or bound to the chat, only when it is globally selected, or either. Settings show a per-row warning when a scope is not satisfied by the open chat (checked when the section is viewed, when rows change, and via **Recheck**).

### Changed

- **BREAKING (narrow):** the book-less "Allowed entry IDs (UIDs)" list is gone. Entry UIDs are now set per allowlisted book, and existing UID-only entries are dropped on upgrade. Existing allowlisted books migrate to "always", so their behavior is unchanged. Old Module exports still import.

## [2.8.0] - 2026-10-01

### Added

- **Start Reply With** is now applied to tracker requests as a reply prefill (after the reply cue on Text Completion, as a last assistant message on Chat Completion).
- Reasoning blocks (per the effective reasoning template) are stripped from tracker replies before parsing in every Prompt Engineering mode; a reply cut off inside an unclosed reasoning block fails with a clear error.
- Diagnostics now shows the effective preset, instruct/context, Start Reply With, reasoning template, whether settings came from the profile or live values, and which fields fell back.
- Settings: the Schema editor now checks the Schema JSON draft against the JSON Schema subset zTracker actually honors, and lists errors, warnings, and notes naming the affected field and how to fix it (e.g. `$ref`/`$defs` that never reach the model, validation keywords like `minLength` that are not enforced, arrays of objects with no item identity, missing field descriptions).
- Diagnostics now lists these schema findings for every Module and schema preset, including imported or migrated ones.

### Changed

- **BREAKING (Modules on a saved connection profile only):** a saved profile is now the single source of the preset, instruct template, instruct mode on/off, context template, custom stop strings, Start Reply With and reasoning template used for that Module's tracker requests, instead of the live SillyTavern templates. A field the profile does not record falls back to the live value for that field only. To keep the old behavior, switch the Module's Connection Source to the live connection.
- **System Prompt Source -> From connection profile presets** now selects only the profile's saved system prompt. It no longer affects the instruct, context or sampler preset.
- **BREAKING (Modules on the live connection):** tracker requests now also follow SillyTavern's live **Start Reply With** (sent as a reply prefill, which breaks XML/TOON modes if set to something like `{`), strip reasoning from the reply, and, on Text Completion, send the live sampler preset and honor the live instruct on/off switch and custom stop strings. If a live Start Reply With does not suit tracker generation, pin the Module to a saved profile that records an empty one.
- A saved profile's stop strings, instruct template and its user-alignment message are now always used as recorded; the live stop strings no longer leak into the request through the sampler preset.
- Settings: Schema JSON and Schema HTML are now saved independently. Saving Schema JSON is blocked while it has an error-level finding (an array with no `items`, or an object with no `properties`); saving Schema HTML is never blocked by a JSON problem. When both are edited and work together (e.g. a field rename), either Save button saves both.

### Fixed

- XML and TOON tracker generation no longer fails on every attempt with "Model response is not valid XML/TOON." when the schema declares an array without `items`.

## [2.7.0] - 2026-09-14

### Added

- Settings: a "Generate HTML from schema" button next to the Schema editor's Restore Default button mechanically derives a Handlebars HTML template from the current Schema JSON draft, so authors no longer have to hand-write the companion template from scratch.

## [2.6.0] - 2026-09-14

### Added

- Settings: a new per-Module, JSON-mode-only "Enforce schema via grammar sampling" checkbox adds the Module's JSON Schema as an additional structured-output constraint on generation requests, for backends that support it (llama.cpp, TabbyAPI, Chat Completion). A "Test" button next to it fires one throwaway request against the Module's current connection and reports whether that connection actually honors the constraint.

## [2.5.1] - 2026-09-14

### Fixed

- A Module's **Embed zTracker snapshots as** role of "system" is now honored on Text Completion connections instead of being silently treated as "user" and bundled into the tracked message's own text. It now always appears as its own standalone system-role message, matching the configured setting on both Chat Completion and Text Completion.

## [2.5.0] - 2026-09-11

### Changed

- **BREAKING (installation-wide default only)**: zTracker no longer installs a shared `zTracker-<version>` system-prompt preset on startup. Every shipped starter Module already carries and auto-installs its own tailored system prompt; existing installs keep whatever `zTracker-1.3.x` preset already exists in SillyTavern's storage, and any Module still referencing it by name keeps working unchanged.
- Settings: the **Prompt** field (and its restore-to-default button) is now disabled whenever the selected Module's Prompt Engineering mode is JSON, XML, or TOON, with a note explaining that those modes use the matching **Prompt (JSON/XML/TOON)** template instead. It was previously always editable even though it was silently ignored outside Native mode.
- Settings: switching a Module's System Prompt Source to "From specific saved system prompt" with nothing chosen no longer pre-fills a shared preset name; the selection stays empty until you pick one.
- The three shipped Module templates (Scene Tracker, Plot Log, Plot Steer) have rewritten, model-neutral system prompts.

### Fixed

- A newly added Module (via "Add Module") or a freshly imported/seeded shipped template no longer fails its first tracker generation with "Please select a connection profile..."; it now defaults to using SillyTavern's active connection.

## [2.4.0] - 2026-09-10

### Added

- Fresh installs now automatically seed all three starter Modules on first load: **Scene Tracker** (enabled) plus **Plot Log** and **Plot Steer** (disabled, opt-in). Each ships with its own tailored system prompt, installed as a versioned SillyTavern system-prompt preset the moment the Module is created (fresh install or manual Import). If a Module's shipped preset is later deleted from SillyTavern, a "Recreate from shipped prompt" action next to the existing missing-preset warning restores it with one click.

### Changed

- **BREAKING (fresh installs only)**: the built-in Scene Tracker Module's id is now `scene-tracker` instead of the legacy `default` id. Existing installations that already migrated from the legacy single-tracker format are unaffected and keep their current Module id and data.

### Fixed

- Settings: editing a Module field no longer silently does nothing in the rare case where every starter template failed to seed (e.g. a broken install); the missing Module is now recreated automatically so edits persist.
- A warning is now shown if zTracker can't automatically set up its starter trackers on a fresh install (partially or fully), instead of only logging to the browser console.

## [2.3.2] - 2026-09-09

### Changed

- New installs now name the built-in default Module "Scene Tracker" instead of "Default". Existing installations keep their current Module name.

## [2.3.1] - 2026-09-09

### Fixed

- Settings: switching the selected Module now refreshes the Schema JSON/HTML editor even when both Modules use the same schema preset key.

## [2.3.0] - 2026-09-08

### Added

- Two pre-made, importable Module templates under `templates/modules/`: **Plot Log** (tracks story arc, open threads, recent events, and stakes) and **Plot Steer** (reads Plot Log's history and injects a single suggested next beat, with a pacing hint, into the next generation). Import them the same way as any exported Module.

## [2.2.0] - 2026-09-08

### Added

- Each Module's Auto Mode now has an independent enabled flag and trigger direction (`Process inputs`/`Process responses`/`Process both`), so its configured direction is remembered even while Auto Mode is off for that Module.
- The character-panel Auto Mode control now supports a per-character, per-Module override with three states: **Default** (use that Module's own Auto Mode setting), **Off** (never auto-generate for this character on that Module), and **On** (always auto-generate for this character on that Module, using its configured direction, even while Auto Mode is off for everyone else). With multiple Modules configured, the control opens a small menu to set each Module's override independently.

### Changed

- Stored settings and character-card data are upgraded once more: each Module's Auto Mode splits into its enabled flag and direction, and existing per-character Auto Mode exclusions migrate into the new per-Module override.

## [2.1.1] - 2026-08-10

### Fixed

- The character-panel auto-mode exclusion toggle now excludes/includes a character across every configured tracker Module instead of only the default Module, fixing auto-generation continuing for non-default Modules after "deactivating" a character.

## [2.1.0] - 2026-08-10

### Added

- Each Module now has a generation "Include Module History" list that pulls other Modules' past tracker snapshots into its own generation context, independent of the raw chat message window and of downstream tracker-snapshot injection into normal generations. Every Module always has a "self" entry for its own history; chained entries can only reference a Module that generates earlier, and reuse that Module's own snapshot formatting.
- A new "Generation Order" view in settings lists all Modules in the order they generate, since a Module can only chain in another Module's history if that Module is listed earlier.

### Changed

- Stored settings are upgraded once more so each Module's self-history count is copied from its existing snapshot-injection count. After the upgrade, self-history and tracker-snapshot injection are configured independently.

## [2.0.0] - 2026-08-07

### Added

- zTracker now supports multiple Modules, so one chat can keep separate trackers with their own schema, prompts, connection, generation, injection, and auto-generation settings.
- Module settings can be added, cloned, reordered, deleted, exported, and imported from the zTracker settings panel. Export downloads a `.json` file containing the full Module (schema presets, prompts, system prompt, connection, generation, and injection settings), and Import reads that file back through a file picker.

### Changed

- **Breaking:** Stored settings are upgraded to the new Module format the first time this version runs. The upgrade preserves the previous tracker as the default Module, but it is a one-way format change and downgrading to an older zTracker version afterward is not supported.
- The message truck button now opens a Module chooser when multiple Modules are enabled, so manual generation can target any Module before it has an existing tracker block.

### Fixed

- Outgoing auto mode no longer aborts the first host reply on early messages: when `Skip First X Messages` would skip tracker generation, zTracker now lets the reply run normally instead of stopping and failing to resume it.
- Generating a non-default Module now uses that Module's own prior tracker context instead of injecting Default Module snapshots, preventing mismatched tracker output from being discarded.
- Tracker injection no longer promotes generic `user`, `assistant`, or `system` role labels into speaker names, preventing duplicated prompt text such as `user: User:` inside an existing user turn.
- Regenerating one Module now spins that Module's regenerate button instead of the first tracker block on the message.

## [1.12.1] - 2026-05-21

### Fixed

- Wrapped text-completion tracker regeneration now preserves speaker names after `Conversation role handling` relabels dialogue turns, so prompts keep `<Character>:`/character attribution instead of collapsing named turns into unlabeled model blocks.

## [1.12.0] - 2026-05-20

### Changed

- zTracker settings now separate the default schema preset for new chats from the current chat schema preset used for full tracker generation, with clearer preset switching and editing controls.

### Fixed

- Schema preset edits now save and validate the JSON schema and HTML template together, reducing mismatches when you switch presets.
- Current chat schema preset changes now persist more reliably and recover faster when a previously selected preset is removed.
- TOON prompt-engineering tracker generation now uses a leaner prompt, reducing prompt bloat while preserving the same structured-output behavior.

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
