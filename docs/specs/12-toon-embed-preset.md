# Spec: TOON embedding preset for tracker snapshots

Status: Completed
Last updated: 2026-03-20

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
3. **Bundle size**: verified. After `npm run build`, `dist/index.js` grew from `510005` bytes on `main` to `554030` bytes on this branch (`+44025` bytes).
4. **Settings merge behavior**: corrected after review. Existing installs automatically gain the built-in `toon` preset because missing nested default settings are recursively merged at startup.
5. **Parser architecture follow-up**: completed separately from the embed feature. Structured reply repair now lives behind a shared parser workflow with format-specific JSON, XML, and TOON modules, which keeps `src/parser.ts` as a small entrypoint instead of a monolithic mixed-logic file.
6. **Spec stability**: still acceptable for the original feature. zTracker only encodes TOON for prompt input in the embed flow; the parser-side TOON/XML repair workflow is supporting infrastructure rather than a change to the embed preset itself.

## 2026-03-20 live smoke follow-up

### Smoke plan executed

The live SillyTavern follow-up focused on the `Bar` chat with the existing Tobias tracker and covered:
- JSON prompt-engineering regeneration with the versioned saved prompt preset `zTracker-1.2.1`
- XML prompt-engineering regeneration with the same preset, including capture of the outgoing prompt and raw model reply
- TOON prompt-engineering regeneration with the same preset, including capture of the outgoing prompt and raw model reply
- validation that malformed live replies were either repairable by conservative parser steps or still rejected when they would require unsafe inference
- validation that dependent tracker arrays now surface warnings when a source array item is missing its corresponding detail entry

### Live findings

1. JSON prompt-engineering succeeded end-to-end in the live `Bar` chat. The outgoing request used the saved `zTracker-1.2.1` system prompt and the model returned valid fenced JSON.
2. XML prompt-engineering exposed two separate issues:
  - the saved XML prompt template in settings still wrapped `{{schema}}` inside `<schema>...</schema>`, which duplicated the schema wrapper when paired with the earlier XML prompt-schema renderer
  - the model returned a repairable malformed XML reply where the first `<time>` opening bracket was missing (`time>...`)
3. TOON prompt-engineering exposed a new repairable model failure mode: a single-item array of objects was emitted as a block (`characters[1]{ ... }`) instead of the tabular TOON row form expected by the decoder.
4. The earlier hard failure where JSON was wrapped in a `toon` fence remains intentionally rejected; that shape is still too far from valid TOON to repair safely.
5. After the code changes and rebuild in this session, automated validation passed (`npm test`, `npm run build`). A second full live regeneration pass after the final migration matcher change was not completed in-session because the refreshed SillyTavern page returned to its startup assistant state instead of restoring the `Bar` chat directly.

### Fixes implemented from this smoke pass

- XML prompt-schema rendering now emits the canonical schema description without adding its own outer `<schema>` wrapper.
- XML prompt-template migration now upgrades both the old JSON-based XML template and the previously shipped XML-wrapper template to the current default.
- XML parsing now rejects text-only parses and repairs the specific missing-opening-bracket shape observed in the live smoke test.
- TOON parsing now repairs the live single-item object-array block form by converting it into the canonical tabular TOON row format before decoding.
- `applyTrackerUpdateAndRender()` now logs `zTracker: dependent array mismatch` warnings when a detail array such as `characters` is missing entries declared by its dependency array such as `charactersPresent`.
- Regression fixtures and tests were added for the live malformed XML and TOON replies.

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
- [x] Manual smoke test in SillyTavern UI

## Verification

- `npm test`
  - 16 test suites passed, 88 tests passed.
  - Coverage now also verifies prompt-time schema translation for XML and TOON, versioned saved system-prompt installation behavior, and migration of legacy XML/TOON prompt templates stored in extension settings.
- Additional fixture-backed repair tests now cover separate chat-like malformed JSON, XML, and TOON replies, plus the real smoke-test failure where a model returned JSON inside a `toon` fence.
- `npm run build`
  - Production build completed successfully.
  - `dist/index.js` size changed from `510005` bytes on `main` to `558398` bytes on this branch.
  - Webpack performance warnings are now disabled for production builds because this extension intentionally ships as a single local bundle and the default web-app thresholds were producing noisy, non-actionable warnings.
- Manual SillyTavern smoke test was run against the `Bar` chat in a live SillyTavern instance.
  - zTracker prompt-engineering mode was switched to TOON successfully.
  - Tracker regeneration failed because the model returned JSON wrapped in a `toon` fence instead of valid TOON.
  - The captured prompt, malformed reply shape, and existing tracker context were converted into dedicated parser repair fixtures for unit and future e2e coverage.
  - After the root-cause fix was implemented, a second live verification attempt showed that the running SillyTavern instance was still serving an older `dist/index.js` from `/scripts/extensions/third-party/SillyTavern-zTracker/dist/index.js`.
  - The served bundle still contained the old `**JSON SCHEMA TO FOLLOW:**` XML/TOON templates and the old saved prompt name `zTracker`, while the workspace build already contained `XML SCHEMA DESCRIPTION TO FOLLOW`, `TOON SCHEMA DESCRIPTION TO FOLLOW`, and the versioned preset name. The code fix is built and tested locally, but the live smoke re-check remains blocked until SillyTavern reloads the current extension bundle.

