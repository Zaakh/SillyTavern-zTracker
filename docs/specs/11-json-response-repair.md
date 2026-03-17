# Spec: Tolerant JSON response repair for tracker generation

Status: Open
Last updated: 2026-03-17

## Summary

Add a narrowly scoped JSON repair layer to zTracker's response parsing so tracker generation can recover from minor, common model output defects instead of failing immediately.

Today `parseResponse()` in `src/parser.ts` extracts fenced content and then calls `JSON.parse()` directly. That is intentionally strict, but in live usage models still sometimes return output that is semantically correct and close to valid JSON while containing small formatting defects. The most recent live smoke test reproduced one such case: the tracker request used the correct saved `zTracker` system prompt, but the model response still failed parsing because it returned fenced JSON where the inner payload was not accepted as-is by the parser path.

This spec adds a repair pipeline for JSON only. The repair step runs before the final parse attempt and is limited to small, deterministic cleanup operations. It must not silently rewrite materially incorrect payloads.

## Motivation

Tracker generation is only useful if the extension can tolerate minor model formatting drift. Smaller and instruction-following models often produce near-valid JSON with issues like:

- extra prose before or after the JSON object
- repeated or nested markdown fences
- trailing commas
- smart quotes copied from prose formatting
- JSON wrapped in a top-level explanation like `Here is the JSON:`
- accidental leading BOM or zero-width whitespace

These cases do not represent a logical failure in tracker generation. They are parser-adjacent formatting issues, and rejecting them outright creates unnecessary user-visible failures.

At the same time, zTracker should remain strict enough to avoid masking genuine model failures. A repair layer should recover only from small, well-understood defects and should preserve observability when repair is needed.

## Goals

- Recover automatically from minor, deterministic JSON formatting defects.
- Keep the repair logic local to the parser path used by tracker generation.
- Preserve current strict behavior for clearly invalid or semantically broken responses.
- Log when repair was needed so troubleshooting remains possible.
- Keep the implementation dependency-light; prefer simple local logic over heavyweight or unsafe parsers unless a library is clearly justified.

## Non-goals

- General natural-language-to-JSON conversion.
- Repairing responses that are missing required schema structure or inventing fields.
- Repairing XML responses in this change.
- Replacing schema validation or downstream render validation.
- Silently accepting malformed JSON without any trace in logs.

## Current behavior (baseline)

### Parsing path

1. Tracker generation receives model output in `src/ui/tracker-actions.ts`.
2. For prompt-engineered JSON mode, it calls `parseResponse(rest.content, 'json', { schema })`.
3. `parseResponse()` in `src/parser.ts`:
   - extracts the first fenced code block when present
   - trims the extracted or raw content
   - calls `JSON.parse(cleanedContent)`
4. Any `SyntaxError` becomes `Model response is not valid JSON.`

### What this means

- zTracker already tolerates one common case: a single fenced code block.
- zTracker does **not** tolerate any other minor JSON defect.
- Near-valid model output can still fail generation even when the logical tracker data is present.

## Detailed design

### New repair flow

For `format === 'json'`, replace the current one-shot parse with a staged strategy:

1. **Initial strict parse attempt**
   - Keep the current behavior first.
   - If `JSON.parse(cleanedContent)` succeeds, return immediately.

2. **Deterministic cleanup pipeline**
   - If strict parsing fails, run a sequence of repair attempts on a working copy of the content.
   - After each successful transformation stage, attempt `JSON.parse()` again.
   - Stop at the first successful parse.

3. **Failure with context**
   - If all repair attempts fail, keep the current user-facing error (`Model response is not valid JSON.`).
   - Log which repair steps were attempted.

### Allowed repair operations

The repair pipeline may apply only operations from this list:

1. **Whitespace normalization**
   - trim BOM, zero-width characters, and leading/trailing whitespace

2. **Fence cleanup**
   - remove nested or repeated markdown fences when the payload is otherwise JSON
   - tolerate language labels like `json`, `JSON`, or empty fence labels

3. **JSON substring extraction**
   - if the content contains extra prose, extract the outermost balanced `{...}` or `[...]` block
   - extraction must be bracket-balanced and deterministic

