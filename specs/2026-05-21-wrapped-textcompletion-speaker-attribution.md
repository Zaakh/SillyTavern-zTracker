# Wrapped Text-Completion Speaker Attribution Loss

## Goal

File the runtime fix only after one concrete failure case is reproducible and the owning layer is explicit.

## Reproduced case

- API mode: `textgenerationwebui`
- Prompt-engineering mode: `json`
- Conversation-role mode: `all_assistant`
- Sample messages entering wrapped body assembly:
  - `assistant` / `Tobias`: `Just checking the room for a moment.`
  - `assistant` / `Bar`: `The barkeeper nods.`
  - `system`: `Generate tracker JSON`
- Expected prompt fragment:
  - `Tobias: Just checking the room for a moment.`
  - `Bar: The barkeeper nods.`
- Actual prompt snapshot:

```text
WRAPPED:SYSTEM:Existing system prompt
<|turn>model
Just checking the room for a moment.<turn|>
<|turn>model
The barkeeper nods.<turn|>
<|turn>system
Generate tracker JSON<turn|>
<|turn>model
```

## Layer diagnosis

- `normalizeTrackerGenerationConversationRoles()` is not dropping `name`; it only rewrites the user turn to `assistant`.
- `sanitizeMessagesForGeneration()` is not dropping `name`; the wrapped body messages still reach `TextCompletionService.constructPrompt()` with `name: 'Tobias'` and `name: 'Bar'`.
- The loss occurs when the wrapped text-completion path delegates body assembly to SillyTavern host prompt construction, which ignores `message.name` and emits unlabeled model turns.
- The owning runtime seam is zTracker's wrapped text-completion assembly in [src/ui/tracker-actions.ts](src/ui/tracker-actions.ts), because that seam decides whether to inline speaker labels before calling the host helper.

## Desired runtime behavior

- Wrapped text-completion tracker prompts must preserve speaker attribution across role normalization.
- If host `constructPrompt()` ignores `message.name`, zTracker must inline speaker labels into the wrapped body messages before delegating prompt construction.

## Implemented fix

- zTracker now routes wrapped text-completion prompt-body assembly back through the canonical `sanitizeMessagesForGeneration()` rules instead of keeping a second speaker-inlining helper in `tracker-actions.ts`.
- This keeps `Tobias:` and `Bar:` inside the body content even when SillyTavern emits assistant turns as unlabeled `model` blocks.
- The tracker-actions test harness now mirrors the relevant sanitizer contract closely enough for wrapped prompt tests to validate the real seam instead of an identity mock.

## Repro artifacts

- Fixture: [src/test-fixtures/tracker-prompt-fixtures.ts](src/test-fixtures/tracker-prompt-fixtures.ts)
- Characterization test: [src/__tests__/tracker-actions.prompt-assembly.test.ts](src/__tests__/tracker-actions.prompt-assembly.test.ts)

## Validation

- Focused suite: `node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand src/__tests__/tracker-actions.prompt-assembly.test.ts`