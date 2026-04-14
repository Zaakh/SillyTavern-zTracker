---
name: sillytavern-extension-development
description: 'Guidance for building and maintaining SillyTavern UI extensions. Use when changing manifest.json, extension lifecycle hooks, SillyTavern.getContext() integrations, events, prompt interceptors, preset-backed settings, structured generation, upstream compatibility, or SillyTavern smoke-test workflows. Keywords: SillyTavern extension, UI extension, manifest, getContext, generate_interceptor, upstream release compatibility.'
license: MIT
---

# SillyTavern Extension Development

Maintenance: Last reviewed 2026-04-02. Update when SillyTavern extension APIs, supported upstream versions, or common validation and smoke-test practices change.

This skill does the following:
- Guides work that touches SillyTavern UI-extension integration points.
- Keeps changes aligned with the stable host API surface instead of fragile internal imports.
- Captures upstream compatibility boundaries that matter for browser-side extensions.
- Centralizes reusable extension-validation guidance without depending on one repository's build commands.

When to use this skill:
- Creating a new spec file or planning new features.
- Manifest work: `manifest.json`, load order, dependencies, `minimum_client_version`, lifecycle hooks, `generate_interceptor`.
- Runtime integration work: `SillyTavern.getContext()`, settings, chat metadata, character-card fields, preset data, events, prompt assembly, structured generation.
- Upstream compatibility work: SillyTavern version upgrades, extension API changes, macro-engine changes, message-shape changes, release impact review.
- Extension validation workflow: deciding what to test, how to keep logic import-safe, and when to use a live SillyTavern smoke test.

When not to use this skill:
- Generic TypeScript, Jest, React, or webpack work that does not interact with SillyTavern extension behavior.
- Pure UI styling changes that stay inside existing extension boundaries and do not need host-app knowledge.
- Non-SillyTavern repositories.

Steps:
1. Classify the task before editing. Decide whether it is host integration, upstream compatibility, validation workflow, or a combination.
2. If the task touches runtime integration, manifest fields, events, prompt interception, or extension data storage, read [./references/extension-basics.md](./references/extension-basics.md).
3. If the task touches buttons or controls inside the character info/editor panel, read [./references/character-info-panel-buttons.md](./references/character-info-panel-buttons.md).
4. If the task depends on SillyTavern version behavior or may break on upgrade, read [./references/upstream-compatibility.md](./references/upstream-compatibility.md).
5. If the task needs test or smoke-test strategy, read [references/validation-workflow.md](references/validation-workflow.md).
6. Prefer the stable integration surface: use `SillyTavern.getContext()`, shared `SillyTavern.libs`, relative extension imports, and explicit version gates in `manifest.json` when newer APIs are required.
7. Keep extension changes local and reversible. Do not add extension-local policy when SillyTavern already owns the behavior.
8. Validate at the right depth:
   - Use the repository's existing test command after executable source changes.
   - Use the repository's build command after changes that affect shipped extension assets.
   - When behavior depends on the live host, verify against a real SillyTavern instance only after fresh build artifacts exist.
9. Stop and report if the required SillyTavern runtime fact is unclear or if the repository lacks a stable host API for the behavior you need.

Example:

User prompt: "Update a SillyTavern extension to use a new lifecycle hook and make sure the minimum supported client version is correct."

Expected behavior:
1. Read the extension-basics and upstream-compatibility references.
2. Confirm which SillyTavern version introduced the lifecycle hook.
3. Update the manifest and runtime wiring with the smallest host-aware change.
4. Add or update tests where the logic is import-safe.
5. Run the repository's normal validation commands and report any remaining smoke-test risk.

Validation checklist:
- The right reference files were loaded for the task category.
- The change prefers `SillyTavern.getContext()` and avoids unnecessary internal imports.
- Any required compatibility boundary is reflected in `manifest.json`, tests, docs, or both.
- Validation matched the scope of the change.
- No stale references remain to superseded SillyTavern guidance documents.