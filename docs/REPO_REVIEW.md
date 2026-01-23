# Repo review: SillyTavern-zTracker

## What this repo is
This repository builds a **SillyTavern extension** named **zTracker**. The extension generates and renders a structured “tracker” object (e.g., scene state) for chat messages using an LLM connection profile, and stores that tracker data inside the chat history so it persists with the conversation.

Primary user-facing features (per the code and README):
- One-click **Generate tracker** button on each message
- Optional **Auto Mode** to generate on user/character messages
- Editable **schema presets** (JSON Schema + an HTML/Handlebars template to render it)
- Per-message controls: **regenerate**, **edit JSON**, **delete**
- A menu action to pick a schema preset for the current chat (metadata)

## How it works (data flow)
1. A user clicks the zTracker message button (or Auto Mode triggers).
2. The extension builds a prompt using SillyTavern context and a selected connection profile.
3. It requests structured output from the LLM:
   - **Native mode**: asks the API for structured output using a `json_schema` payload.
   - **Prompt-engineered mode (JSON/XML)**: injects a schema + example into a prompt template, then parses a fenced code block.
4. The parsed tracker is stored in the message object:
   - `message.extra.zTracker.value` → the tracker JSON object
   - `message.extra.zTracker.html` → the Handlebars template used to render it
5. The tracker is rendered into the chat DOM above the message text with edit/regenerate/delete controls.

The extension also injects previous tracker snapshots into prompts to keep the model consistent across turns.

## Important implementation details

### Storage model
- **Per-message tracker data** is stored in the SillyTavern chat log:
  - `message.extra[EXTENSION_KEY].value`
  - `message.extra[EXTENSION_KEY].html`
- **Per-chat selection** is stored in chat metadata:
  - `chatMetadata.zTracker.schemaKey`

Notable behavior: the UI allows selecting a schema preset for the current chat (metadata), but generation currently uses the global settings preset (see “Potential gaps / gotchas”).

### Rendering
- Rendering is done via **Handlebars** compiled with `{ noEscape: true, strict: true }`.
  - `noEscape: true` means the template output is inserted as raw HTML.
  - `strict: true` will throw if the template references missing fields.
- Rendering failures are handled defensively:
  - On generation, if render fails, the newly-added tracker data is removed and not saved.
  - On chat change, if existing tracker data fails to render, it is removed from those messages.

### LLM request strategies
- **Native API structured output**: uses `buildPrompt(...)` + `Generator.generateRequest(...)` and passes a `json_schema` override payload.
- **Prompt-engineering structured output**:
  - Generates an example response from schema (JSON or XML)
  - Builds a final prompt using Handlebars
  - Parses response from a markdown fenced code block via [src/parser.ts](src/parser.ts)

### Prompt context injection (current behavior)
- `includeZTrackerMessages` clones the chat and injects up to `includeLastXZTrackerMessages` tracker snapshots as user messages formatted as `Tracker:\n```json ...````, inserting each snapshot immediately after the message it came from.
- Tracker generation calls this helper before requesting a new tracker, so LLM updates see prior trackers as context.
- A global `ztrackerGenerateInterceptor` mutates every outgoing chat array with the latest settings, so all SillyTavern generations (not just zTracker flows) receive the same injected snapshots.
- The setting defaults to `1`; `0` disables injection. There is no explicit “all snapshots” sentinel or token cap beyond choosing a large number.

## Code map

- [src/index.tsx](src/index.tsx)
  - Main entry point (bootstraps settings UI + non-React DOM hooks)
  - Adds the per-message zTracker button
  - Handles generate/edit/delete/regenerate
  - Registers Auto Mode event handlers
  - Registers global `ztrackerGenerateInterceptor`

- [src/components/Settings.tsx](src/components/Settings.tsx)
  - React settings UI
  - Uses `ExtensionSettingsManager` to persist settings
  - Manages schema presets (create/rename/delete) and edits schema JSON + HTML

- [src/config.ts](src/config.ts)
  - Settings model + defaults
  - Default schema (JSON Schema), default HTML template, and prompt templates

- [src/parser.ts](src/parser.ts)
  - Extracts content from a fenced code block and parses JSON/XML
  - For XML, normalizes arrays based on schema so single items become arrays

- [src/schema-to-example.ts](src/schema-to-example.ts)
  - Generates an “example response” from JSON Schema
  - Can output either JSON or a simple XML representation

- [templates/buttons.html](templates/buttons.html)
  - Adds an Extensions menu item (“Modify zTracker schema”)

- [templates/modify_schema_popup.html](templates/modify_schema_popup.html)
  - Popup UI for selecting schema preset for the active chat

- [src/styles/main.scss](src/styles/main.scss)
  - Settings layout and tracker controls styling

## Build, dev, and test

### Prereqs
- Node.js + npm

