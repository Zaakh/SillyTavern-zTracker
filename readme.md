# SillyTavern zTracker

## Overview

A [SillyTavern](https://docs.sillytavern.app/) extension that helps you track your chat stats with LLMs using [connection profiles](https://docs.sillytavern.app/usage/core-concepts/connection-profiles/).

Forked from [SillyTavern WTracker](https://github.com/bmen25124/SillyTavern-WTracker).

## Highlights (since the fork)

- Optional **Sequential generation** (generate trackers in smaller steps).
- The extension settings are grouped into **Tracker Generation** and **Tracker Injection** sections so generation tuning and prompt-context embedding are easier to find.
- **Regenerate only what you need** from the parts menu (one section, one list item like a character, or even one field).
- **Filter World Info used for tracker generation** (allow only selected lorebooks/entries when needed).
- **Exclude specific characters from Auto Mode** directly from the character panel when you do not want zTracker to auto-generate trackers for them.
- Optional **embed recent tracker snapshots** into normal generations for better continuity (either full JSON or a compact plain-text format).
- Tracker generation now preserves speaker labels in prompt context where available, so turns like `Tobias:` and `Bar:` stay clearer for pronoun-heavy scenes.
- Normal instruct-mode chat interception also preserves speaker labels when SillyTavern stores them on source messages instead of flattening them directly into turn content.

---

zTracker follows the SillyTavern chat type selected by the chosen connection profile. If that profile uses Text Completion, configure its instruct/context presets in SillyTavern itself; if it uses Chat Completion, SillyTavern's chat-completion prompt settings apply.

---

## Installation

Install via the SillyTavern extension installer:

```txt
https://github.com/Zaakh/SillyTavern-zTracker
```

## FAQ

>I'm having API error.

Your API/model might not support structured output. Change `Prompt Engineering` mode from `Native API` to `JSON`, `XML`, or `TOON`.

> zTracker UI buttons / schema popup are broken (template 404).

In **Extensions → zTracker**, enable **Debug logging** and use the **Diagnostics** panel (stethoscope button) to print template URL checks to the console. This helps confirm whether SillyTavern can access the extension’s HTML templates.

## System prompt selection for tracker generation

zTracker can now choose the system prompt used during tracker generation:
- **From connection profile**: keep the current SillyTavern connection profile behavior.
- **From saved ST prompt**: pick a saved SillyTavern system prompt specifically for tracker extraction.

On startup, zTracker installs a recommended versioned system prompt preset such as **zTracker-1.3.1** if it does not already exist. You can select it in **Extensions → zTracker → System Prompt Source**, and edit it later in SillyTavern's own **System Prompt** manager. Older zTracker prompt presets are not deleted automatically.

This is especially useful for smaller models: you can keep your roleplay-oriented system prompt for normal chat, while using a lean extraction-oriented prompt for tracker generation.

## Sequential generation & per-part regeneration

In **Extensions → zTracker**, enable **Sequential generation** to have zTracker generate tracker fields one-by-one (smaller, sequential requests).

If you want to avoid low-context tracker updates at the start of a chat, set **Skip First X Messages** in **Extensions → zTracker**. A value of `0` keeps the old behavior; higher values prevent tracker generation on early messages until the threshold is reached.

If character-card prose is adding noise to extraction, enable **Skip character card in tracker generation** in **Extensions → zTracker**. The setting is off by default, and when enabled it makes tracker generation ignore character-card prompt fields such as description, personality, and scenario.

If a specific character should never trigger zTracker automatically, open that character's panel and click the zTracker truck toggle in the avatar action row. This excludes that character from **Auto Mode** only; manual tracker generation from message controls still works.

When a tracker is rendered on a message, use the tracker controls:
- **Regenerate Tracker** (rotate icon) regenerates the whole tracker.
- **Parts menu** (list icon) lets you regenerate an individual top-level field (e.g. `time`, `location`, `topics`) without regenerating everything.

For array parts (e.g. `characters`), the parts menu also exposes:
- Per-item regeneration (by stable identity when available).
- Per-field regeneration inside an item (e.g. regenerate `characters (Silvia).outfit`).

Optional (advanced): you can annotate your JSON schema preset to help zTracker keep interdependent sections ordered and array items stable:
- `x-ztracker-dependsOn`: top-level part ordering hints for sequential generation.
- `x-ztracker-idKey`: which string field to use as the array-item identity for per-item regeneration (defaults to `name`).

If a dependency-linked array becomes inconsistent during generation, zTracker now logs a warning in the browser console. Example: `charactersPresent` lists a character name but `characters` has no matching object for that name.

## World Info (lorebooks)

In **Extensions → zTracker**, you can control World Info during tracker generation: include all (default), exclude all, or allowlist specific lorebook **book names** (case-insensitive) and/or entry **UIDs** (numbers). This only affects zTracker tracker generation (button / Auto Mode), not normal SillyTavern generations.

In allowlist mode, zTracker loads the allowlisted lorebooks by name and injects their matching entries into the tracker-generation prompt, even if those lorebooks are not currently active in SillyTavern.

When using **Allow only specified books/UIDs**, you can click **Refresh book list** to detect available books, search/select them, and **Add** them to the allowlist (with quick remove buttons). A manual textarea is still available under “Advanced”.

## Embedding tracker snapshots into normal generations

zTracker can optionally embed the last $X$ tracker snapshots into the prompt chat array via its `generate_interceptor` (controlled by **Include Last X zTracker Messages**).

You can also control what **role** those embedded snapshots use (**User**, **System**, or **Assistant**) via **Embed zTracker snapshots as**. This setting only affects embedding; it does not change how zTracker generates trackers.

If SillyTavern's prompt formatting is producing awkward prefixes like `Assistant: Tracker:`, enable **Inject as virtual character**. This uses the embed snapshot header as the injected speaker name and removes the duplicated header prefix from the embedded snapshot body.

You can also apply a **regex-based transform** to the embedded snapshot text (for prompt-friendly formatting) via **Embed snapshot transform preset**.

You can customize (or remove) the embedded snapshot header via **Embed snapshot header**.

- **Default (JSON)**: embeds pretty-printed JSON (no changes).
- **Minimal (top-level properties)**: embeds one line per top-level property (newline-separated).
- **TOON (compact)**: embeds tracker snapshots as tab-delimited TOON for lower-token structured context while preserving arrays and nested objects.


## Versioning

Developer and maintainer notes (local dev, testing, versioning) are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

For prompt debugging, maintainers can run `npm run debug:tracker-context:json`, `npm run debug:tracker-context:xml`, or `npm run debug:tracker-context:toon` to inspect one live-like tracker-generation request for each supported output mode. The saved request snapshots live under `test-output/tracker-context-json.md`, `test-output/tracker-context-xml.md`, and `test-output/tracker-context-toon.md`; the plain-text transport views live under `test-output/tracker-context-json.txt`, `test-output/tracker-context-xml.txt`, and `test-output/tracker-context-toon.txt`. Running `npm run debug:tracker-context:artifacts` refreshes only the `.txt` files so they stay aligned with the currently verified live behavior: the active text-completion connection path flattens tracker-generation messages into one raw `prompt` string without `System:`, `User:`, or `Assistant:` labels.

Live verification also showed that tracker generation includes character-card prompt content from SillyTavern's `buildPrompt(...)` step by default. You can now disable that input with the tracker-generation setting above when you want extraction to rely more heavily on recent chat state.
