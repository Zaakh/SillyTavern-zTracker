# SillyTavern zTracker

## Overview

A [SillyTavern](https://docs.sillytavern.app/) extension that helps you track your chat stats with LLMs using [connection profiles](https://docs.sillytavern.app/usage/core-concepts/connection-profiles/).

Forked from [SillyTavern WTracker](https://github.com/bmen25124/SillyTavern-WTracker).

## Highlights (since the fork)

- Optional **Sequential generation** (generate trackers in smaller steps).
- **Regenerate only what you need** from the parts menu (one section, one list item like a character, or even one field).
- **Filter World Info used for tracker generation** (allow only selected lorebooks/entries when needed).
- Optional **embed recent tracker snapshots** into normal generations for better continuity (either full JSON or a compact plain-text format).

---

**If you are using a _Text Completion_ profile, make sure your profile contains API, preset, model, and instruct.**

**If you are using a _Chat Completion_ profile; API, settings, model would be enough.**

---

## Installation

Install via the SillyTavern extension installer:

```txt
https://github.com/Zaakh/SillyTavern-zTracker
```

## FAQ

>I'm having API error.

Your API/model might not support structured output. Change `Prompt Engineering` mode from `Native API` to `JSON` or `XML`.

> zTracker UI buttons / schema popup are broken (template 404).

In **Extensions → zTracker**, enable **Debug logging** and use the **Diagnostics** panel (stethoscope button) to print template URL checks to the console. This helps confirm whether SillyTavern can access the extension’s HTML templates.

## Sequential generation & per-part regeneration

In **Extensions → zTracker**, enable **Sequential generation** to have zTracker generate tracker fields one-by-one (smaller, sequential requests).

When a tracker is rendered on a message, use the tracker controls:
- **Regenerate Tracker** (rotate icon) regenerates the whole tracker.
- **Parts menu** (list icon) lets you regenerate an individual top-level field (e.g. `time`, `location`, `topics`) without regenerating everything.

For array parts (e.g. `characters`), the parts menu also exposes:
- Per-item regeneration (by stable identity when available).
- Per-field regeneration inside an item (e.g. regenerate `characters (Silvia).outfit`).

Optional (advanced): you can annotate your JSON schema preset to help zTracker keep interdependent sections ordered and array items stable:
- `x-ztracker-dependsOn`: top-level part ordering hints for sequential generation.
- `x-ztracker-idKey`: which string field to use as the array-item identity for per-item regeneration (defaults to `name`).

## World Info (lorebooks)

In **Extensions → zTracker**, you can control World Info during tracker generation: include all (default), exclude all, or allowlist specific lorebook **book names** (case-insensitive) and/or entry **UIDs** (numbers). This only affects zTracker tracker generation (button / Auto Mode), not normal SillyTavern generations.

In allowlist mode, zTracker loads the allowlisted lorebooks by name and injects their matching entries into the tracker-generation prompt, even if those lorebooks are not currently active in SillyTavern.

When using **Allow only specified books/UIDs**, you can click **Refresh book list** to detect available books, search/select them, and **Add** them to the allowlist (with quick remove buttons). A manual textarea is still available under “Advanced”.

## Embedding tracker snapshots into normal generations

zTracker can optionally embed the last $X$ tracker snapshots into the prompt chat array via its `generate_interceptor` (controlled by **Include Last X zTracker Messages**).

You can also control what **role** those embedded snapshots use (**User**, **System**, or **Assistant**) via **Embed zTracker snapshots as**. This setting only affects embedding; it does not change how zTracker generates trackers.

You can also apply a **regex-based transform** to the embedded snapshot text (for prompt-friendly formatting) via **Embed snapshot transform preset**.

You can customize (or remove) the embedded snapshot header via **Embed snapshot header**.

- **Default (JSON)**: embeds pretty-printed JSON (no changes).
- **Minimal (top-level properties)**: embeds one line per top-level property (newline-separated).


## Versioning

Developer and maintainer notes (local dev, testing, versioning) are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
