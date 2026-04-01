# SillyTavern extension impact notes (2025-2026 releases)

Maintenance note: Update this document whenever a new upstream SillyTavern version is released.

This document translates recent upstream SillyTavern releases into practical guidance for extension maintainers, especially browser-side UI extensions such as zTracker.

## Current upstream target

- Latest checked release: `1.17.0`
- Recommended baseline for active extension development: test against `1.17.0`
- Runtime floor in upstream docs and release notes: Node.js 20+

## High-impact changes by topic

### 1. Manifest and lifecycle

Relevant releases:

- `1.13.1`: manifests can require the presence of other extensions.
- `1.13.3`: manifests can declare a minimal supported SillyTavern client version.
- `1.17.0`: manifests can declare extension lifecycle hooks.

What this means:

- Extensions no longer need to rely only on README text for compatibility.
- Dependency checks and minimum-client guards should move into `manifest.json` when possible.
- Lifecycle-driven startup and cleanup is now the preferred path on modern SillyTavern versions.

Suggested maintainer action:

- Use `minimum_client_version` for features that require `1.13.3+` APIs.
- If a feature depends on `1.17.0` lifecycle hooks, gate it explicitly instead of trying to silently degrade.

### 2. Generation APIs and structured outputs

Relevant releases:

- `1.13.2`: extensions can use structured generation with a JSON schema.
- `1.13.2`: `generateRaw()` gained `prefill`, and community updates expanded it to multiple messages and roles.
- `1.17.0`: `generateRawData` was exported.
- `1.17.0`: extensions can process streamed text during tool-call chains.

What this means:

- The extension platform increasingly supports first-class structured generation instead of prompt-only workarounds.
- Extensions with custom parsing pipelines can progressively replace brittle prompt hacks with JSON-schema-backed requests where the backend supports them.
- Stream-aware integrations are now more practical if an extension reacts to in-flight tool-call output.

Suggested maintainer action:

- Prefer schema-based generation where available, but keep parser repair fallbacks for weak or non-compliant models.
- If you need full raw request composition, review whether `generateRawData` can replace custom duplication.

### 3. Settings and preset storage

Relevant releases:

- `1.13.2`: extensions can save and load data from API setting presets.
- `1.13.2`: Preset Manager gained methods for custom read and write operations.
- `1.13.1`: Connection Profiles gained Prompt Post-Processing and Secret ID.

What this means:

- Extension state can now live closer to the user’s model and preset workflow instead of only global extension settings.
- Extensions that depend on backend-specific prompt or schema behavior can store that alongside the active profile or preset.

Suggested maintainer action:

- Prefer preset-backed extension data for model-specific settings that should export and import with presets.
- Keep secrets out of extension settings even though surrounding profile systems became richer.

### 4. Events and app lifecycle timing

Relevant releases:

- `1.15.0`: `WORLDINFO_SCAN_DONE` added with mutable state for extensions.
- `1.16.0`: community updates added `APP_INIT` before `APP_READY`.
- `1.17.0`: added `PERSONA_CHANGED`, `TTS_JOB_STARTED`, `TTS_AUDIO_READY`, and `TTS_JOB_COMPLETE`.

What this means:

- Extensions can hook earlier in initialization and respond to more focused domain events.
- World Info integrations can now participate more directly in scan results instead of reacting only after the fact.

Suggested maintainer action:

- If your extension mutates chat-related context, re-check whether `APP_INIT` or lifecycle hooks are a better fit than waiting for `APP_READY`.
- Prefer explicit events like `PERSONA_CHANGED` over polling persona state.

### 5. Message shape and attachment compatibility

Relevant releases:

- `1.14.0`: attached media handling changed and upstream warned third-party extensions may need updates.
- `1.14.0`: messages can contain multiple files and images, plus audio attachments.
- `1.13.1`: video attachments arrived for supported backends.

What this means:

- Extensions that inspect or mutate message objects must no longer assume a single attachment or old media shape.
- Chat history compatibility across old and new versions is weaker around media-heavy chats.

Suggested maintainer action:

- Audit all attachment assumptions.
- Avoid hard-coding one-file or image-only logic.
- Treat `1.14.0` as the minimum safe target if your extension touches message media at all.

### 6. Macro engine migration

Relevant releases:

