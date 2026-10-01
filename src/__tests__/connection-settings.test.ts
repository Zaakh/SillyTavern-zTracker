import { jest } from '@jest/globals';
import {
  applyPrefill,
  finishTrackerReply,
  isUnclosedReasoningReply,
  leavesReasoningOpen,
  lookupFormattingObjects,
  markUnclosedReasoningReply,
  parseStopStrings,
  resolveEffectiveConnectionSettings,
  type ConnectionSettingsHost,
} from '../connection-settings.js';
import {
  GEMMA_NON_REASONING_PROFILE,
  GEMMA_REASONING_PROFILE,
  GEMMA_REASONING_TEMPLATE,
  makeGemmaLivePowerUserSettings,
} from '../test-fixtures/gemma-connection-profiles.js';

const closedEmptyBlock = '<|channel>thought\n<channel|>';

function makeHost(overrides: Partial<ConnectionSettingsHost> = {}): ConnectionSettingsHost {
  return {
    getPresetManager: () => ({ getSelectedPresetName: () => 'Live Sampler' }),
    getReasoningTemplateByName: (name) => {
      if (name !== 'Gemma 4') throw new Error(`Unknown reasoning template name: "${name}"`);
      return GEMMA_REASONING_TEMPLATE;
    },
    substituteParams: (value) => value.replace('{{user}}', 'Tobias'),
    powerUserSettings: makeGemmaLivePowerUserSettings(),
    ...overrides,
  };
}

