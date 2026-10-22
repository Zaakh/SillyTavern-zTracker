# SillyTavern zTracker

## Overview

A [SillyTavern](https://docs.sillytavern.app/) extension that helps you track your chat stats with LLMs using [connection profiles](https://docs.sillytavern.app/usage/core-concepts/connection-profiles/).

Forked from [SillyTavern WTracker](https://github.com/bmen25124/SillyTavern-WTracker).

## Highlights (since the fork)

- Optional **Sequential generation** (generate trackers in smaller steps).
- **Modules** let one chat run separate trackers for different use cases, each with its own schema, prompts, generation, injection, and auto-generation settings.
- Modules can **chain in other Modules' tracker history** as generation context via **Include Module History**, in addition to their own self-history.
- The extension settings are grouped into **Tracker Generation** and **Tracker Injection** sections so generation tuning and prompt-context embedding are easier to find.
- **Regenerate only what you need** from the parts menu (one section, one list item like a character, or even one field).
- **Clear and recreate stale tracker sections** with a cleanup action when several parts are wrong at once.
- Manual tracker generation now shows a message-local status badge while the full tracker or a parts-menu update is in flight, so the active tracker job stays visible even if the initiating control scrolls away.
- **Filter World Info used for tracker generation** (allow only selected lorebooks/entries when needed).
- **Override Auto Mode per character and per Module** directly from the character panel: force it off, force it on, or leave it at each Module's own default.
- Optional **embed recent tracker snapshots** into normal generations for better continuity (either full JSON or a compact plain-text format).
- Tracker generation now preserves speaker labels in prompt context where available, so turns like `Tobias:` and `Bar:` stay clearer for pronoun-heavy scenes.
- Normal instruct-mode chat interception also preserves speaker labels when SillyTavern stores them on source messages instead of flattening them directly into turn content.

---

zTracker follows the SillyTavern chat type of whichever connection it is currently using for tracker generation. In **Connection Source = Use current active SillyTavern connection** mode, zTracker resolves tracker-generation connection state from the live SillyTavern runtime, including the currently active prompt selectors and any host-exposed active connection changes. In **Connection Source = Use selected saved connection profile** mode, zTracker uses the pinned saved profile you selected in zTracker settings.

---
- **Export a tracker to a lorebook** (new entry or replace the linked one), with an optional model-suggested title, and a compact **Flat** snapshot format shared by chat injection and lorebook entries.

## Modules

In **Extensions -> zTracker**, use **Modules** when you want more than one tracker in the same chat, such as a scene tracker plus an agenda tracker. Each Module has its own schema presets, prompt templates, system prompt source, connection settings, generation behavior, injection settings, and auto-generation toggle.

The original single tracker is upgraded into the **Default** Module the first time this version runs. That settings format upgrade is one-way. Existing saved tracker data, current-chat schema choices, and character auto-mode exclusions are preserved under the Default Module. A brand-new install instead automatically seeds all three [pre-made Modules](#pre-made-modules) below - **Scene Tracker** enabled, **Plot Log** and **Plot Steer** disabled until you opt in.

You can add, clone, reorder, delete, export, and import Modules from the settings panel. Export downloads a `.json` file with the Module's full configuration (schema presets, prompts, system prompt, connection, generation, and injection settings); Import reads such a file back through a file picker. If the Module uses a custom (or edited built-in) snapshot transform preset, the export carries that preset and import adds it to your shared preset list, under a new name if yours already differs. Deleting a Module also removes that Module's saved tracker data from the current chat history.

Each Module has a **Module State** selector with three values: **Off** (no generation, injection, chaining, or chooser entry), **Manual** (generates only when you trigger it, but is still injected and chainable once it has snapshots), and **Auto** (also generates automatically; the **Direction** setting picks which chat events trigger it). The message truck button always opens a chooser listing the Manual and Auto Modules, even when only one exists. Already-saved tracker blocks of an Off Module stay visible, labeled with the Module name, until you delete them.

### Chaining tracker history across Modules

Each Module has an **Include Module History** list under **Tracker Generation** that controls which Modules' past tracker snapshots are pulled into that Module's own generation context, separate from **Tracker Injection**'s embedding into normal generations. Every Module always has a **self** entry for its own history, which stays bound to that Module's raw message window like before. Chained entries (for other Modules that generate earlier than the current one) are not limited by that window at all - they are found directly from chat history and included as extra context ahead of the window. A count of `0` on any entry (self or chained) means that entry contributes nothing.

A Module can only chain in another Module that is listed above it in the **Modules** list (the list is the generation order, and each row shows its position; reorder with Up/Down). If a chained Module is later disabled or reordered so it is no longer earlier, that entry goes dormant (shown with a warning icon) and stops contributing until you fix the order, re-enable the Module, or remove the entry. Chained snapshots are always formatted using the referenced Module's own **Tracker Injection** settings (header, virtual-character mode, transform preset).

### Pre-made Modules

A fresh install automatically creates all three Modules below: **Scene Tracker** enabled, **Plot Log** and **Plot Steer** disabled until you enable them in Settings. If you deleted one, or you're upgrading from an older install that never had them, `templates/modules/` in this repository (and the same folder inside a built copy of the extension, under `dist/templates/modules/`) also ships them as ready-to-import files - import the same way as any exported Module (Modules -> **Import**, then pick the file); a manually imported Plot Log/Plot Steer is enabled by default, unlike the seeded one.

- **Scene Tracker** (`scene-tracker.json`) is the built-in scene tracker: time, location, weather, topics, and each present character's appearance and state of dress.
- **Plot Log** (`plot-log.json`) tracks ongoing story plot state - current arc, open threads, recent events, and stakes - and renders normally like any other tracker. It is never embedded into live generation.
- **Plot Steer** (`plot-steer.json`) reads Plot Log's stored history and suggests the single next story beat (plus a pacing hint: escalate, resolve, hold, or twist). Unlike Plot Log, its suggestion **is injected** into the next generation request, not just displayed - only the single most recent suggestion is ever embedded, and its tracker display is a one-line summary rather than a full table.

Each of these Modules ships its own tailored system prompt, installed as a dedicated saved SillyTavern system-prompt preset the moment the Module is created (fresh install or manual Import) - see **System Prompt Source** in that Module's settings. If that preset is ever deleted from SillyTavern, Settings keeps showing the usual missing-preset warning and adds a one-click **Recreate prompt** action next to it, so restoring it doesn't require re-importing the whole Module.

**If you import Plot Log and Plot Steer manually, import Plot Log first.** Plot Steer's history of Plot Log is a chained include entry, which only works when its target Module was imported earlier and is ordered earlier in **Generation Order**. Importing Plot Steer first leaves that entry dormant (shown with a warning icon in Settings) until you also import Plot Log and confirm the order. The automatic seeding on a fresh install always creates them in the correct order.

**Plot Steer auto-generates by default once enabled**, right after each of your messages and before the character's reply, using whichever SillyTavern connection is currently active in the chat. This means one extra LLM call every turn once enabled - leave it **Off**, or set its Module State to **Manual** in Settings, if you'd rather trigger it yourself.

## Installation

Install via the SillyTavern extension installer:

```txt
https://github.com/Zaakh/SillyTavern-zTracker
```

## FAQ

>I'm having API error.

Your API/model might not support structured output. Change `Prompt Engineering` mode from `Native API` to `JSON`, `XML`, or `TOON`.

> zTracker UI buttons / schema popup are broken (template 404).

In **Extensions → zTracker**, enable **Debug logging** and use the **Diagnostics** panel (**Run diagnostics** button) to print template URL checks to the console. This helps confirm whether SillyTavern can access the extension’s HTML templates.

## Grammar/schema enforcement (JSON mode only)

When a Module's `Prompt Engineering` mode is set to `JSON`, an **Enforce schema via grammar sampling** checkbox appears. Enabling it adds the Module's JSON Schema as an extra structured-output constraint on every generation request, on top of the usual JSON prompt template. This only has an effect on backends SillyTavern forwards it to today (llama.cpp server, TabbyAPI, and Chat Completion) - other backends silently ignore it. Use the **Test** button next to the checkbox to confirm your current connection actually honors it before relying on it.

## Connection source for tracker generation

zTracker can now choose where tracker-generation connection settings come from:
- **Use current active SillyTavern connection**: resolve tracker-generation connection data from the live SillyTavern runtime, including the currently active prompt selectors and any host-exposed active connection changes.
- **Use selected saved connection profile**: keep tracker generation pinned to a specific saved SillyTavern connection profile.

This is useful when you want tracker generation to automatically follow your current SillyTavern connection during experimentation, while still keeping the option to pin zTracker to a dedicated extraction profile when needed. If you rely on live unsaved host changes, do a quick smoke test after SillyTavern upgrades.

**What a saved profile controls.** A Module on a saved profile uses that profile for the API, server, model, secret, sampler (settings) preset, instruct and context templates, instruct on/off, custom stop strings, **Start Reply With**, and reasoning template. Anything the profile did not record falls back to the live SillyTavern value for that one setting. The live connection uses the live values throughout. (Known limitation: on Chat Completion, the live connection still sends through SillyTavern's currently selected saved profile.) Diagnostics shows which source was used and which settings fell back. A saved sampler preset is converted by SillyTavern for the backend type currently selected in SillyTavern, so keep the profile's API and the live API type aligned when the profile pins a different backend.

**Start Reply With** is sent as the start of the model's reply (after the reply cue on Text Completion, as a last assistant message on Chat Completion) and put back in front of the reply before parsing. A prefill such as `{` therefore suits JSON mode but breaks XML/TOON mode. When a structured-output schema is sent, a prefill that would open a reasoning block and leave it open is left out.

**Reasoning** blocks (the effective reasoning template's prefix and suffix) are stripped from tracker replies before parsing and are never stored. A reply cut off inside a reasoning block fails with an "unclosed reasoning block" error; raise the Module's max response tokens or use a non-reasoning profile.

## System prompt selection for tracker generation

zTracker can now choose the system prompt used during tracker generation:
- **From active SillyTavern presets**: use the currently active host prompt settings.
- **From selected connection profile**: use the system prompt stored on the Module's saved connection profile. This only selects the system prompt; instruct, context and sampler presets follow the Module's connection either way (see above).
- **From saved ST prompt**: pick a saved SillyTavern system prompt specifically for tracker extraction.

Each Module installs its own system-prompt preset automatically, named after that Module and derived from its own prompt content, the first time the Module is created (fresh install, "Add Module", or manual Import). Select that Module's preset in **Extensions → zTracker → System Prompt Source**, and edit it later in SillyTavern's own **System Prompt** manager. If a Module's preset ever goes missing, use the "Recreate prompt" action next to the warning to restore it. Older zTracker prompt presets are not deleted automatically.

This is especially useful for smaller models: you can keep your roleplay-oriented system prompt for normal chat, while using a lean extraction-oriented prompt for tracker generation.

## Sequential generation & per-part regeneration

In **Extensions → zTracker**, enable **Sequential generation** to have zTracker generate tracker fields one-by-one (smaller, sequential requests).

If you want to avoid low-context tracker updates at the start of a chat, set **Skip First X Messages** in **Extensions → zTracker**. A value of `0` keeps the old behavior; higher values prevent first-time tracker generation on early messages until the threshold is reached. Explicit full redo of an already existing tracker still works there.

If character-card prose is adding noise to extraction, enable **Skip character card in tracker generation** in **Extensions → zTracker**. The setting is off by default, and when enabled it makes tracker generation ignore character-card prompt fields such as description, personality, and scenario.

If the model seems to over-weight who said a line instead of the scene content itself, change **Conversation role handling** in **Extensions → zTracker** from **Preserve user and assistant roles** to **Treat all chat turns as assistant**. This only changes how zTracker labels chat turns during tracker-generation requests; it does not affect normal chat generation or tracker snapshot injection.

To change how a specific character participates in **Auto Mode**, open that character's panel and use the zTracker truck control in the avatar action row. With one Module configured, clicking it cycles that Module's override for this character: **Default** (follow the Module's own state: only an **Auto** Module generates automatically) → **Off** (never auto-generate for this character on that Module) → **On** (always auto-generate for this character on that Module, using that Module's configured direction, even if the Module is Manual for everyone else) → back to **Default**. With multiple Modules configured, clicking the control opens a small menu so you can set each Module's override independently. This only affects **Auto Mode**; manual tracker generation from message controls always works regardless of the override.

When a tracker is rendered on a message, use the tracker controls:
- **Regenerate Tracker** (rotate icon) rebuilds the whole tracker from scratch using the schema preset selected for the chat and its template; existing data is replaced, not migrated.
- **Parts menu** (list icon) lets you regenerate an individual top-level field (e.g. `time`, `location`, `topics`) without regenerating everything.
- **Cleanup** (eraser icon) lets you clear several wrong tracker targets at once, then either leave them pending or recreate them in one coordinated run.

While a manual full tracker generation or regeneration is running, zTracker shows a message-local `Updating tracker` badge above the target message. Auto Mode keeps using its existing `Generating tracker before reply` hold indicator instead.

For array parts (e.g. `characters`), the parts menu also exposes:
- Per-item regeneration (by stable identity when available).
- Per-field regeneration inside an item (e.g. regenerate `characters (Silvia).outfit`).

While one of those menu actions is running, zTracker shows a message-local `Updating tracker from menu` badge above the target message. This keeps the active job visible without hijacking the main send button or implying that normal chat generation is paused.

If several related tracker values are wrong at once, use **Cleanup** instead of fixing them one by one. You can select top-level parts, whole array items, or specific item fields, then choose either:
- **Clear and recreate selected targets** to remove stale values before regenerating them.
- **Clear selected targets only** to leave them blank and marked as pending until you want to retry later.

Pending cleanup targets stay visible in the tracker UI so you can see which sections were intentionally cleared and still need attention.

Tracker templates now escape normal tracker values by default. If you previously relied on raw HTML inside tracker data fields, update the template to opt out deliberately instead of assuming those values will render as live markup. When a saved tracker can no longer render with the current template, zTracker keeps the stored data and shows a message-local warning so you can repair the template or tracker JSON without losing the underlying tracker.

Optional (advanced): you can annotate your JSON schema preset to help zTracker keep interdependent sections ordered and array items stable:
- `x-ztracker-dependsOn`: top-level part ordering hints for sequential generation.
- `x-ztracker-idKey`: which string field to use as the array-item identity for per-item regeneration (defaults to `name`).

When editing a schema preset's JSON or HTML in **Extensions → zTracker**, changes stay local until you click that editor's **Save JSON** / **Save HTML** button (directly under the textarea). Schema JSON and Schema HTML save independently: each one must still render against the other's *saved* version, and invalid drafts show an inline error instead of overwriting the saved preset. When you have edited both (for example, renaming a field in each) and they work together, either Save button saves both.

zTracker honors only a subset of JSON Schema: `type`, `properties`, `items`, `required`, `enum`, `const`, `default`, `format`, `description`, `title`, and the `x-ztracker-*` annotations. The editor lists findings for the current Schema JSON draft:
- **Errors** block saving Schema JSON: an array with no `items`, or an object with no `properties`.
- **Warnings** flag things silently dropped from JSON/XML/TOON prompts (`$ref`/`$defs`, `oneOf`/`anyOf`/`allOf`, `patternProperties`, any other keyword such as `minLength`/`pattern`, `additionalProperties` while grammar enforcement is off), arrays of objects with neither `x-ztracker-idKey` nor a `name` field, and invalid `x-ztracker-dependsOn` references or cycles.
- **Notes** list fields with no `description`. Descriptions are what actually tell the model what to write (TOON mode drops them). Notes also flag wrappers that only cost tokens: a `maxItems: 1` array, an array of one-field objects, a one-field object, and same-shaped sibling arrays that could be one array with a `kind` field. Flattening changes the stored data shape, so the HTML template must change with it; `x-ztracker-idKey` on array items opts out.

**Diagnostics** reports the same findings for every Module and preset.

Don't want to hand-write the HTML template? Click **Generate HTML** (between the JSON and HTML editors) to derive one automatically from the current Schema JSON draft. It always overwrites the Schema HTML draft (click Save to apply) and is disabled while the Schema JSON draft is invalid.

### Generating a schema and prompts from a description

Instead of writing everything by hand, describe the tracker in the **Design brief** box (saved with the Module) and use the buttons below it (hover each for what it produces, reads and replaces):

- **Generate schema** (model): drafts the Schema JSON from your brief. **Advanced...** next to it opens a dialog where you can edit the system prompt's instruction text (the schema dialect rules and starter examples are always added automatically), generate, edit the previewed schema and press **Apply**; nothing reaches the draft before Apply. The draft is checked by the dialect lint and sent back for repair up to twice if it has errors, warnings or wrapper notes; the best attempt stays in the draft with its findings shown. Nothing is saved until you click Save.
- **Generate HTML** (no model): derives the HTML from the Schema JSON draft, as above. Run it after a schema was generated.
- **Generate prompts...** (model, dialog only): opens a dialog with an editable instruction and an editable preview for each of a system prompt and a base prompt, written from your brief and the current Schema JSON draft. Nothing changes until you press **Apply**, which then applies both **immediately**, saving a system prompt preset named `zTracker-<module id>-generated` (overwritten on each Apply); a notice beside Apply says when existing prompts will be overwritten. Your globally selected SillyTavern system prompt is not changed.

Edited instructions in these dialogs are kept across sessions and shown as "(edited)"; **Reset to default** restores the shipped text. Generate schema's regular button uses your saved instruction too.

Both model-backed buttons use the **global active SillyTavern connection** (shown next to the buttons), not the Module's own connection settings. Replies get at least 2048 tokens, so use a connection with a context window large enough for the examples sent along (a small local model with a 2048-token context cannot fit a repair round). Overwrites are announced inline; there is no separate confirmation dialog, and you can cancel a running generation.

In **Extensions → zTracker**, **Default Schema Preset** controls which preset definition you are editing and which preset new chats start from. Existing chats keep their own **Current Chat Schema Preset**, which you can change from the settings UI or **Extensions → Modify zTracker schema**.

Changing the current chat schema preset is still a lazy switch, not a chat-wide migration. Future full tracker generations in that chat use the current chat schema preset, while existing trackers on older messages keep their saved message schema until you run a full tracker regeneration on that specific message. Parts-menu regeneration continues to use the saved message schema and tells you when a full tracker regeneration is required to move that message onto the current chat schema.

If a dependency-linked array becomes inconsistent during generation, zTracker now logs a warning in the browser console. Example: `charactersPresent` lists a character name but `characters` has no matching object for that name.

## World Info (lorebooks)

In **Extensions → zTracker**, you can control World Info during tracker generation: include all (default), exclude all, or allowlist specific lorebooks (names are case-insensitive). This only affects zTracker tracker generation (button / Auto Mode), not normal SillyTavern generations.

In allowlist mode, zTracker uses only the allowlisted lorebooks. Each book has an **activation scope**:

- **No scope checked (default):** always used, even if the book is not active anywhere in SillyTavern.
- **Character card or chat:** used only if the book is attached to the open chat's character card (primary or additional lorebook) or is the chat-bound lorebook. In a group chat, any member's card counts (disabled members included).
- **Global:** used only if the book is globally selected.
- Both checked: used if either holds.

Each allowlisted book also has an **activation** setting:

- **Engine rules** (default for newly added books): SillyTavern's own World Info engine decides which of the book's entries activate (keywords, constants, inclusion groups, probability, recursion, budget, character filters). Only the allowlisted books (and their entry UIDs, if set) are considered; other active lorebooks are ignored.
- **Always inject all** (what existing allowlists migrate to): every enabled entry is injected as plain content, bypassing keywords, inclusion groups and the other activation rules.

How World Info reaches the tracker prompt:

- All World Info, in every mode, is delivered as **one system message** placed before the first chat message. In "Allow all" mode with a chat-completion connection it is wrapped with the active preset's World Info format (text completion has no such format, so it is injected as-is). Position settings (before/after character, depth, Author's Note, outlets) are not reproduced; their content is joined into that message.
- Tracker generation scans World Info as a **dry run**: it never starts, advances or clears sticky/cooldown timers and never fires SillyTavern's activated event. The flip side is that sticky and cooldown are not applied to tracker scans (an entry that is sticky in the chat is not kept alive for the tracker, and an entry on cooldown can still appear), and entry `delay` is evaluated against the real chat length.
- Known limits: character filters use the character currently selected in SillyTavern, not the tracker's target character; a scan clears entries force-activated by other extensions or slash commands before your next generation; every World Info scan (Allow all or Engine rules) waits briefly for an in-progress SillyTavern generation to finish; the engine path needs SillyTavern 1.18 or newer, otherwise no World Info is injected.

### Seeing which World Info was used

Tracker scans are dry runs, so SillyTavern's own World Info inspector shows nothing for them. Click the book icon (**World Info used**) in a tracker's control row to see what the model was shown for that tracker:

- **Outcome:** applied, none matched, excluded by your policy, or scan unavailable (SillyTavern did not report which entries it activated, so none are listed from the scan).
- **Applied entries**, grouped by book, each with how it got in: constant, matched keywords, activated by recursion, activated to reach the minimum activations, added by the allowlist (Always inject all), or other (for example a character card field, a macro, or per-entry settings).
- **Not applied** (collapsed): allowlisted books and entries that were not injected, and why (scope not satisfied, book not found or empty, entry disabled, not in the allowed entries, empty content). For Engine rules books only structural causes are listed; entries that simply did not activate are not.

Two things to know:

- **Keyword reasons are inferred.** SillyTavern does not say which key matched, so zTracker checks each entry's keys against the scanned messages itself (case-insensitive text, or `/regex/` keys; secondary keys only under AND logic). SillyTavern scans only its World Info depth setting (and per-entry overrides), while zTracker checks the whole message window, so a key in an older message can be shown as a keyword match for an entry that activated another way. Per-entry scan depth, case or whole-word overrides, macros and character card matching are not modelled either, so some entries may show as "other". Constant, recursion and minimum-activations reasons come from SillyTavern and are exact.
- **Titles and keys are stored in the chat file.** Each generation that stores a tracker (full, part, item or field regeneration) replaces the record on that message; failed or cancelled runs and "clear selected" leave it unchanged. It holds entry titles, uids, keys and causes, capped at 50 entries per list and book and 20 books, with titles and keys shortened to 100 characters, and never entry content. Chat exports include it. Trackers generated before this feature show "not recorded".

A book can optionally list **entry UIDs** to inject only those entries. Click **Refresh books** to detect available books, search/select one, and **Add** it. When a scope is not satisfied by the open chat, the row shows a warning that it will be skipped (and "cannot be checked" when no chat is open). The check runs when the section is shown and when rows change; use **Recheck** after switching chats.

## Exporting a tracker to a lorebook

Each tracker block has two text-labeled buttons for copying its content into a World Info lorebook, so long-lived content such as a detailed character can be triggered across chats:

- **Export to lorebook...** opens a dialog: pick a lorebook, enter the entry **title** (required) and the **keys** (they default to the title and follow it until you edit them; clear them and the entry is created without keys and will not trigger until you add some). **Suggest title** and **Suggest keys** (wand buttons) send the tracker text to your live SillyTavern connection and fill the field; the keys request also carries the current title. Each has its own short system prompt. **Advanced...** opens a dialog where you can edit that prompt, generate, edit the result and press **Apply**; nothing is written before Apply. An edited prompt is kept across sessions (**Reset to default** restores the shipped one) and is used by the wand button too. Nothing runs unless you press a button, one suggestion runs at a time, and applied keys stop following the title. Export always creates a new entry and never touches an existing one; the entry is saved and re-read from the lorebook before zTracker reports success.
- **Replace linked entry** overwrites the content of the entry created by the last export from this message. It is disabled until an export exists, and its label names the target book and entry. It changes only the entry's content (and its comment only if you have not renamed it), so keys, order, position and enabled state you edited in the lorebook are kept. If the book or entry is gone, nothing is written and you are offered **Export to lorebook...** instead. It never calls the model.

The entry text is the same snapshot the Module injects into chat. With the **Flat** preset (the default for new Modules), it is a `[Topic: <title>` ... `]` block of `key: value` lines, using the title you entered. Deleting the tracker from the message also removes the link.

## Embedding tracker snapshots into normal generations

zTracker can optionally embed the last $X$ tracker snapshots into the prompt chat array via its `generate_interceptor` (controlled by **Include Last X zTracker Messages**).

You can also control what **role** those embedded snapshots use (**User**, **System**, or **Assistant**) via **Embed zTracker snapshots as**. This setting only affects embedding; it does not change how zTracker generates trackers.

For **Text Completion** chats, assistant-role snapshots stay as assistant turns when zTracker can preserve a clear reply cue, such as SillyTavern's trailing assistant prefill turn or a host-confirmed solo-chat speaker label. When the host cannot confirm a single reply speaker, zTracker only falls back to inlining the snapshot into the final user turn when a standalone terminal assistant block would otherwise leave the prompt framing ambiguous.

If SillyTavern's prompt formatting is producing awkward prefixes like `Assistant: Tracker:`, enable **Inject as virtual character**. This uses the embed snapshot header as the injected speaker name and removes the duplicated header prefix from the embedded snapshot body.

In the text-completion-safe terminal assistant fallback, zTracker still keeps the tracker label inside the raw injected content so the prompt can end on the real assistant reply cue. See `docs/TRACKER_INJECTION_BEHAVIOR.md` for the current behavior matrix, including when that reply cue is host-confirmed versus inferred from prior assistant history.

You can also apply a **regex-based transform** to the embedded snapshot text (for prompt-friendly formatting) via **Embed snapshot transform preset**. The preset list is shared by all Modules: a Module only picks which preset it uses, editing a preset changes it for every Module that selects it (the editor shows how many), and the built-in presets can be edited but not deleted. Deleting a custom preset sends the Modules that used it back to Default.

The **Injection preview** below the preset editor shows the snapshot block a normal generation would embed (raw snapshot, after input formatting, after the regex, final block), live as you edit the header, virtual-character option, or preset. It uses the newest stored snapshot in the current chat (pick another message from the list, or **Refresh** after generating one); with no stored snapshot it shows an example built from the Module's schema. An invalid regex is reported there. It shows the standalone message only: in Text Completion, inline and terminal-assistant injections add wrapper text (speaker prefix or reply cue) that the preview does not show.

You can customize (or remove) the embedded snapshot header via **Embed snapshot header**.

- **Flat (key: value lines)** (default for new Modules and the shipped templates): embeds `[Topic: <Module name>`, one `key: value` line per field (nested objects and arrays on one line, empty values left out), then `]`. Never wrapped in a code fence.
- **Default (JSON)**: embeds pretty-printed JSON (no changes).
- **Minimal (top-level properties)**: embeds one line per top-level property (newline-separated).
- **TOON (compact)**: embeds tracker snapshots as tab-delimited TOON for lower-token structured context while preserving arrays and nested objects.


## Versioning

Developer and maintainer notes (local dev, testing, versioning) are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

For prompt debugging, maintainers can run `npm run debug:tracker-context:json`, `npm run debug:tracker-context:xml`, or `npm run debug:tracker-context:toon` to inspect one live-like tracker-generation request for each supported output mode. The saved request snapshots live under `test-output/tracker-context-json.md`, `test-output/tracker-context-xml.md`, and `test-output/tracker-context-toon.md`; the plain-text transport views live under `test-output/tracker-context-json.txt`, `test-output/tracker-context-xml.txt`, and `test-output/tracker-context-toon.txt`. Running `npm run debug:tracker-context:artifacts` refreshes only the `.txt` files so they stay aligned with the currently verified live behavior: the active text-completion connection path flattens tracker-generation messages into one raw `prompt` string without `System:`, `User:`, or `Assistant:` labels.

Live verification also showed that tracker generation includes character-card prompt content from SillyTavern's `buildPrompt(...)` step by default. You can now disable that input with the tracker-generation setting above when you want extraction to rely more heavily on recent chat state.