## Recommended next steps

1. TOON is now wired as a selectable prompt-engineering reply mode in settings, so keep future structured-output additions on the same shared `PromptEngineeringMode` plus `parseResponse(...)` path instead of creating format-specific side flows.
2. Keep repair heuristics sample-driven. Only add new JSON/XML/TOON repair steps from captured malformed model replies, so recovery stays conservative and diagnosable.
3. Add a manual or Playwright smoke test for malformed reply handling in end-to-end tracker generation flows, not just parser unit tests.

## Review follow-up (2026-03-20)

- Added a TOON prompt template editor and reset action to `Settings.tsx`, matching the existing JSON/XML prompt controls.
- Fixed the prompt-mode dropdown indentation and refreshed the embed-transform input JSDoc to document the `toon` mode.
- Moved schema-based array coercion into the shared parse flow so TOON prompt-engineered replies now normalize singleton arrays the same way XML replies do.
- Tightened code-fence extraction so inline triple-backtick text inside scalar values does not truncate fenced parser content.
- Added coverage for nested TOON schema examples, TOON schema-based array normalization, strict TOON scalar spacing, and fenced JSON values that contain literal triple backticks.
- zTracker now keeps one canonical JSON schema in settings and translates it into XML or TOON only when building the corresponding prompt-engineering request.
- The shared zTracker system prompt is now format-agnostic, and the shipped saved prompt preset name is versioned (for example `zTracker-1.2.1`) so older saved prompts can coexist without being overwritten.
- Existing XML/TOON prompt templates stored in extension settings are migrated only when they still match the old built-in defaults, so users get the schema-translation fix without losing custom prompt edits.

## Historical critical review (2026-03-20)

### Strengths

- **Excellent deduplication in `tracker-actions.ts`**: the `requestPromptEngineeredResponse()` extraction eliminated seven copy-pasted 10-line blocks, reducing ~70 lines of duplicated template-compile → request → parse logic to a single reusable function. This is the most impactful change in the branch.
- **Clean parser decomposition**: splitting `src/parser.ts` (318 lines) into `parser/json.ts`, `parser/xml.ts`, `parser/toon.ts`, and `parser/shared.ts` with a shared `runRepairWorkflow<T>()` is well-structured. The generic step-name type parameter prevents typos and keeps each format's repair pipeline self-documenting.
- **TOON repair is conservative and well-guarded**: `parseAfterEachStep: false` ensures all repair transforms are applied before attempting a parse; `hasSuspiciousToonKeys()` post-validation catches silent data-corruption from bad delimiter normalization. This directly addresses the spec's "no viable repair strategy" concern.
- **Round-trip fidelity is tested**: the embed-snapshot test actually calls `decode(text)` and `expect(decoded).toEqual(toonTrackerValue)` — this proves lossless encode/decode, not just "looks plausible." The test fixture includes commas, colons, newlines, tabs, brackets, and pipes.
- **Test count increased from 74 to 76**: new coverage includes TOON embed, TOON injection, TOON parsing, TOON repair, TOON failure mode, XML repair, and TOON schema example. All 13 suites pass.
- **Tracker actions test for TOON mode** verifies the full prompt-engineering path: schema → example generation → template compilation → request → parse → render.

### Critical issues

#### High priority

1. **Committed `dist/index.js` is stale** (spec section "Verification" reports `551608` bytes, but the committed artifact is `553211` bytes, and a fresh `npm run build` matches the committed file). The spec's stated verify size contradicts the actual committed file. This is a documentation inaccuracy rather than a code bug — the committed build is current and matches the source. **Action**: update the "Verification" section with the correct figure (`553211` bytes).

2. **`promptToon` has no editing UI**: `promptJson` and `promptXml` both have editable `<textarea>` elements and "Reset to default" buttons in `Settings.tsx`. The new `promptToon` setting is stored and used but has no corresponding UI element — users cannot view, edit, or reset the TOON prompt template from the settings panel. **Action**: add a TOON prompt textarea + reset button in `Settings.tsx`, matching the JSON/XML pattern. Alternatively, document this as an intentional limitation if user editing is not desired.

3. **Settings.tsx indentation defect**: the TOON option has wrong indentation (14 extra leading spaces):
   ```tsx
                                 <option value="toon">Prompt Engineering (TOON)</option>
   ```
   Should be:
   ```tsx
                   <option value="toon">Prompt Engineering (TOON)</option>
   ```
   This doesn't affect runtime behavior but violates code style and makes diffs noisy. **Action**: fix the indentation.

#### Medium priority

