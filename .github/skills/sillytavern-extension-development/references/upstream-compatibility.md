# SillyTavern upstream compatibility

Maintenance: Last reviewed 2026-04-02. Update when a new SillyTavern release changes extension manifests, lifecycle hooks, events, prompt assembly, message structure, or runtime requirements.

Use this reference when a task depends on upstream SillyTavern behavior or compatibility boundaries.

Current baseline:
- Latest upstream release checked: `1.17.0`.
- Recommended active development baseline for browser-side extensions: test against `1.17.0`.
- Upstream runtime floor: Node.js 20 or higher.

High-impact version boundaries:
- `1.13.1`: extension dependencies in manifests, extension load failure reporting, prompt-processing integration points, connection-profile prompt post-processing, and secret ID support.
- `1.13.2`: preset-backed extension data, structured generation with JSON schema, `generateRaw()` expansion, preset manager custom fields, and World Info extension hooks.
- `1.13.3`: `minimum_client_version` support in manifests.
- `1.14.0`: attachment and message-media shape changed; this is the compatibility boundary for extensions that inspect or mutate message media.
- `1.15.0`: macro-engine transition began and mutable `WORLDINFO_SCAN_DONE` was added.
- `1.16.0`: `APP_INIT`, character-update APIs for extensions, broader macro-engine expansion, and continued upstream migration away from `$.ajax`.
- `1.17.0`: manifest lifecycle hooks, exported `generateRawData`, streamed tool-call text processing, richer popup helpers, Action Loader support, and new extension-relevant events.

Topic-focused guidance:

Manifest and lifecycle:
- If a feature requires newer client behavior, gate it with `minimum_client_version` instead of relying on docs alone.
- Lifecycle-driven startup and cleanup is the preferred direction on modern SillyTavern versions.

Generation APIs and structured outputs:
- Prefer schema-backed generation when the selected backend supports it.
- Keep parser repair paths for weak or non-compliant models.
- Review whether `generateRawData` can replace duplicated local request-shape logic when working against `1.17.0+`.

Settings and preset storage:
- Prefer preset-backed extension data for backend- or model-specific settings that should travel with presets.
- Do not store secrets in extension settings even though the surrounding profile system became richer.

Events and app timing:
- Re-check whether `APP_INIT` or manifest lifecycle hooks are a better fit than waiting for `APP_READY`.
- Prefer focused events like `PERSONA_CHANGED` over polling when available.

Message shape and attachments:
- Do not assume a single attachment or image-only media model.
- Re-test any traversal or rendering logic that reads message media on `1.14.0+`.

Macro engine:
- New installs now default to the new macro engine.
- Avoid relying on undocumented macro ordering.
- Re-test prompt assembly and slash-command behavior when macro-related upstream changes land.

Popup and UI helpers:
- Multiline popup submission behavior changed in `1.14.0`.
- `1.17.0` added textarea support, placeholders, tooltips, icons, and Action Loader.
- Prefer upstream popup helpers when practical instead of custom modal plumbing.

Operational and security changes:
- Do not depend on extension installer implementation details.
- Server-side git, security, and request-handling changes can affect installation/update workflows without changing browser APIs directly.

Extension-upgrade checkpoints:
- Re-test the extension's main user flow after upstream upgrades.
- Re-test any persisted extension data path after manifest, generation, or message-shape changes.
- Re-test prompt interception after macro, prompt-manager, or generation API changes.
- If the extension reads message attachments directly, treat `1.14.0` as a required verification boundary.
- Evaluate lifecycle hooks and `generateRawData` first when simplifying startup or request assembly on `1.17.0+`.

Compatibility thresholds to remember:
- Require at least `1.13.2` for preset-backed extension data or JSON-schema structured generation.
- Require at least `1.13.3` for manifest version gating.
- Treat `1.14.0` as the minimum safe target for message-attachment work.
- Require at least `1.15.0` for mutable World Info scan behavior.
- Require at least `1.17.0` for lifecycle hooks or `generateRawData`.

Upgrade review checklist:
- Confirm `manifest.json` still matches upstream expectations.
- Confirm every used `SillyTavern.getContext()` API still exists and keeps the same semantics.
- Re-test the extension's main generation or rendering flow, prompt interception, and persistence.
- Re-test popup behavior and keyboard handling when upstream popup helpers change.
- Review whether new upstream APIs let the repo delete local compatibility code.