# Spec: TOON embedding preset for tracker snapshots

Status: Completed
Last updated: 2026-03-18

## Summary

Add TOON ([Token-Oriented Object Notation](https://github.com/toon-format/toon)) as a third built-in embed snapshot transform input mode. TOON is a compact, LLM-optimized encoding of the JSON data model that uses indentation-based nesting (like YAML) and CSV-style tabular arrays for uniform object lists. It achieves ~20-40 % fewer tokens than pretty JSON while maintaining lossless round-trip fidelity.

This spec covers TOON for **embedding only** (one-way encode, prompt input). It explicitly does **not** add TOON as a prompt-engineering output/parsing format.

## Motivation

Embedded tracker snapshots are injected into every normal SillyTavern generation via `generate_interceptor`. They are pure prompt overhead — the model must read them but never produces them. Token cost is directly proportional to snapshot verbosity.

Current embed presets:
- **Default (JSON)**: pretty-printed JSON — verbose, ~4.6 K tokens for a typical dataset.
- **Minimal (top-level properties)**: custom compact format — saves tokens but loses some array structure and is a bespoke format no model was trained on.

TOON sits between the two: it is more compact than JSON (~40 % fewer tokens on tabular data, ~20-30 % on mixed structures) while preserving full JSON data-model fidelity and using a published format with growing LLM familiarity.

### Why TOON works for embedding

- **Input-only**: we call `encode()` to produce a string. No parsing or repair needed.
- **Token-efficient**: TOON's benchmarks show 76.4 % retrieval accuracy (vs JSON's 75.0 %) across 4 models while using ~40 % fewer tokens. This means models understand TOON input at least as well as JSON.
- **Lossless**: `decode(encode(obj))` deep-equals `obj`. No type coercion surprises (unlike YAML's bare `yes`/`no` → boolean gotcha).
- **Tabular arrays**: tracker schemas typically contain `characters: [{name, outfit, mood, ...}]` — exactly the uniform-array-of-objects pattern where TOON's tabular layout excels.
- **Mature library**: `@toon-format/toon` (TypeScript, MIT, spec v3, 23 K stars, actively maintained).

### Why NOT as a generation/output format

- TOON's own benchmarks only test *reading*, not *generating* TOON. Models are not trained on producing it.
- Tabular rows are positionally delimited — a model that skips or swaps a field causes a *silent data-correctness error*, not a parse failure.
- No viable repair strategy: unlike JSON's balanced-brace extraction, misplaced commas in a TOON table silently shift all downstream fields.
- Mixed-structure token savings over JSON compact are marginal (+5 % to +20 % *more* tokens in TOON's own benchmarks).

## Goals

- Add a new embed snapshot transform input type `toon` alongside `pretty_json` and `top_level_lines`.
- Ship a built-in preset named **TOON (compact)** that uses this input type.
- The new preset must be selectable from the existing embed transform UI with no additional UI work.
- No changes to generation, parsing, or tracker storage.

## Non-goals

- Adding TOON as a prompt-engineering output mode (no `PromptEngineeringMode.TOON`).
- Replacing the existing `default` or `minimal` presets; this is an additive change.
- Migrating existing users to the new preset; default remains `Default (JSON)`.
- Supporting TOON decode/parsing anywhere in zTracker.

## Codebase verification

> This section maps the change against existing code to confirm feasibility and scope.

### Dependency

| Item | Current | Change |
|------|---------|--------|
| `package.json` dependencies | `fast-xml-parser`, `handlebars`, `sillytavern-utils-lib` | Add `@toon-format/toon` |

The library is TypeScript-native, ESM-compatible, and tree-shakeable. Only `encode` is needed — the rest can be excluded by the bundler.

### Config (`src/config.ts`)

| Item | Current | Change |
|------|---------|--------|
| `EmbedSnapshotTransformInput` | `'pretty_json' \| 'top_level_lines'` | Add `'toon'` to the union |
| `defaultSettings.embedZTrackerSnapshotTransformPresets` | `{ default, minimal }` | Add `toon` preset entry |

New preset definition:
```ts
toon: {
  name: 'TOON (compact)',
  input: 'toon',
  pattern: '',
  flags: 'g',
  replacement: '',
  codeFenceLang: 'toon',
  wrapInCodeFence: true,
},
```

### Transform logic (`src/embed-snapshot-transform.ts`)

The `formatEmbeddedTrackerSnapshot()` function currently selects base text via:
```ts
const baseText =
  input === 'top_level_lines'
    ? (presetKey === 'minimal' ? buildTopLevelLinesForEmbedding(trackerValue) : buildTopLevelLines(trackerValue))
    : JSON.stringify(trackerValue ?? {}, null, 2);
```

Implemented branch:
```ts
import { encode } from '@toon-format/toon';

function normalizeToPlainJsonValue(value: unknown): unknown {
  const serialized = JSON.stringify(value ?? null);
  return serialized === undefined ? null : JSON.parse(serialized);
}

// in formatEmbeddedTrackerSnapshot:
let baseText: string;
switch (input) {
  case 'toon':
    baseText = encode(normalizeToPlainJsonValue(trackerValue ?? {}), { delimiter: '\t' });
    break;
  case 'top_level_lines':
    baseText = presetKey === 'minimal'
      ? buildTopLevelLinesForEmbedding(trackerValue)
      : buildTopLevelLines(trackerValue);
    break;
  default: // 'pretty_json'
    baseText = JSON.stringify(trackerValue ?? {}, null, 2);
    break;
}
```

No other files in the transform pipeline need changes — the regex post-processing, code fence wrapping, and header prepending all operate on the resulting string and are format-agnostic.

### Settings UI (`src/components/settings/EmbedSnapshotTransformSection.tsx`)

The "Transform input" dropdown currently has two options:
```tsx
<option value="pretty_json">Pretty JSON</option>
<option value="top_level_lines">Top-level lines</option>
```

Change: add a third option:
```tsx
<option value="toon">TOON (compact)</option>
```

### Injection path (`src/tracker.ts` → `includeZTrackerMessages`)

No changes. `includeZTrackerMessages` already calls `formatEmbeddedTrackerSnapshot()` and assembles the result into a message string. The TOON output is just another string — the injection path is format-agnostic.

### Webpack (`webpack.config.cjs`)

Verify `@toon-format/toon` is bundled correctly. The library is ESM + TS-native, which aligns with the existing webpack + ts-loader pipeline. No special loader should be required.

### Settings migration

Review finding: the original assumption above was wrong. Existing users **do** receive the new `toon` preset automatically because zTracker initializes settings with `ExtensionSettingsManager.initializeSettings()` using the default recursive merge strategy, which fills in missing nested keys from `defaultSettings`.

That means adding `embedZTrackerSnapshotTransformPresets.toon` is an additive persisted-settings change on startup even without a `formatVersion` bump. No explicit migration code is required, but the effect is still observable for existing installs and should be documented accurately.

### Bundle size impact

`@toon-format/toon` is ~15-25 KB minified. The `encode` function and its dependencies are tree-shakeable. Since `decode` is not imported, unused serialization paths should be eliminated. Verify actual bundle size delta after implementation.

## Example output

Given the test fixture used in `embed-snapshot-transform.test.ts`:

```json
{
  "time": "14:32:05; 09/27/2025 (Saturday)",
  "location": "Cozy downtown bar interior",
  "weather": "Warm indoor, 72°F, no precipitation",
  "topics": { "primaryTopic": "Water request", "emotionalTone": "Calm", "interactionTheme": "Customer-service" },
  "charactersPresent": ["Silvia", "Jeff"],
  "characters": [
    { "name": "Silvia", "hair": "Long auburn hair, neatly tied back", "makeup": "Light natural makeup", "outfit": "Black apron over a white button-down shirt, dark slacks, black shoes", "stateOfDress": "Professional and tidy", "postureAndInteraction": "..." },
    { "name": "Jeff", "hair": "Violet flames looking like hair", "makeup": "None", "outfit": "Jeff is a flaming elemental, he has not clothing but i clad in red flames", "stateOfDress": "Clad in flames.", "postureAndInteraction": "Sitting on a bar stool a few seats away." }
  ]
}
```

Expected TOON output (approximate — exact output depends on the library):
```toon
time: 14:32:05; 09/27/2025 (Saturday)
location: Cozy downtown bar interior
weather: Warm indoor, 72°F, no precipitation
topics:
  primaryTopic: Water request
  emotionalTone: Calm
  interactionTheme: Customer-service
charactersPresent[2]: Silvia,Jeff
characters[2]{name,hair,makeup,outfit,stateOfDress,postureAndInteraction}:
  Silvia,Long auburn hair, neatly tied back,Light natural makeup,Black apron over a white button-down shirt, dark slacks, black shoes,Professional and tidy,...
  Jeff,Violet flames looking like hair,None,Jeff is a flaming elemental, he has not clothing but i clad in red flames,Clad in flames.,Sitting on a bar stool a few seats away.
```

Key observations:
- `topics` (nested object) uses indentation — compact, readable.
- `charactersPresent` (scalar array) collapses to a single line.
- `characters` (uniform array of objects) becomes a table with `[2]{fields}:` header and one row per character — this is where the major token savings come from.

Implemented choice: use a tab delimiter (`'\t'`) for TOON output. This avoids ambiguity for comma-heavy tracker strings and was verified by round-trip tests covering commas, newlines, brackets, pipes, and tabs.

## Tests

### Unit tests (`src/__tests__/embed-snapshot-transform.test.ts`)

1. **TOON preset produces valid output**: call `formatEmbeddedTrackerSnapshot()` with the TOON preset and the existing test fixture. Assert:
   - `lang === 'toon'`
   - `wrapInCodeFence === true`
   - `text` is a non-empty string
   - `text` does not start with `{` (not raw JSON). Note: TOON *does* use `{fields}` in tabular headers, so a blanket "no braces" check is wrong.
2. **Round-trip fidelity**: `decode(encode(trackerValue))` deep-equals `trackerValue`. Import `decode` from `@toon-format/toon` in the test only.
3. **Token savings assertion** (optional, informational): count characters (as a proxy for tokens) and assert TOON output is shorter than JSON for the same fixture.
4. **Write artifact**: write the TOON output to `test-output/embed-snapshot-toon.txt` for visual review (same pattern as the minimal test).

### Integration test (`src/__tests__/tracker-include.test.ts`)

5. **Injection with TOON preset**: extend the existing `'can apply a minimal formatting preset during embedding'` pattern. Create a settings object with TOON preset selected, call `includeZTrackerMessages()`, and verify:
   - Injected message content contains the header (`Tracker:`)
   - Content is wrapped in `` ```toon `` fences
   - Content does not start with `{` (not raw JSON)

### Edge cases to cover

6. **Empty tracker object**: `encode({})` should produce a valid (possibly empty) TOON string without throwing.
7. **Deeply nested schema**: tracker data with 3+ nesting levels should encode without error. Token savings may be marginal here (which is expected and documented by TOON's own benchmarks).
8. **Values containing commas and special chars**: verify the library's delimiter handling preserves values that contain commas, colons, brackets, or newlines.

## Codebase change map

| File | Change |
|------|--------|
| `package.json` | Add `@toon-format/toon` to `dependencies`. |
| `src/config.ts` | Extend `EmbedSnapshotTransformInput` union with `'toon'`. Add `toon` preset to `defaultSettings`. |
| `src/embed-snapshot-transform.ts` | Import `encode` from `@toon-format/toon`. Add `case 'toon'` branch in `formatEmbeddedTrackerSnapshot()`. |
| `src/components/settings/EmbedSnapshotTransformSection.tsx` | Add `<option value="toon">TOON (compact)</option>` to the transform input dropdown. |
| `src/__tests__/embed-snapshot-transform.test.ts` | Add TOON preset tests (output format, round-trip, artifact file). |
| `src/__tests__/tracker-include.test.ts` | Add TOON injection integration test. |
| `CHANGELOG.md` | Add entry under `Unreleased`. |
| `readme.md` | Add bullet for TOON preset under "Embedding tracker snapshots" section. |

## Resolved notes

1. **Delimiter choice**: resolved. The implementation uses tab-delimited TOON (`delimiter: '\t'`) because tracker values frequently contain commas in outfit/location text.
2. **Cloned tracker values**: resolved. `includeZTrackerMessages()` clones messages via `structuredClone()`, and the TOON encoder treated those cloned tracker objects as non-JSON input. The implementation normalizes tracker values through `JSON.stringify()` / `JSON.parse()` before TOON encoding.
3. **Bundle size**: verified. After `npm run build`, `dist/index.js` grew from `510005` bytes at `HEAD` to `535071` bytes (`+25066` bytes).
4. **Settings merge behavior**: corrected after review. Existing installs automatically gain the built-in `toon` preset because missing nested default settings are recursively merged at startup.
5. **Parser architecture follow-up**: completed separately from the embed feature. Structured reply repair now lives behind a shared parser workflow with format-specific JSON, XML, and TOON modules, which keeps `src/parser.ts` as a small entrypoint instead of a monolithic mixed-logic file.
6. **Spec stability**: still acceptable for the original feature. zTracker only encodes TOON for prompt input in the embed flow; the parser-side TOON/XML repair workflow is supporting infrastructure rather than a change to the embed preset itself.

## Acceptance criteria

- [x] `EmbedSnapshotTransformInput` type includes `'toon'`.
- [x] A built-in `toon` preset appears in `defaultSettings`.
- [x] Selecting the TOON preset in the UI produces TOON-formatted embedded snapshots.
- [x] `encode(trackerData)` output is valid TOON that round-trips losslessly via `decode()`.
- [x] Tracker values containing commas, colons, newlines, and brackets encode without data loss.
- [x] Existing `default` and `minimal` presets are unchanged.
- [x] `npm test` passes with new test coverage.
- [x] `npm run build` succeeds; bundle size delta is documented.
- [x] `CHANGELOG.md` and `readme.md` are updated.

## Tasks checklist

- [x] Install `@toon-format/toon` and verify it builds with webpack
- [x] Extend `EmbedSnapshotTransformInput` type in `src/config.ts`
- [x] Add `toon` preset to `defaultSettings` in `src/config.ts`
- [x] Add `case 'toon'` branch in `src/embed-snapshot-transform.ts`
- [x] Add `<option value="toon">` in `src/components/settings/EmbedSnapshotTransformSection.tsx`
- [x] Write unit tests for TOON embedding
- [x] Write integration test for TOON injection
- [x] Verify round-trip fidelity and comma/special-char handling
- [x] Update `CHANGELOG.md`
- [x] Update `readme.md`
- [ ] Manual smoke test in SillyTavern UI

## Verification

- `npm test`
  - 13 test suites passed, 74 tests passed.
  - New coverage verifies TOON formatting, round-trip decode fidelity, tracker snapshot injection behavior, and shared JSON/XML/TOON repair behavior.
- `npm run build`
  - Production build completed successfully.
  - `dist/index.js` size changed from `510005` bytes at `HEAD` to `551608` bytes after the follow-up parser work.
- Manual SillyTavern smoke test was not run in this change.

## Recommended next steps

1. TOON is now wired as a selectable prompt-engineering reply mode in settings, so keep future structured-output additions on the same shared `PromptEngineeringMode` plus `parseResponse(...)` path instead of creating format-specific side flows.
2. Keep repair heuristics sample-driven. Only add new JSON/XML/TOON repair steps from captured malformed model replies, so recovery stays conservative and diagnosable.
3. Add a manual or Playwright smoke test for malformed reply handling in end-to-end tracker generation flows, not just parser unit tests.
