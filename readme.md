# SillyTavern zTracker

## Overview

A [SillyTavern](https://docs.sillytavern.app/) extension that helps you track your chat stats with LLMs using [connection profiles](https://docs.sillytavern.app/usage/core-concepts/connection-profiles/).

Forked from [SillyTavern WTracker](https://github.com/bmen25124/SillyTavern-WTracker).

![popup](images/overview.png)

---

**You can edit the schema for active chat.**

![modify_for_this_chat](images/modify_for_this_chat.png)

---

![settings](images/settings.gif)

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

> What is the difference compared to [famous tracker](https://github.com/kaldigo/SillyTavern-Tracker)?

Most importantly, it works. This is a minimalistic version of the original tracker.
- No annoying connection profile switch. (This is the reason why I created this extension in the first place.)
- No "Prompt Maker" option. Because JSON schema is easy enough to edit.
- No "Generation Target" option. (Could be added in the future)
- No "Generation Mode" option. Since this extension doesn't summarize the chat, no need for it. (I'm not planning to add a summarize feature.)
- There are some templates in the original, but I don't need them since I don't have those features.

## Versioning

- Canonical version lives in `package.json`; `manifest.json` is derived. Do not edit manifest version manually.
- `npm run sync-version` updates derived files; it runs automatically before dev/build/test and during `npm version`.
- CI can run `npm run check-version` (strict mode) to fail fast on drift without rewriting files.
- Bump versions with `npm version <patch|minor|major>` to keep SemVer tags and changelog aligned.

## Development & testing

Working on the extension locally?

- Install dependencies once with `npm install`.
- Run `npm test` to execute the Jest suite (parser/schema helpers + jsdom render tests).
- For detailed guidance (module structure, mocks, watch mode), see [docs/SILLYTAVERN_DEV_NOTES.md](docs/SILLYTAVERN_DEV_NOTES.md#testing-workflow).
