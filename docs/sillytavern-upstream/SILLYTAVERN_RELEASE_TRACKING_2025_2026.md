# SillyTavern release tracking (checked 2026-04-01)

Maintenance note: Update this document whenever a new upstream SillyTavern version is released.

This document summarizes recent upstream SillyTavern releases with emphasis on changes that matter for extension maintainers.

## Latest upstream release

- Latest release checked: `1.17.0`
- Release URL: https://github.com/SillyTavern/SillyTavern/releases/tag/1.17.0
- Current upstream runtime note: SillyTavern now requires Node.js 20 or higher.

## Why these versions matter

The biggest extension-facing changes in the recent release line started in `1.13.1` and continue through `1.17.0`:

- `1.13.1`: extension dependencies, extension load failure reporting, prompt-processing integration points.
- `1.13.2`: preset storage for extensions, structured generation with JSON schema, `generateRaw()` expansion.
- `1.13.3`: `minimum_client_version` in extension manifests.
- `1.14.0`: attached media model changed and may break extensions that touch message media.
- `1.15.0`: macro-engine transition and new mutable `WORLDINFO_SCAN_DONE` event.
- `1.16.0`: `APP_INIT`, character update APIs for extensions, macro engine expansion.
- `1.17.0`: lifecycle hooks via manifest declarations, new exported APIs, and new extension-relevant events.

## Release-by-release summary

### 1.17.0

Release: https://github.com/SillyTavern/SillyTavern/releases/tag/1.17.0

Extension-relevant changes:

- Added extension lifecycle hooks via manifest declarations.
- Exported `SlashCommandEnumValue` and `generateRawData`.
- Extensions can now process streamed text during tool-call chains.
- Popup system gained textarea support plus placeholders, tooltips, and icons.
- Added reusable Action Loader support with stacking, toasts, and STscript integration.
- Added new events: `PERSONA_CHANGED`, `TTS_JOB_STARTED`, `TTS_AUDIO_READY`, `TTS_JOB_COMPLETE`.
- Server added `isomorphic-git` as an alternative backend for extension installs.
- Build note: upstream improved webpack cache handling to reduce stale-cache problems.

Operational notes:

- Macro engine is now enabled by default for new installs.
- SillyTavern requires Node.js 20 or higher.
- Token estimation now uses byte length instead of string length semantics extension authors may have assumed.

### 1.16.0

Release: https://github.com/SillyTavern/SillyTavern/releases/tag/1.16.0

Extension-relevant changes:

- Extensions Manager can now bulk-toggle all third-party extensions.
- Macro system continued to expand behind the Experimental Macro Engine.
- Added `{{hasExtension}}`, which can help macro-based workflows detect installed extensions.
- Community updates included `APP_INIT`, fired before `APP_READY` during initialization.
- Community updates exposed character update APIs for extensions.
- Core frontend continued replacing `$.ajax` with `fetch`, which matters if an extension mirrors upstream request patterns.

Operational notes:

- Several server-side security fixes landed, especially around path traversal, SSRF, and CORS forwarding.
- If an extension depends on the new macro engine behavior, it should not assume legacy macro evaluation.

### 1.15.0

Release: https://github.com/SillyTavern/SillyTavern/releases/tag/1.15.0

Extension-relevant changes:

- Introduced the first preview of Macros 2.0.
- Group chat metadata format was unified with regular chats.
- Added new `WORLDINFO_SCAN_DONE` event with mutable state for extensions.
- Community updates mention `ConnectionManagerRequestService` improvements for extension use.
- Text Completion added a toggle for empty JSON schemas.
- Prompt manager became more injectable in community updates.

Breaking or migration notes:

- `{{pick}}` results are not compatible between the legacy macro engine and Macros 2.0.
- Group chat metadata is migrated automatically and is not backward compatible with older versions.

Operational notes:

- This release is the point where extension authors should begin testing against both legacy and new macro-engine behavior.

### 1.14.0

Release: https://github.com/SillyTavern/SillyTavern/releases/tag/1.14.0

Extension-relevant changes:

- Attached media handling changed.
- Messages can now contain multiple files and images, plus audio attachments.
- Prompt audio inlining support was added for Gemini and OpenRouter.
- Added per-chat overrides for example messages and system prompts.
- Popups changed so multiline input inserts a newline instead of submitting.
- Added `deleteMessage` in community updates.

Breaking or migration notes:

- Upstream explicitly warned that third-party extensions reading or writing media on chat messages may require updates.
- Chat files containing attached media are not backward compatible with versions prior to `1.14.0`.

Operational notes:

- If an extension stores or inspects attachment data on messages, this is a high-priority compatibility checkpoint.

### 1.13.3

Release: https://github.com/SillyTavern/SillyTavern/releases/tag/1.13.3

Extension-relevant changes:

- Extension manifests can now specify a minimum SillyTavern client version.
- Community updates added `saveMetadataDebounced` to context.
- Chat formatting changed around Story String wrapping and at-depth placement.
- Regex gained named capture groups in replacement text.

Operational notes:

- This is the first clear upstream version where extension authors can gate compatibility using manifest metadata instead of only documenting it.
- Any extension relying on older formatting assumptions should re-check prompt assembly after this release.

### 1.13.2

Release: https://github.com/SillyTavern/SillyTavern/releases/tag/1.13.2

Extension-relevant changes:

- Extensions can save and load data from API setting presets.
- Extensions can use structured generation with a JSON schema.
- `generateRaw()` gained a `prefill` parameter.
- Community updates expanded `generateRaw()` to accept multiple messages and roles.
- Preset Manager gained methods for reading and writing custom data.
- Extensions can add or exclude World Info entries during scanning.
- Added character tags as data attributes on rendered chat messages.

Operational notes:

- This is a major extension-platform release for extensions that store configuration in presets or use structured generation.
- If an extension mutates World Info behavior, the new WI hooks are especially relevant.

### 1.13.1

Release: https://github.com/SillyTavern/SillyTavern/releases/tag/1.13.1

Extension-relevant changes:

- Extension manifests can require the presence of other extensions.
- Extension load failures are surfaced in Manage Extensions.
- Connection Profiles gained Prompt Post-Processing and Secret ID support.
- Community updates added an extension hook for Stable Diffusion prompt processing.
- Added video attachments to messages for supported backends.

Operational notes:

- This is the start of a more explicit extension dependency model.
- Upstream also warned that Node.js 18 had reached end of life.

## Recommended compatibility baseline for extension authors

- If you depend on manifest version gates, require at least `1.13.3`.
- If you depend on preset-backed extension data or JSON-schema structured generation, require at least `1.13.2`.
- If you read or write message attachments, treat `1.14.0` as a compatibility boundary.
- If you rely on mutable World Info scan behavior, require at least `1.15.0`.
- If you need manifest lifecycle hooks or `generateRawData`, require at least `1.17.0`.

## Source release pages checked

- https://github.com/SillyTavern/SillyTavern/releases/tag/1.17.0
- https://github.com/SillyTavern/SillyTavern/releases/tag/1.16.0
- https://github.com/SillyTavern/SillyTavern/releases/tag/1.15.0
- https://github.com/SillyTavern/SillyTavern/releases/tag/1.14.0
- https://github.com/SillyTavern/SillyTavern/releases/tag/1.13.3
- https://github.com/SillyTavern/SillyTavern/releases/tag/1.13.2
- https://github.com/SillyTavern/SillyTavern/releases/tag/1.13.1