# SillyTavern development notes (extension-focused)

This document is a quick “things to remember” cheat sheet for developing **SillyTavern UI extensions** (this repo is one).

Sources:
- SillyTavern repo: https://github.com/SillyTavern/SillyTavern
- Contributor docs: https://docs.sillytavern.app/for-contributors/
- Writing extensions: https://docs.sillytavern.app/for-contributors/writing-extensions/

## What a UI extension is
- Runs in the **browser context** (frontend), with broad access to the DOM and JS APIs.
- For server-side functionality / secret handling, use **Server Plugins** instead of a UI extension.
- Extensions meant for the official content repository should be open source, compatible with latest SillyTavern release, documented, and not require server plugins.

## `manifest.json` essentials
- Required/important fields:
  - `display_name`: what users see in Manage Extensions.
  - `js`: entry point script path.
  - `css`: optional stylesheet path.
  - `author`, `version`, `homePage`: strongly expected metadata.
  - `loading_order`: determines load order (lower loads earlier). Interceptors run in this order.
  - `dependencies`: other extensions required (by folder name in `public/extensions`).
  - `generate_interceptor`: name of a **global** function called on generation requests.
  - `minimum_client_version`: optional guard for incompatible SillyTavern versions.
  - `i18n`: optional locale → json file mapping.
- Notes:
  - `requires` / `optional` (Extras modules) are considered deprecated in the docs; avoid building new functionality around Extras.
  - Downloaded extensions are mounted under `/scripts/extensions/third-party/...`; prefer **relative imports** based on that.
  - For easier local development, it’s common to place the repo under the server’s `.../scripts/extensions/third-party` ("Install for all users"-style).

## The stable API: `SillyTavern.getContext()`
- Use `SillyTavern.getContext()` as your primary integration surface (chat state, helpers, event bus).
- Avoid importing internal SillyTavern modules directly unless you accept it may break across updates.
- The context contains mutable live state, and a lot of common utilities.

## Shared libraries
- SillyTavern exposes common libs on `SillyTavern.libs` (e.g., lodash, localforage, DOMPurify, Handlebars, moment, etc.).
- Prefer these when you can, to reduce bundling and dependency conflicts.

## State management options

### Persistent extension settings (global)
- Use `getContext().extensionSettings[YOUR_KEY]` for JSON-serializable settings.
- Persist with `getContext().saveSettingsDebounced()`.
- Always initialize defaults and merge missing keys on upgrade.

### Chat metadata (per-chat)
- Store per-chat state in `getContext().chatMetadata` and persist via `saveMetadata()`.
- Important: **do not keep a long-lived reference** to `chatMetadata`; it changes when switching chats.
  - Always read it via `SillyTavern.getContext().chatMetadata` when needed.

### Character cards (shareable)
- SillyTavern supports Character Card V2; extension data can be stored on the card.
- Use `getContext().writeExtensionField(characterId, key, value)`.
- Caveat: `characterId` is an index into an array (not a stable ID) and can be `undefined` in group chats.

### Preset extension fields
- Some API preset types allow storing arbitrary extension data inside preset JSON (export/import safe).
- Access via `getContext().getPresetManager()` and its read/write helpers.

## Events
- Use `getContext().eventSource.on(eventType, handler)`.
- Handy events to remember:
  - `APP_READY`
  - `MESSAGE_SENT` / `MESSAGE_RECEIVED` (recorded, not rendered)
  - `USER_MESSAGE_RENDERED` / `CHARACTER_MESSAGE_RENDERED`
  - `CHAT_CHANGED`
  - generation lifecycle events like `GENERATION_ENDED`, etc.
- Event payloads vary; check where the event is emitted if you’re unsure.

## Prompt interceptors (`generate_interceptor`)
- Declare `generate_interceptor` in `manifest.json` and define that function in global scope.
- The interceptor receives a chat array for prompt building. It can mutate it.
  - If you want ephemeral changes, use `structuredClone` first.
- Interceptors execute sequentially across extensions; order follows `loading_order`.

## Generating text and structured outputs
- SillyTavern provides generation helpers on the context:
  - `generateQuietPrompt(...)`: background generation using chat context.
  - `generateRaw(...)`: generation without chat context.
- Structured outputs:
  - Only supported by some APIs/models (docs call out Chat Completion support).
  - Even when supported, results are not guaranteed to validate; you must parse/validate.
  - If a model can’t do it, you may get failures or an empty JSON object.

## TypeScript notes
- For good autocomplete and typing of the global `SillyTavern` object, add a root `global.d.ts` that imports SillyTavern’s global types.
- Docs show importing globals via relative paths that work for both user-scoped and server-scoped installs.

## Best practices (worth actually following)

### Security
- Never store secrets (API keys/tokens) in `extensionSettings` (plain text, visible to other extensions).
- Sanitize user input used in the DOM or commands (DOMPurify is available in `SillyTavern.libs`).
- Avoid `eval()`/`Function()`.

### Performance
- Avoid storing large blobs in `extensionSettings`.
  - Use `localforage` (IndexedDB-backed) for larger data, or `localStorage` for small data.
- Clean up event listeners if you create/destroy UI.
- Don’t block the UI thread; use async patterns and yield during heavy loops.

### Compatibility
- Prefer `getContext()` APIs over direct imports.
- Use a unique extension key/module name to avoid conflicts.

## Quick checklist for this repo (zTracker)
- UI extension with `manifest.json` + bundled assets (`dist/index.js`, `dist/style.css`).
- Uses `getContext()` + events + a `generate_interceptor`.
- Stores persistent settings and also uses per-chat metadata.
- Uses structured outputs when possible; otherwise prompt-engineers JSON/XML and parses fenced blocks.