describe('resolveEffectiveConnectionSettings', () => {
  test('uses every field the saved profile records, not the live reasoning settings', () => {
    const effective = resolveEffectiveConnectionSettings({
      connectionSource: 'saved',
      profile: GEMMA_NON_REASONING_PROFILE,
      isTextCompletion: true,
      host: makeHost(),
    });

    expect(effective).toMatchObject({
      source: 'profile',
      fallbackFields: [],
      presetName: 'Non Reasoning Sampler',
      instructName: 'Gemma-4  (no reasoning)',
      contextName: 'Gemma-4  (no reasoning)',
      instructEnabled: true,
      stopStrings: [],
      startReplyWith: closedEmptyBlock,
      reasoningTemplate: { name: 'Gemma 4', prefix: '<|channel>thought\n', suffix: '<channel|>' },
    });
  });

  test('records an explicitly empty Start Reply With instead of falling back to a live prefill', () => {
    const effective = resolveEffectiveConnectionSettings({
      connectionSource: 'saved',
      profile: GEMMA_REASONING_PROFILE,
      isTextCompletion: true,
      host: makeHost({ powerUserSettings: makeGemmaLivePowerUserSettings({ user_prompt_bias: 'LIVE PREFILL' }) }),
    });

    expect(effective.startReplyWith).toBe('');
    expect(effective.fallbackFields).toEqual([]);
  });

  test('falls back to the live value per missing field and lists it', () => {
    const { instruct: _instruct, ...profileWithoutInstruct } = GEMMA_NON_REASONING_PROFILE;
    const effective = resolveEffectiveConnectionSettings({
      connectionSource: 'saved',
      profile: profileWithoutInstruct,
      isTextCompletion: true,
      host: makeHost(),
    });

    expect(effective.instructName).toBe('Gemma-4 Reasoning');
    expect(effective.contextName).toBe('Gemma-4  (no reasoning)');
    expect(effective.fallbackFields).toEqual(['instruct']);
  });

  test('treats fields listed in profile.exclude as not recorded', () => {
    const effective = resolveEffectiveConnectionSettings({
      connectionSource: 'saved',
      profile: { ...GEMMA_NON_REASONING_PROFILE, exclude: ['start-reply-with', 'preset'] },
      isTextCompletion: true,
      host: makeHost({ powerUserSettings: makeGemmaLivePowerUserSettings({ user_prompt_bias: 'LIVE PREFILL' }) }),
    });

    expect(effective.startReplyWith).toBe('LIVE PREFILL');
    expect(effective.presetName).toBe('Live Sampler');
    expect(effective.fallbackFields).toEqual(['preset', 'start-reply-with']);
  });

  test('reads every field from the live settings for the live connection, without listing fallbacks', () => {
    const effective = resolveEffectiveConnectionSettings({
      connectionSource: 'active',
      profile: GEMMA_NON_REASONING_PROFILE,
      isTextCompletion: true,
      host: makeHost({ powerUserSettings: makeGemmaLivePowerUserSettings({ user_prompt_bias: '{' }) }),
    });

    expect(effective).toMatchObject({
      source: 'live',
      fallbackFields: [],
      presetName: 'Live Sampler',
      instructName: 'Gemma-4 Reasoning',
      startReplyWith: '{',
      instructEnabled: true,
    });
  });

  test('only resolves instruct, context and instruct-state for Text Completion', () => {
    const effective = resolveEffectiveConnectionSettings({
      connectionSource: 'saved',
      profile: { ...GEMMA_NON_REASONING_PROFILE, api: 'openai' },
      isTextCompletion: false,
      host: makeHost(),
    });

    expect(effective.instructName).toBeUndefined();
    expect(effective.contextName).toBeUndefined();
    expect(effective.instructEnabled).toBe(false);
    expect(effective.presetName).toBe('Non Reasoning Sampler');
    expect(effective.startReplyWith).toBe(closedEmptyBlock);
  });

  test('reads the instruct-state string from the profile', () => {
    const effective = resolveEffectiveConnectionSettings({
      connectionSource: 'saved',
      profile: { ...GEMMA_NON_REASONING_PROFILE, 'instruct-state': 'false' },
      isTextCompletion: true,
      host: makeHost(),
    });

    expect(effective.instructEnabled).toBe(false);
  });

  test('falls back to the live reasoning template when the profile names an unknown one', () => {
    const effective = resolveEffectiveConnectionSettings({
      connectionSource: 'saved',
      profile: { ...GEMMA_NON_REASONING_PROFILE, 'reasoning-template': 'Deleted Template' },
      isTextCompletion: true,
      host: makeHost({ powerUserSettings: makeGemmaLivePowerUserSettings({ reasoning: { prefix: '<think>', suffix: '</think>' } }) }),
    });

    expect(effective.reasoningTemplate).toEqual({ prefix: '<think>', suffix: '</think>' });
    expect(effective.fallbackFields).toEqual(['reasoning-template']);
  });

  test('macro-substitutes live stop strings only when the macro setting is on', () => {
    const stopSettings = { custom_stopping_strings: '["{{user}}:"]' };
    const withMacro = resolveEffectiveConnectionSettings({
      connectionSource: 'active',
      isTextCompletion: true,
      host: makeHost({ powerUserSettings: makeGemmaLivePowerUserSettings({ ...stopSettings, custom_stopping_strings_macro: true }) }),
    });
    const withoutMacro = resolveEffectiveConnectionSettings({
      connectionSource: 'active',
      isTextCompletion: true,
      host: makeHost({ powerUserSettings: makeGemmaLivePowerUserSettings(stopSettings) }),
    });

    expect(withMacro.stopStrings).toEqual(['Tobias:']);
    expect(withoutMacro.stopStrings).toEqual(['{{user}}:']);
  });
});

describe('parseStopStrings', () => {
  test('keeps only string entries and warns on invalid JSON', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(parseStopStrings('["a", 1, "b"]')).toEqual(['a', 'b']);
    expect(parseStopStrings('')).toEqual([]);
    expect(parseStopStrings('not json')).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });
});