4. **Smart quote normalization**
   - normalize typographic quotes to ASCII `"` only when they appear in places that would otherwise make JSON invalid

5. **Trailing comma removal**
   - remove commas directly before `}` or `]`

6. **Line-ending normalization**
   - normalize `\r\n`/`\r` to `\n`

### Explicitly forbidden repair operations

These must not be done automatically:

- inventing missing braces or brackets when balance cannot be proven
- adding missing quotes around arbitrary object keys
- converting single-quoted pseudo-JSON into JSON wholesale
- guessing missing commas between properties
- coercing invalid scalar values based on schema guesses
- filling missing required fields

If a response requires any of the above, it should still fail.

### Logging / diagnostics

When repair succeeds after the initial parse failed:

- log a debug/info-level message describing the applied repair steps
- optionally log the original and repaired content lengths, not the full payload by default
- keep the existing error logging path unchanged when repair ultimately fails

This helps distinguish prompt-quality issues from parser-quality issues during troubleshooting.

### API shape

Possible internal helper structure in `src/parser.ts`:

```ts
function tryParseJsonWithRepair(content: string): object
function extractBalancedJsonSubstring(content: string): string | undefined
function repairJsonCandidate(content: string): { candidate: string; appliedSteps: string[] }
```

`parseResponse()` remains the public entry point. The repair logic stays internal.

### Safety constraints

- Repairs must be deterministic and side-effect-free.
- If a repaired payload parses successfully, it should still be treated exactly like a normal JSON parse result.
- Downstream schema-specific failures remain downstream failures; repair does not bypass them.

## Alternatives considered

### A. Keep strict parsing only

Pros:
- simplest behavior
- no risk of over-repair

Cons:
- unnecessary failures for near-valid model output
- poor UX for small or inconsistent models

Rejected because the live smoke test already demonstrated a real, user-facing failure in this category.

### B. Add a permissive JSON5/loose parser

Pros:
- less custom code
- may recover from more formatting issues

Cons:
- broadens accepted syntax more than needed
- risks hiding model failures behind overly permissive parsing
- may parse content that is not actually valid JSON by zTracker's contract

Not preferred by default. A dedicated library is only justified if the local deterministic repair path becomes too complex.

### C. Ask the model to self-repair on parse failure

Pros:
- can recover from larger defects

Cons:
- adds latency and cost
- creates another generation path to maintain
- introduces nondeterminism

Rejected for this change. Local repair should be attempted first.

## Codebase change map

| File | Change |
|------|--------|
| `src/parser.ts` | Add staged JSON repair helpers and logging. |
| `src/__tests__/parser.test.ts` | Add coverage for accepted repair cases and forbidden/non-repairable cases. |
| `CHANGELOG.md` | Add entry when implemented. |
| `readme.md` | Optional brief note if the behavior is user-visible enough to document. |

## Acceptance criteria

- [ ] Strict valid JSON still parses exactly as before.
- [ ] Fenced JSON still parses as before.
- [ ] Responses with extra leading/trailing prose can be recovered when a balanced JSON object/array is present.
- [ ] Responses with trailing commas before `}` or `]` are repaired and parsed.
- [ ] Responses containing typographic quotes in otherwise valid JSON strings are repaired and parsed.
- [ ] Clearly malformed pseudo-JSON still fails with `Model response is not valid JSON.`
- [ ] Repair attempts are logged when repair was necessary.
- [ ] Existing XML behavior is unchanged.

## Tasks checklist

- [ ] Design the ordered repair pipeline in `src/parser.ts`
- [ ] Implement balanced JSON substring extraction
- [ ] Implement deterministic cleanup steps
- [ ] Add parser tests for each accepted repair case
- [ ] Add negative tests for forbidden repair cases
- [ ] Update changelog if implemented

## Verification plan

- Unit tests in `src/__tests__/parser.test.ts` covering:
  - valid JSON
  - fenced JSON
  - extra prose + balanced JSON extraction
  - trailing comma cleanup
  - smart quote normalization
  - non-repairable malformed JSON
- Manual smoke test in SillyTavern using a model/output combination that previously returned near-valid JSON
