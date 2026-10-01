/**
 * Shared fixture mirroring two real Gemma 4 Text Completion connection profiles (non-reasoning and
 * reasoning) plus the "Gemma 4" reasoning template, as observed in a real SillyTavern settings file.
 * The non-reasoning profile turns thinking off by prefilling an already closed, empty reasoning block.
 */

export const GEMMA_REASONING_TEMPLATE = { name: 'Gemma 4', prefix: '<|channel>thought\n', suffix: '<channel|>', separator: '\n\n' };

export const GEMMA_NON_REASONING_PROFILE = {
  id: 'non-reasoning',
  name: 'llamacpp - gemma 4 e2b - non-reasoning',
  api: 'textgenerationwebui',
  preset: 'Non Reasoning Sampler',
  instruct: 'Gemma-4  (no reasoning)',
  context: 'Gemma-4  (no reasoning)',
  'instruct-state': 'true',
  'stop-strings': '[]',
  'start-reply-with': '<|channel>thought\n<channel|>',
  'reasoning-template': 'Gemma 4',
  'secret-id': 'secret-1',
  model: 'gemma-model',
  'api-url': 'http://127.0.0.1:8080',
  exclude: [] as string[],
};

export const GEMMA_REASONING_PROFILE = {
  ...GEMMA_NON_REASONING_PROFILE,
  id: 'reasoning',
  name: 'llamacpp - Gemma-4 e2b - reasoning',
  preset: 'Reasoning Sampler',
  instruct: 'Gemma-4 Reasoning',
  context: 'Gemma-4 Reasoning',
  'start-reply-with': '',
};

/** Live SillyTavern power-user settings that match the reasoning profile. */
export function makeGemmaLivePowerUserSettings(overrides: Record<string, unknown> = {}) {
  return {
    instruct: { preset: 'Gemma-4 Reasoning', enabled: true, input_sequence: '<live-input>' },
    context: { preset: 'Gemma-4 Reasoning', story_string: '{{system}}' },
    custom_stopping_strings: '[]',
    custom_stopping_strings_macro: false,
    user_prompt_bias: '',
    reasoning: GEMMA_REASONING_TEMPLATE,
    ...overrides,
  };
}