describe('lookupFormattingObjects', () => {
  const profileEffective = () => resolveEffectiveConnectionSettings({
    connectionSource: 'saved',
    profile: GEMMA_NON_REASONING_PROFILE,
    isTextCompletion: true,
    host: makeHost(),
  });

  test('looks profile-sourced names up through the preset managers', () => {
    const instructPreset = { name: 'Gemma-4  (no reasoning)', input_sequence: '<profile-input>' };
    const contextPreset = { name: 'Gemma-4  (no reasoning)', story_string: 'profile story' };
    const host = makeHost({
      getPresetManager: (apiId) => ({
        getCompletionPresetByName: () => (apiId === 'instruct' ? instructPreset : contextPreset),
      }),
    });

    expect(lookupFormattingObjects(profileEffective(), host)).toEqual({
      instruct: instructPreset,
      context: contextPreset,
      fallbackFields: [],
    });
  });

  test('falls back to the live object with a warning when the lookup finds nothing', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const host = makeHost({ getPresetManager: () => ({ getCompletionPresetByName: () => undefined }) });

    const result = lookupFormattingObjects(profileEffective(), host);

    expect(result.instruct).toBe(host.powerUserSettings!.instruct);
    expect(result.context).toBe(host.powerUserSettings!.context);
    expect(result.fallbackFields).toEqual(['instruct', 'context']);
    expect(warn).toHaveBeenCalledTimes(2);

    warn.mockRestore();
  });

  test('uses the live objects directly for the live connection', () => {
    const host = makeHost();
    const liveEffective = resolveEffectiveConnectionSettings({ connectionSource: 'active', isTextCompletion: true, host });

    const result = lookupFormattingObjects(liveEffective, host);

    expect(result.instruct).toBe(host.powerUserSettings!.instruct);
    expect(result.fallbackFields).toEqual([]);
  });
});

describe('applyPrefill', () => {
  const messages = [{ role: 'system', content: 'Generate tracker' }];
  const template = GEMMA_REASONING_TEMPLATE;

  test('appends the prefill as a trailing assistant message without mutating the input', () => {
    const result = applyPrefill(messages, { prefill: '{', jsonSchemaSent: false, reasoningTemplate: template });

    expect(result.messages).toEqual([...messages, { role: 'assistant', content: '{' }]);
    expect(result.prefill).toBe('{');
    expect(messages).toHaveLength(1);
  });

  test('adds nothing for an empty prefill', () => {
    expect(applyPrefill(messages, { prefill: '', jsonSchemaSent: false })).toEqual({ messages, prefill: '', omitted: false });
  });

  test('keeps a closed empty reasoning block when a schema is sent', () => {
    const result = applyPrefill(messages, { prefill: closedEmptyBlock, jsonSchemaSent: true, reasoningTemplate: template });

    expect(result.prefill).toBe(closedEmptyBlock);
    expect(result.omitted).toBe(false);
  });

  test('drops an open reasoning prefix when a schema is sent', () => {
    const result = applyPrefill(messages, { prefill: template.prefix, jsonSchemaSent: true, reasoningTemplate: template });

    expect(result).toEqual({ messages, prefill: '', omitted: true });
  });

  test('keeps an open reasoning prefix without a schema', () => {
    const result = applyPrefill(messages, { prefill: template.prefix, jsonSchemaSent: false, reasoningTemplate: template });

    expect(result.prefill).toBe(template.prefix);
  });

  test('leavesReasoningOpen ignores prefills without the reasoning prefix', () => {
    expect(leavesReasoningOpen('{', template)).toBe(false);
    expect(leavesReasoningOpen(`${template.prefix}abc`, template)).toBe(true);
    expect(leavesReasoningOpen(`${template.prefix}abc${template.suffix}`, template)).toBe(false);
  });
});