### Commands
- `npm install`
- `npm run dev`
  - Compiles SCSS to `dist/style.css`
  - Runs webpack in watch mode for `dist/index.js`
- `npm run build`
  - Production build of JS bundle and CSS
- `npm test`
  - Jest with `ts-jest` in ESM mode
- `npm run prettify`
  - Formats TS/TSX and HTML templates

### Output artifacts
- `dist/index.js` (webpack bundle, ESM)
- `dist/style.css` (compiled from SCSS)

SillyTavern loads these via [manifest.json](manifest.json).

## Extension integration (SillyTavern)
- [manifest.json](manifest.json) declares:
  - `js: dist/index.js`
  - `css: dist/style.css`
  - `generate_interceptor: ztrackerGenerateInterceptor`
- Runtime expects a global `SillyTavern` object and uses `SillyTavern.getContext()`.

## Potential gaps / gotchas (worth knowing)
- **Per-chat schema preset appears not to be used for generation**: the chat metadata key is written/updated, but `generateTracker(...)` uses `settings.schemaPreset` when choosing schema/html. If per-chat presets are intended, generation should read from `chatMetadata.zTracker.schemaKey`.
- **Version fields don’t currently line up**: `manifest.json` (0.1.1), `src/config.ts` default settings version (0.1.0), and `package.json` (1.0.0) all differ.
- **`npm run dev` does not watch SCSS**: it compiles once, then only webpack stays watching. If you’re iterating on styles, you may want `sass --watch ...`.
- **Template rendering is strict**: if you add fields to the schema but don’t update the HTML template (or vice versa), trackers can fail to render and be removed.
- **Response parsing expects a fenced code block** for JSON/XML prompt-engineering modes; if a model returns extra text or multiple blocks, parsing may fail.
- **Raw HTML rendering** (`noEscape: true`) means a malicious template could inject arbitrary HTML. In practice, this is user-authored in local settings, but it’s still a sharp edge.
- **React is listed as a peer dependency**: for local builds, you may still need `react` and `react-dom` installed in your dev environment unless your tooling/host provides them at build time.

Minor cleanup notes (non-blocking):
- `package.json` has `description`/`main` fields that look like leftovers (the codebase is TS/TSX and webpack’s entry is `src/index.tsx`).

## Dependencies at a glance
- `sillytavern-utils-lib` for prompt building, connection profiles, settings management, UI components.
- `fast-xml-parser` for XML parse support.
- `handlebars` for rendering tracker HTML templates.

## Where to look first
- Behavior + integration: [src/index.tsx](src/index.tsx)
- Defaults + settings schema: [src/config.ts](src/config.ts)
- Settings UI: [src/components/Settings.tsx](src/components/Settings.tsx)
# Repo review: SillyTavern-zTracker

## What this repo is
This repository builds a **SillyTavern extension** named **zTracker**. The extension generates and renders a structured “tracker” object (e.g., scene state) for chat messages using an LLM connection profile, and stores that tracker data inside the chat history so it persists with the conversation.

Primary user-facing features (per the code and README):
- One-click **Generate tracker** button on each message
- Optional **Auto Mode** to generate on user/character messages
- Editable **schema presets** (JSON Schema + an HTML/Handlebars template to render it)
- Per-message controls: **regenerate**, **edit JSON**, **delete**
- A menu action to pick a schema preset for the current chat (metadata)

## How it works (data flow)
1. A user clicks the zTracker message button (or Auto Mode triggers).
2. The extension builds a prompt using SillyTavern context and a selected connection profile.
3. It requests structured output from the LLM:
   - **Native mode**: asks the API for structured output using a `json_schema` payload.
   - **Prompt-engineered mode (JSON/XML)**: injects a schema + example into a prompt template, then parses a fenced code block.
4. The parsed tracker is stored in the message object:
   - `message.extra.zTracker.value` → the tracker JSON object
   - `message.extra.zTracker.html` → the Handlebars template used to render it
5. The tracker is rendered into the chat DOM above the message text with edit/regenerate/delete controls.

The extension also injects previous tracker snapshots into prompts to keep the model consistent across turns.

## Important implementation details

### Storage model
- **Per-message tracker data** is stored in the SillyTavern chat log:
  - `message.extra[EXTENSION_KEY].value`
  - `message.extra[EXTENSION_KEY].html`
- **Per-chat selection** is stored in chat metadata:
  - `chatMetadata.zTracker.schemaKey`

Notable behavior: the UI allows selecting a schema preset for the current chat (metadata), but generation currently uses the global settings preset (see “Potential gaps / gotchas”).

### Rendering
- Rendering is done via **Handlebars** compiled with `{ noEscape: true, strict: true }`.
  - `noEscape: true` means the template output is inserted as raw HTML.
  - `strict: true` will throw if the template references missing fields.
