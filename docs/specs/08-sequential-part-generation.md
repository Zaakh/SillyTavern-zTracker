# Spec: Sequential per-part tracker generation

Status: Completed
Last updated: 2026-01-26

## Goal
Allow zTracker to generate a tracker **in parts**, sequentially (one part after another), and provide UI controls to **regenerate individual parts** for a given chat message.

This is intended to:
- Reduce failure blast-radius (if one part fails, others can still update)
- Improve responsiveness (smaller outputs, faster retries)
- Make targeted edits/regeneration possible without redoing the full tracker

## Background / current behavior

### Storage
For each message, zTracker currently stores:
- `message.extra[EXTENSION_KEY].value`: the full tracker data object
- `message.extra[EXTENSION_KEY].html`: the full tracker HTML template (from schema preset)

### Generation
UI actions call `generateTracker(messageId)` which:
- Builds a prompt from recent chat
- Injects prior zTracker snapshots (optional)
- Requests **the full tracker schema** (native JSON Schema output or prompt-engineered JSON/XML)
- Parses the response into a full tracker object
- Saves and renders it (with strict Handlebars rendering)

### Rendering constraints
Rendering uses Handlebars with `{ strict: true }`. If the template references a missing field, rendering throws.
This means “partial” tracker objects can easily fail to render.

## Definitions

### “Part”
A **part** is a named slice of the tracker data, typically a top-level property (e.g., `time`, `location`, `topics`, `characters`).

- **Part key**: string identifier, defaulting to top-level property names from the active JSON Schema preset.
- **Part path**: JSON Pointer-like path within the tracker object. For the initial design we only support top-level paths: `/${partKey}`.

## Proposed behavior

### 1) Sequential generation mode
When enabled, generating a tracker for a message performs a sequence of smaller generations:

1. Determine the ordered list of parts.
2. For each part in order:
   - Build a reduced schema that requests **only that part**.
   - Ask the model to output only that part.
   - Parse response.
   - Merge the part value into the current full tracker object.
3. Persist the final merged tracker and render.

This preserves the user-facing outcome (a full tracker rendered above the message), but the model work happens incrementally.

### 2) Per-part regeneration
For a message that already has a tracker, the UI offers per-part actions:
- “Regenerate Time”
- “Regenerate Location”
- …

Clicking a part regenerates only that part and merges it into the existing tracker.

### 3) Backward compatibility
- If sequential mode is disabled, behavior remains identical to today (one request, full schema).
- Stored message data remains readable by older versions (the primary stored `value` continues to be a full object).

## Part model

### Default part list
By default, parts are derived from the current schema preset’s top-level `properties` keys, in declared order.

Example (default schema):
- `time`
- `location`
- `weather`
- `topics`
- `charactersPresent`
- `characters`

### Optional overrides (future)
A later phase may allow a settings override:
- Customize part order
- Combine keys into a single part (e.g., `scene` = {time,location,weather})
- Disable parts entirely

Not required for initial implementation.

## Reduced schema construction
Given the active full schema `S` (draft-07-ish JSON Schema object), and a part key `k`:

- Let `Sk = S.properties[k]`.
- Build `S_part`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SceneTrackerPart",
  "type": "object",
  "properties": {
    "k": Sk
  },
  "required": ["k"]
}
```

The requested output is an object containing only that key:

```json
{ "k": <value> }
```

### Notes / constraints
- This assumes schema presets are mostly self-contained (no `$ref`).
- If `$ref` becomes common, we will need a schema “bundle” step (defer).

## Merge strategy
When a part response `{ k: v }` is received:
- The stored tracker object becomes `next = { ...current, [k]: v }`.

For arrays/objects, we replace the subtree for `k` (no deep merge) to keep semantics simple and predictable.

## Rendering + strict-template safety

### Key constraint
Because templates are strict, saving an incomplete object can break rendering.

### Approach
- **Per-part regeneration**: safe to apply immediately because there is already a full tracker object; we replace one subtree and re-render.
- **First-time sequential generation** (no prior tracker): do not attempt to render after each part unless we can guarantee a render-safe object.

Initial implementation should:
- Accumulate parts in memory.
- Only `applyTrackerUpdateAndRender()` once all required parts have been generated.

(Optionally later: initialize a placeholder full object using a “blank” generator so each intermediate state renders.)

## Prompting behavior

### Common guidance
Each part request should:
- Include the same conversational context window as full generation.
- Include prior zTracker snapshots (existing behavior).
- Add an explicit instruction message:
  - “Generate ONLY the field `<k>` as valid output matching the provided schema.”
  - “Keep it consistent with the current tracker and recent messages.”

### Formats
- **Native**: request `json_schema` with `S_part`.
- **Prompt engineering (JSON/XML)**: reuse the existing templates, but pass `schema = JSON.stringify(S_part)` and `example_response = schemaToExample(S_part, format)`.

## Cancellation / pending requests

### User expectation
Clicking the message-level zTracker button while generation is running should cancel the in-flight operation.

### Proposed behavior
- Track in-flight request(s) by messageId.
- In sequential mode, cancellation cancels the currently running part request and stops the sequence.

## UI design

### Control placement
Controls are currently injected by zTracker (not part of user templates). We will extend the existing controls block to include per-part actions.

Proposed UI behavior:
- Keep existing:
  - regenerate full tracker
  - edit tracker JSON
  - delete tracker
- Add a “parts” control (compact):
  - either a dropdown menu or a small icon that expands a list of part buttons.

Each per-part action will carry `data-ztracker-part="<k>"` so the global click handler can dispatch.

### Event wiring
Extend the global click handler to recognize per-part buttons and call `actions.generateTrackerPart(messageId, partKey)`.

## Data model (message.extra)

Initial implementation (minimum change):
- Keep storing only the full tracker:
  - `message.extra[EXTENSION_KEY].value = fullObject`

Optional metadata (recommended for UX, but not required to ship):
- `message.extra[EXTENSION_KEY].parts = { [k]: { updatedAt: string } }`

This can power:
- tooltips (“Last updated: …”)
- future UI badges

## Acceptance criteria
- A new sequential generation mode exists and can be toggled (location: zTracker settings).
- In sequential mode, generating a tracker produces the same final stored tracker shape as today.
- Per-part regenerate UI exists for messages that have a tracker.
- Per-part regenerate updates only the requested part and preserves other parts.
- Cancel behavior works: clicking generate again cancels the in-flight request.
- `npm test` passes; new tests cover:
  - reduced schema construction
  - merge semantics
  - per-part dispatch wiring (unit/integration-ish)

## Verification
- Jest: `npm test`
- Manual: enable **Sequential generation** in **Extensions → zTracker**, then generate a tracker and use the list icon menu to regenerate a specific field.

## Open questions
1. Should sequential mode be default-on or default-off?
2. Do we want to render incremental progress for first-time generation, or only at the end?
3. Do we need a customizable part order in settings for v1?
4. How should auto-mode behave in sequential mode (full sequential run vs. full single-shot)?
