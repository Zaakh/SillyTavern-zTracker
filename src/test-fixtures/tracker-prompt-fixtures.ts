/**
 * Captured tracker prompt fixtures for prompt-assembly regression coverage.
 * These are concrete scenarios we want to keep reproducible across tests and follow-up fixes.
 */

/**
 * Records one live SillyTavern text-completion prompt-shape failure from the wrapped
 * tracker-generation path when conversation-role handling normalizes the user turn
 * to assistant/model and the host prompt builder ignores `message.name` unless
 * zTracker inlines the speaker labels before delegating prompt construction.
 */
export const wrappedConversationRoleSpeakerLossFixture = {
  apiMode: 'textgenerationwebui',
  promptEngineeringMode: 'json',
  conversationRoleMode: 'all_assistant',
  sampleMessages: [
    {
      role: 'assistant',
      name: 'Tobias',
      content: 'Just checking the room for a moment.',
    },
    {
      role: 'assistant',
      name: 'Bar',
      content: 'The barkeeper nods.',
    },
    {
      role: 'system',
      content: 'Generate tracker JSON',
    },
  ],
  expectedPromptFragment: 'Tobias: Just checking the room for a moment.\nBar: The barkeeper nods.',
  actualPromptSnapshot: [
    'WRAPPED:SYSTEM:Existing system prompt',
    '<|turn>model',
    'Just checking the room for a moment.<turn|>',
    '<|turn>model',
    'The barkeeper nods.<turn|>',
    '<|turn>system',
    'Generate tracker JSON<turn|>',
    '<|turn>model',
    '',
  ].join('\n'),
  fixedPromptSnapshot: [
    'WRAPPED:SYSTEM:Existing system prompt',
    '<|turn>model',
    'Tobias: Just checking the room for a moment.<turn|>',
    '<|turn>model',
    'Bar: The barkeeper nods.<turn|>',
    '<|turn>system',
    'Generate tracker JSON<turn|>',
    '<|turn>model',
    '',
  ].join('\n'),
  observedLossLayer: 'host prompt construction inside wrapped text-completion body assembly',
} as const;