- Rendering failures are handled defensively:
  - On generation, if render fails, the newly-added tracker data is removed and not saved.
  - On chat change, if existing tracker data fails to render, it is removed from those messages.

### LLM request strategies
- **Native API structured output**: uses `buildPrompt(...)` + `Generator.generateRequest(...)` and passes a `json_schema` override payload.
- **Prompt-engineering structured output**:
  - Generates an example response from schema (JSON or XML)
  - Builds a final prompt using Handlebars
  - Parses response from a markdown fenced code block via [src/parser.ts](src/parser.ts)

### Prompt context injection
- The extension can inject the last X previous trackers into prompts as user messages.
- This is used both:
  - internally during tracker generation, and
  - globally via the `generate_interceptor` hook in `manifest.json`.

## Code map

- [src/index.tsx](src/index.tsx)
  - Main entry point (bootstraps settings UI + non-React DOM hooks)
  - Adds the per-message zTracker button
  - Handles generate/edit/delete/regenerate
  - Registers Auto Mode event handlers
  - Registers global `ztrackerGenerateInterceptor`

- [src/components/Settings.tsx](src/components/Settings.tsx)
  - React settings UI
  - Uses `ExtensionSettingsManager` to persist settings
  - Manages schema presets (create/rename/delete) and edits schema JSON + HTML

- [src/config.ts](src/config.ts)
  - Settings model + defaults
  - Default schema (JSON Schema), default HTML template, and prompt templates

- [src/parser.ts](src/parser.ts)
  - Extracts content from a fenced code block and parses JSON/XML
  - For XML, normalizes arrays based on schema so single items become arrays

- [src/schema-to-example.ts](src/schema-to-example.ts)
  - Generates an “example response” from JSON Schema
  - Can output either JSON or a simple XML representation

- [templates/buttons.html](templates/buttons.html)
  - Adds an Extensions menu item (“Modify zTracker schema”)

- [templates/modify_schema_popup.html](templates/modify_schema_popup.html)
  - Popup UI for selecting schema preset for the active chat

- [src/styles/main.scss](src/styles/main.scss)
  - Settings layout and tracker controls styling

## Build, dev, and test

### Prereqs
- Node.js + npm

### Commands
- `npm install`
- `npm run dev`
  - Compiles SCSS to `dist/style.css`
  - Runs webpack in watch mode for `dist/index.js`
- `npm run build`
  - Production build of JS bundle and CSS
- `npm test`
  - Jest with `ts-jest` in ESM mode
- `npm run prettify`
  - Formats TS/TSX and HTML templates

### Output artifacts
- `dist/index.js` (webpack bundle, ESM)
- `dist/style.css` (compiled from SCSS)

SillyTavern loads these via [manifest.json](manifest.json).

## Extension integration (SillyTavern)
- [manifest.json](manifest.json) declares:
  - `js: dist/index.js`
  - `css: dist/style.css`
  - `generate_interceptor: ztrackerGenerateInterceptor`
- Runtime expects a global `SillyTavern` object and uses `SillyTavern.getContext()`.

## Potential gaps / gotchas (worth knowing)
- **Per-chat schema preset appears not to be used for generation**: the chat metadata key is written/updated, but `generateTracker(...)` uses `settings.schemaPreset` when choosing schema/html. If per-chat presets are intended, generation should read from `chatMetadata.zTracker.schemaKey`.
- **Version fields don’t currently line up**: `manifest.json` (0.1.1), `src/config.ts` default settings version (0.1.0), and `package.json` (1.0.0) all differ.
- **`npm run dev` does not watch SCSS**: it compiles once, then only webpack stays watching. If you’re iterating on styles, you may want `sass --watch ...`.
- **Template rendering is strict**: if you add fields to the schema but don’t update the HTML template (or vice versa), trackers can fail to render and be removed.
- **Response parsing expects a fenced code block** for JSON/XML prompt-engineering modes; if a model returns extra text or multiple blocks, parsing may fail.
- **Raw HTML rendering** (`noEscape: true`) means a malicious template could inject arbitrary HTML. In practice, this is user-authored in local settings, but it’s still a sharp edge.
- **React is listed as a peer dependency**: for local builds, you may still need `react` and `react-dom` installed in your dev environment unless your tooling/host provides them at build time.

Minor cleanup notes (non-blocking):
- `package.json` has `description`/`main` fields that look like leftovers (the codebase is TS/TSX and webpack’s entry is `src/index.tsx`).

## Dependencies at a glance
- `sillytavern-utils-lib` for prompt building, connection profiles, settings management, UI components.
- `fast-xml-parser` for XML parse support.
- `handlebars` for rendering tracker HTML templates.

## Where to look first
- Behavior + integration: [src/index.tsx](src/index.tsx)
- Defaults + settings schema: [src/config.ts](src/config.ts)
- Settings UI: [src/components/Settings.tsx](src/components/Settings.tsx)