4. **JSDoc for `EmbedSnapshotRegexTransformPreset.input` is outdated**: the comment lists only `pretty_json` and `top_level_lines` but the union now includes `'toon'`. **Action**: add `- toon: tab-delimited TOON via @toon-format/toon encode()` to the JSDoc list.

5. **Missing trailing newlines in all four `src/parser/*.ts` files**: `json.ts`, `shared.ts`, `toon.ts`, and `xml.ts` all lack a final newline. This is a POSIX convention violation that can cause git diff noise and some editors to warn. **Action**: add a trailing newline to each file.

6. **`isAcceptableXmlParse` has an unused `candidate` parameter**: the function signature accepts `(parsed: object, candidate: string)` but never uses `candidate`. This was introduced because the `acceptParsedResult` callback signature requires two arguments, but it creates dead code. **Action**: the unused parameter exists to match the `RepairWorkflowOptions.acceptParsedResult` callback signature. Consider prefixing with `_` (i.e. `_candidate`) to signal intent, or restructure the callback type to make the second argument optional.

7. **TOON `schema` option is passed but ignored in parsing**: `requestPromptEngineeredResponse()` calls `parseResponse(content, format, { schema })`, and for XML this triggers `ensureArray()` coercion. For TOON, the schema is passed through but `tryParseToonWithRepair()` silently ignores it. If a model returns a single-element array as a bare object in TOON output, it won't be coerced to an array the way XML does. **Action**: either add `ensureArray()` post-processing for TOON in `parser.ts` (same as XML), or document this as intentional because TOON's tabular format structurally preserves arrays.

#### Low priority

8. **`RepairWorkflowOptions` interface is exported but not used outside `shared.ts`**: it's declared as a standalone interface but only referenced as an inline property type within `runRepairWorkflow()`. **Action**: minor, can remain exported for future extensibility, but could be inlined for minimalism.

9. **`CODE_BLOCK_REGEX` uses non-greedy match on inner content**: `([\s\S]*?)` will match the *first* ` ``` ` closing fence. If a model outputs a TOON table containing literal ` ``` ` inside a value (unlikely for tracker data but theoretically possible), extraction would truncate. The JSON repair has `extractBalancedJsonSubstring` as a fallback; TOON has no equivalent. **Action**: acceptable risk for current use, but worth noting as a known limitation.

10. **Bundle size warning**: webpack now reports a 540 KiB entrypoint, exceeding the 244 KiB recommended limit. The `@toon-format/toon` addition contributed ~25-43 KB to an already large bundle. **Action**: not a blocker for this feature, but the overall bundle size should be monitored. Consider tree-shaking or lazy loading in a future optimization pass.

### Missing considerations

- **No test for `schemaToExample` with deeply nested TOON schemas**: the test only checks a simple schema with `title`, `tags[]`, `meta.count`. A schema with 3+ nesting levels or mixed array types (array-of-arrays) would exercise more edge cases in TOON encoding.
- **No test for `requestPromptEngineeredResponse` suffix parameter with TOON**: the `suffix` parameter (used for `preserveLine` continuation prompts) is only tested implicitly via the existing JSON/XML paths. A TOON-specific test with suffix could verify the prompt is assembled correctly.
- **TOON `normalizeToonTabularDelimiters` may false-positive on non-tabular content**: the regex `/ {2,}/` treats any 2+ spaces as a potential delimiter. If a TOON scalar value legitimately contains consecutive spaces (e.g., `"outfit: Red   dress"`), the repair step would incorrectly split it. The `isAcceptableToonParse` guard mitigates this: if repair produces suspicious keys, the original content falls through to failure. But a test exercising this specific case would strengthen confidence.
- **XML error path changed**: the old code checked `error.message.includes('Invalid XML')` before throwing. The new code throws `'Model response is not valid XML.'` unconditionally for the XML format. This is arguably correct (all XML parse failures should report as invalid XML), but it changes observable error behavior. Any downstream code relying on a `fast-xml-parser`-specific error message in the rethrown error will now see the generic message instead.

### Recommendations

1. **Fix the three high-priority issues** (stale size in spec, missing prompt UI or documentation, indentation) before merging.
2. **Add trailing newlines** to the four `src/parser/*.ts` files — this is a one-line fix per file.
3. **Update the `input` JSDoc** in `config.ts` to include `toon`.
4. **Consider `ensureArray()` for TOON**: if the model can return single-element arrays as bare objects in TOON format, the same coercion applied to XML should apply to TOON. If TOON structurally prevents this, document that rationale.
5. **Add `_` prefix** to the unused `candidate` parameter in `isAcceptableXmlParse`.

### Overall assessment

**Adequate** — the feature implementation is sound, well-tested (76 tests passing), and the parser refactor is a clear improvement. The branch is near production-ready. The missing TOON prompt editing UI is the most impactful gap — without it, users who want to customize the TOON prompt template must manually edit persisted settings, which is inconsistent with how JSON/XML prompts work. The indentation defect and stale verification figures are minor fixable issues. No security concerns, no logic errors in the core encode/parse paths.
