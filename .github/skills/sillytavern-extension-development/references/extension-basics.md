# SillyTavern extension basics

Maintenance: Last reviewed 2026-04-02. Update when SillyTavern changes manifest fields, host APIs, extension storage options, or frontend-extension guidance.

Use this reference when a task touches the host integration surface of a SillyTavern UI extension.

Primary upstream references:
- Read the upstream repository for reference: `https://github.com/SillyTavern/SillyTavern`.
- Read the contributor extension docs for reference: `https://docs.sillytavern.app/for-contributors/writing-extensions/`.
- Treat the upstream repository as the source of truth when documentation and code disagree or when the docs appear outdated.

Core model:
- A SillyTavern UI extension runs in the browser context.
- It has broad DOM and JavaScript access, but it is still a frontend extension.
- Server-side or secret-handling work belongs in a Server Plugin, not a UI extension.
- Extensions intended for the official content ecosystem should stay open source, compatible with the latest SillyTavern release, documented, and independent of server plugins.

Manifest fields that matter most:
- `display_name`: name shown in Manage Extensions.
- `js`: entry script path.
- `css`: optional stylesheet path.
- `author`, `version`, `homePage`: expected metadata.
- `loading_order`: lower numbers load earlier; interceptors run in this order.
- `dependencies`: required extension folder names.
- `generate_interceptor`: global function name invoked during prompt generation.
- `minimum_client_version`: explicit compatibility gate for newer host APIs.
- `i18n`: optional locale map.

Manifest guidance:
- Avoid building new features around deprecated Extras-oriented fields.
- Use relative imports that still work when the extension is mounted under `/scripts/extensions/third-party/...`.
- Prefer manifest version gates over README-only compatibility notes.

Stable integration surface:
- Prefer `SillyTavern.getContext()` over importing SillyTavern internals.
- Treat the returned context as live mutable runtime state.
- Re-read context-backed objects when chat/session state can change under you.

Shared libraries:
- Prefer `SillyTavern.libs` when it already exposes the dependency you need.
- Common examples include lodash, localforage, DOMPurify, Handlebars, and moment.
- Reusing host-provided libraries reduces bundle size and dependency conflicts.

State storage choices:
- Persistent extension settings: `getContext().extensionSettings[MODULE_NAME]` plus `saveSettingsDebounced()`.
- Per-chat metadata: `getContext().chatMetadata` plus `saveMetadata()`.
- Character card extension data: `writeExtensionField(characterId, key, value)`.
- Preset-backed extension data: `getContext().getPresetManager()` custom read and write helpers.

State rules:
- Initialize defaults and backfill missing keys on upgrade.
- Do not keep long-lived references to `chatMetadata`; it changes when the user switches chats.
- Character IDs are array indices and may be undefined in group chats.
- Keep secrets out of extension settings.

Events and lifecycle:
- Subscribe through `getContext().eventSource.on(eventType, handler)`.
- Common events include `APP_READY`, `MESSAGE_SENT`, `MESSAGE_RECEIVED`, `USER_MESSAGE_RENDERED`, `CHARACTER_MESSAGE_RENDERED`, `CHAT_CHANGED`, and generation lifecycle events.
- Use the most specific event available instead of polling.

Prompt interception:
- Declare `generate_interceptor` in `manifest.json` and define the named function in global scope.
- The interceptor receives the chat array used for prompt building.
- If mutations should be temporary, clone first with `structuredClone`.
- Interceptors execute sequentially according to `loading_order`.

Generation and structured outputs:
- `generateQuietPrompt(...)` is the host helper for background generation with chat context.
- `generateRaw(...)` is the host helper for context-free generation.
- Structured outputs are backend-dependent and not guaranteed to validate.
- Keep parser and repair fallbacks even when using JSON schema.

TypeScript and testability:
- Keep SillyTavern globals typed through the repo-level global type declarations.
- Keep new logic import-safe so Jest can test it without booting the full extension entrypoint.
- Avoid importing the side-effect-heavy entry module in tests.

Security and performance rules:
- Never store API keys or tokens in extension settings.
- Sanitize user-provided content before inserting it into the DOM or commands.
- Avoid `eval()` and `Function()`.
- Keep large blobs out of extension settings; use localforage or similarly appropriate storage instead.
- Clean up event listeners for any UI that is created and destroyed repeatedly.

Compatibility rules:
- Prefer `getContext()` APIs over direct internal imports.
- Use a unique extension key to avoid collisions.
- Treat host-owned behavior as host-owned. Do not add extension-local policy when the runtime already decides the outcome.