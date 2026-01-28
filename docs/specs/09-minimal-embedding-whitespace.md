# Spec: Minify whitespace in minimal embedded tracker snapshots

## Summary
When using the **Minimal (top-level properties)** embedding preset, the embedded snapshot should be compact and easy for an LLM to parse. This spec introduces deterministic formatting rules to:

- Remove superficial whitespace (blank lines, trailing spaces)
- Avoid unnecessary quotes on plain string values
- Wrap object array items in bracketed blocks so item boundaries are unambiguous

## Motivation
- Embedded snapshots are prompt-context payload, so extra whitespace is wasted tokens.
- The minimal preset is meant to be compact; blank lines defeat that goal.
- A stable minification rule allows a regression test with an exact expected string.

## Goals
- Remove *blank* lines from the minimal embedding output.
- Remove trailing whitespace on each line.
- Remove unnecessary quotes around plain string values.
- Wrap array items that are objects into clearly delimited blocks.
- Preserve indentation and line ordering so nested structures remain readable.
- Keep output deterministic and stable for tests.

## Non-goals
- This is not a YAML serializer.
- Do not change quoting/escaping behavior (still uses `JSON.stringify` for scalar values).
- Do not change formatting for non-minimal presets.

## Detailed behavior
Applied only when `embedZTrackerSnapshotTransformPreset === "minimal"`:
1. Normalize line endings: `\r\n` → `\n`.
2. Trim trailing whitespace from every line.
3. Drop lines that are empty after `.trim()`.
4. Ensure the final output ends with exactly one `\n` (unless output is empty).

Additionally, minimal embedding uses a compact scalar formatter:
- Strings are emitted without surrounding quotes by default.
- Strings are quoted (via JSON quoting) only when required (e.g., the value contains a double-quote `"`, is empty, contains newlines, or has leading/trailing whitespace).
- Numbers/booleans/null are emitted as `1`, `true`, `null`.

For arrays:
- Arrays of scalars are rendered as YAML-like bullets (e.g. `- value`).
- Arrays of objects (or nested arrays) are rendered as bracketed blocks:

```
characters:
  [Silvia:
    name: Silvia
    hair: ...
  ]
  [Tobias:
    ...
  ]
```

The label (e.g., `Silvia`) is picked from `name` (preferred), falling back to `id`/`uid`/`key`, then `itemN`.

This happens before any optional regex find/replace preset transform.

## Example
Input (conceptual): a top-level-lines snapshot that contains blank lines between blocks.

Output: the same content with no blank lines, e.g.

```
Tracker:
time: "…"
location: "…"
weather: "…"
topics:
  primaryTopic: "…"
...
```

## Tests
- Update the existing `formatEmbeddedTrackerSnapshot (minimal)` test to use a full tracker example.
- The expected output is the fully minified minimal embedding, and the test writes an artifact to `test-output/embed-snapshot-minimal.txt` for easy visual review.