- `1.15.0`: Macros 2.0 preview.
- `1.16.0`: Experimental Macro Engine gained scoped macros, `if`, variables, operators, and `{{hasExtension}}`.
- `1.17.0`: new installs enable the new macro engine by default.

What this means:

- The macro environment is no longer stable if your extension assumes legacy substitution behavior.
- Extensions that emit or parse macro-heavy text need testing against both legacy and new engines unless they explicitly target newer ST only.

Suggested maintainer action:

- Avoid relying on undocumented ordering behavior.
- Test slash-command and prompt-related features under the new macro engine.
- Document any incompatibility with legacy macro behavior.

### 7. Popup and UI integration changes

Relevant releases:

- `1.14.0`: multiline popup inputs now insert newlines instead of submitting.
- `1.17.0`: popup system added textarea support, placeholders, tooltips, and icons.
- `1.17.0`: Action Loader introduced a reusable loading overlay system.

What this means:

- Extensions using upstream popup helpers can rely on richer built-in affordances.
- Popup keyboard behavior changed, so custom submit assumptions should be re-tested.

Suggested maintainer action:

- Prefer upstream popup APIs over custom modal plumbing when practical.
- If you show long-running operations, consider switching from ad hoc spinners to the Action Loader model on newer clients.

### 8. Security and operational changes around extensions

Relevant releases:

- `1.14.0`: git operations for extensions now timeout after five minutes of inactivity.
- `1.16.0`: security fixes for path traversal, SSRF, and CORS forwarding.
- `1.17.0`: extension installs can use `isomorphic-git` as an alternative backend.

What this means:

- Extension installation and update behavior is evolving on the server side.
- Anything that shells out to or depends on git behavior may behave differently across hosts.

Suggested maintainer action:

- Avoid depending on installer implementation details.
- Document installation fallback paths if your users often install from constrained environments.

## zTracker-specific reading of the upstream changes

For this repository, the most relevant upstream changes are:

- `1.13.2`: preset-backed extension data and structured generation are directly relevant to zTracker’s connection-profile and schema-based generation behavior.
- `1.13.3`: `minimum_client_version` is useful if zTracker adopts APIs unavailable on older clients.
- `1.14.0`: media/message-shape changes matter if tracker rendering or generation logic ever reads message attachments.
- `1.15.0`: `WORLDINFO_SCAN_DONE` is relevant if tracker generation ever participates in lorebook filtering or injection.
- `1.16.0`: `APP_INIT` and character update APIs may matter for cleaner bootstrapping and character-bound tracker metadata.
- `1.17.0`: lifecycle hooks and `generateRawData` are the strongest candidates for future simplification of zTracker startup and request assembly.

## Recommended upgrade checkpoints for zTracker

### Minimum checks after any SillyTavern upgrade

- Confirm `manifest.json` fields still match current upstream expectations.
- Confirm `SillyTavern.getContext()` APIs used by zTracker still exist and keep the same semantics.
- Re-test tracker generation for Text Completion and Chat Completion profiles.
- Re-test message rendering and message-extra persistence.
- Re-test any prompt interception behavior after macro, prompt-manager, or generation API changes.

### Additional checks specifically for 1.14+

- Verify attachment-bearing messages do not break tracker generation or rendering.
- Verify multi-attachment messages do not confuse any message traversal logic.

### Additional checks specifically for 1.15+

- Verify prompt assembly remains correct with both legacy and new macro engines.
- Re-test any World Info filtering or mutation path.

### Additional checks specifically for 1.17+

- Evaluate whether lifecycle hooks can replace some startup event wiring.
- Evaluate whether `generateRawData` can replace any local request-shape duplication.
- Re-check UI popups for keyboard behavior and richer field support.

## Source release pages checked

- https://github.com/SillyTavern/SillyTavern/releases/tag/1.17.0
- https://github.com/SillyTavern/SillyTavern/releases/tag/1.16.0
- https://github.com/SillyTavern/SillyTavern/releases/tag/1.15.0
- https://github.com/SillyTavern/SillyTavern/releases/tag/1.14.0
- https://github.com/SillyTavern/SillyTavern/releases/tag/1.13.3
- https://github.com/SillyTavern/SillyTavern/releases/tag/1.13.2
- https://github.com/SillyTavern/SillyTavern/releases/tag/1.13.1