describe('finishTrackerReply', () => {
  const template = GEMMA_REASONING_TEMPLATE;
  const base = { jsonSchemaSent: false, reasoningTemplate: template };

  test('restores the prefill in front of the model output', () => {
    expect(finishTrackerReply({ content: '"time":"10"}' }, { ...base, prefill: '{' }).content).toBe('{"time":"10"}');
  });

  test('does not restore the prefill twice when the backend repeats it', () => {
    expect(finishTrackerReply({ content: '{"time":"10"}' }, { ...base, prefill: '{' }).content).toBe('{"time":"10"}');
  });

  test('does not restore the prefill when a schema constrained the output', () => {
    expect(finishTrackerReply({ content: '{"time":"10"}' }, { ...base, prefill: closedEmptyBlock, jsonSchemaSent: true }).content).toBe(
      '{"time":"10"}',
    );
  });

  test('does not restore an opening prefill when the backend returned reasoning separately', () => {
    const result = finishTrackerReply({ content: '{"time":"10"}', reasoning: 'thinking' }, { ...base, prefill: template.prefix });

    expect(result).toEqual({ content: '{"time":"10"}', unclosedReasoning: false });
  });

  test('strips a closed empty reasoning block supplied by the prefill', () => {
    const result = finishTrackerReply({ content: '{"time":"10"}' }, { ...base, prefill: closedEmptyBlock });

    expect(result).toEqual({ content: '{"time":"10"}', unclosedReasoning: false });
  });

  test('strips reasoning opened by the prefill and closed by the model', () => {
    const result = finishTrackerReply({ content: `I should think.${template.suffix}\n{"time":"10"}` }, { ...base, prefill: template.prefix });

    expect(result).toEqual({ content: '{"time":"10"}', unclosedReasoning: false });
  });

  test('strips a reasoning block the model emitted on its own', () => {
    const result = finishTrackerReply({ content: `${template.prefix}hmm${template.suffix}{"time":"10"}` }, { ...base, prefill: '' });

    expect(result.content).toBe('{"time":"10"}');
  });

  test('strips the reasoning block from a live Gemma 4 reasoning-profile reply (captured 2026-10-01, reasoning shortened)', () => {
    const capturedReply =
      `${template.prefix}Thinking Process:\n\n1.  **Analyze the Request:** ...\n5.  **Construct the Final JSON:** wrap in \`\`\`json.${template.suffix}` +
      '```json\n{\n  "arc": "The confrontation at the ancient ruins",\n  "stakes": "The kingdom\'s survival hinges on the prophecy."\n}\n```';

    const result = finishTrackerReply({ content: capturedReply }, { ...base, prefill: '' });

    expect(result.unclosedReasoning).toBe(false);
    expect(result.content).toBe('```json\n{\n  "arc": "The confrontation at the ancient ruins",\n  "stakes": "The kingdom\'s survival hinges on the prophecy."\n}\n```');
  });

  test('returns a reply without reasoning unchanged', () => {
    expect(finishTrackerReply({ content: '{"time":"10"}' }, { ...base, prefill: '' })).toEqual({ content: '{"time":"10"}', unclosedReasoning: false });
  });

  test('drops the opening prefix of an unclosed block and flags it', () => {
    const result = finishTrackerReply({ content: `${template.prefix}{"time":"10"}` }, { ...base, prefill: '' });

    expect(result).toEqual({ content: '{"time":"10"}', unclosedReasoning: true });
  });

  test('uses an injected reasoning parser when provided', () => {
    const parseReasoning = jest.fn(() => ({ reasoning: 'x', content: 'parsed-by-host' }));

    const result = finishTrackerReply({ content: 'raw' }, { ...base, prefill: '', parseReasoning });

    expect(result.content).toBe('parsed-by-host');
    expect(parseReasoning).toHaveBeenCalledWith('raw', { strict: true }, template);
  });

  test('skips reasoning handling without a usable template', () => {
    expect(finishTrackerReply({ content: '<think>x</think>{}' }, { prefill: '', jsonSchemaSent: false }).content).toBe('<think>x</think>{}');
  });

  test('tracks flagged replies without touching their shape', () => {
    const reply = { content: 'x' };
    expect(isUnclosedReasoningReply(reply)).toBe(false);
    markUnclosedReasoningReply(reply);
    expect(isUnclosedReasoningReply(reply)).toBe(true);
    expect(isUnclosedReasoningReply('x')).toBe(false);
  });
});
