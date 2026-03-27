# Spec: Tracker generation context debugging

Status: In Progress
Last updated: 2026-03-27

## Goal
Keep a short living record of what context zTracker sends to the LLM during tracker generation across the native JSON path and the prompt-engineered XML and TOON paths.

## Current verified flow
- Base prompt messages come from `buildPrompt(...)` in the tracker generation flow.
- zTracker then calls `includeZTrackerMessages(...)` to inject prior tracker snapshots into that prompt array.
- In native JSON mode, zTracker appends the tracker-generation user instruction and sends `overridePayload.json_schema` with the request.
- Saved tracker-only system prompts are inserted as an extra system message before the first non-system message.
- Before the request is sent, prompt messages are sanitized down to generation-relevant fields (`role`, `content`, optional `name`, optional `ignoreInstruct`).

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

## Verified example shape
- System message from the base prompt
- Inserted saved tracker system prompt
- Prior chat context
- Prior assistant message content only; tracker metadata stays out of the outbound request
- Injected `Tracker:` snapshot message
- Current user message
- Final tracker-generation instruction or rendered prompt-engineering instruction block
- Native structured-output payload under `overridePayload.json_schema` for JSON, empty override payload for XML and TOON

## Open questions
- Do we want a second harness for sequential part generation, since it appends “tracker so far” snapshots during the run?
- Should future debug output also summarize where each prompt message came from, not just print the raw payload?

## Acceptance criteria
- There are repeatable commands that print one real tracker-generation request for JSON, XML, and TOON modes.
- The output shows injected tracker context and the final mode-specific request payload.
- This spec stays updated as the debugging approach evolves.

## Verification
- `npm run debug:tracker-context:json`
- `npm run debug:tracker-context:xml`
- `npm run debug:tracker-context:toon`
- `npm test`

