# Spec: Tracker generation context debugging

Status: In Progress
Last updated: 2026-03-27

## Goal
Keep a short living record of what context zTracker sends to the LLM during tracker generation for the live-like prompt-engineered JSON, XML, and TOON paths that we compare against SillyTavern.

## Current verified flow
- Base prompt messages come from `buildPrompt(...)` in the tracker generation flow.
- zTracker then calls `includeZTrackerMessages(...)` to inject prior tracker snapshots into that prompt array.
- The debug harnesses now use one shared live-like `Bar` fixture so JSON, XML, and TOON runs all mirror the same prompt stack observed in SillyTavern.
- Saved tracker-only system prompts are inserted as an extra system message before the first non-system message.
- Before the request is sent, prompt messages are sanitized down to generation-relevant fields (`role`, `content`, optional `name`, optional `ignoreInstruct`).
- The local parity regression test reuses the same capture helper as the manual debug scripts, so automation and manual inspection exercise the same request assembly path.

## Debug entrypoint
- Command: `npm run debug:tracker-context:json`
- File: `scripts/debug-tracker-context-json.ts`
- Output: one printed example request between `TRACKER_CONTEXT_JSON_START` and `TRACKER_CONTEXT_JSON_END`

## Additional debug entrypoints
- Command: `npm run debug:tracker-context:xml`
- File: `scripts/debug-tracker-context-xml.ts`
- Output: one printed XML prompt-engineering request between `TRACKER_CONTEXT_XML_START` and `TRACKER_CONTEXT_XML_END`

- Command: `npm run debug:tracker-context:toon`
- File: `scripts/debug-tracker-context-toon.ts`
- Output: one printed TOON prompt-engineering request between `TRACKER_CONTEXT_TOON_START` and `TRACKER_CONTEXT_TOON_END`

## Snapshot files
- `test-output/tracker-context-json.md`
- `test-output/tracker-context-xml.md`
- `test-output/tracker-context-toon.md`
- Each file stores the exact live-like request object emitted by the current harness for manual prompt-format review.

## Verified example shape
- Leading system narration prompt from the base prompt
- Inserted saved tracker system prompt
- Prior assistant and user chat turns from the live-like `Bar` fixture
- Two injected `Scene details:` snapshot messages rendered from prior tracker state
- Current user message
- Final mode-specific prompt-engineering instruction block for JSON, XML, or TOON
- Empty `overridePayload` for the live-like parity harness, matching the captured SillyTavern prompt-engineered requests

## Open questions
- Do we want a second harness for sequential part generation, since it appends “tracker so far” snapshots during the run?
- Should future debug output also summarize where each prompt message came from, not just print the raw payload?

## Acceptance criteria
- There are repeatable commands that print one real tracker-generation request for JSON, XML, and TOON modes.
- The output shows injected tracker context and the final mode-specific request payload.
- There is automated regression coverage that validates the shared live-like prompt shape across JSON, XML, and TOON.
- This spec stays updated as the debugging approach evolves.

## Verification
- `npm run debug:tracker-context:json`
- `npm run debug:tracker-context:xml`
- `npm run debug:tracker-context:toon`
- `npm test`

