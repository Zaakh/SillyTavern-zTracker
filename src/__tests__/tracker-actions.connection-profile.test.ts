/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import {
  applyTrackerUpdateAndRenderMock,
  buildPromptMock,
  createTrackerActions,
  installSillyTavernContext,
  makeContext,
  makeGenerateRequest,
  makeProfile,
  makeSettings,
  parseResponse,
  PromptEngineeringMode,
  renderTrackerWithDepsMock,
  resetTrackerActionTestState,
  schemaToExample,
  schemaToPromptSchema,
  stEchoMock,
  TEST_IMPORT_META_URL,
} from '../test-utils/tracker-actions-test-helpers.js';
import {
  GEMMA_NON_REASONING_PROFILE,
  GEMMA_REASONING_PROFILE,
  GEMMA_REASONING_TEMPLATE,
  makeGemmaLivePowerUserSettings,
} from '../test-fixtures/gemma-connection-profiles.js';

const { captureTrackerRequestDebugSnapshot } = await import('../ui/debug.js');

const closedEmptyBlock = '<|channel>thought\n<channel|>';

/** Saved-profile vs live connection behaviour of tracker requests: templates, sampler, prefill and reasoning. */
describe('createTrackerActions connection profile settings', () => {
  const originalCss = globalThis.CSS;
  const originalStructuredClone = globalThis.structuredClone;

  const instructPresets: Record<string, Record<string, unknown>> = {
    'Gemma-4  (no reasoning)': { name: 'Gemma-4  (no reasoning)', input_sequence: '<no-reasoning-input>' },
    'Gemma-4 Reasoning': { name: 'Gemma-4 Reasoning', input_sequence: '<reasoning-input>' },
  };
  const contextPresets: Record<string, Record<string, unknown>> = {
    'Gemma-4  (no reasoning)': { name: 'Gemma-4  (no reasoning)', story_string: 'no-reasoning story' },
    'Gemma-4 Reasoning': { name: 'Gemma-4 Reasoning', story_string: 'reasoning story' },
  };
  const samplerPresets: Record<string, Record<string, unknown>> = {
    'Non Reasoning Sampler': { temp: 0.1 },
    'Reasoning Sampler': { temp: 0.9 },
    'Live Sampler': { temp: 0.5 },
  };
  const textGenApiMap = { textgenerationwebui: { selected: 'textgenerationwebui', type: 'llamacpp' } };

  /** Wires a Text Completion host with preset managers, a wrapped-prompt formatter and recording mocks. */
  function setupTextCompletion(options: {
    profile?: Record<string, unknown>;
    settings?: Record<string, unknown>;
    powerUserSettings?: Record<string, unknown>;
    sendResponse?: unknown;
    activeProfile?: Record<string, unknown>;
  } = {}) {
    const constructPrompt = jest.fn((prompt: Array<{ role: string; content: string }>) =>
      prompt.map((message) => `[${message.role}]${message.content}`).join('|'));
    const createRequestData = jest.fn((requestData: Record<string, unknown>) => requestData);
    const sendRequest = jest.fn(async () => ({ content: options.sendResponse ?? { time: '10:00:00' } }));
    const presetToGeneratePayload = jest.fn((preset: Record<string, unknown>, _override: unknown, requestData: Record<string, unknown>) => ({
      ...requestData,
      temperature: preset.temp,
    }));
    const formatterCalls = { storyStrings: [] as any[], stoppingOptions: [] as any[] };
    const formatterLoader = jest.fn(async () => ({
      renderStoryString: (params: Record<string, unknown>, renderOptions: unknown) => {
        formatterCalls.storyStrings.push(renderOptions);
        return `SYSTEM:${String(params.system ?? '')}`;
      },
      formatInstructModeStoryString: (storyString: string) => `WRAPPED:${storyString}`,
      getInstructStoppingSequences: (stopOptions: unknown) => {
        formatterCalls.stoppingOptions.push(stopOptions);
        return ['</s>'];
      },
    }));

    const context = makeContext({
      powerUserSettings: options.powerUserSettings ?? makeGemmaLivePowerUserSettings(),
      getPresetManager: (apiId?: string) => {
        const byApi: Record<string, Record<string, Record<string, unknown>>> = {
          instruct: instructPresets,
          context: contextPresets,
          textgenerationwebui: samplerPresets,
        };
        if (apiId && byApi[apiId]) {
          return { getCompletionPresetByName: (name?: string) => byApi[apiId][name ?? ''] };
        }
        return { getSelectedPresetName: () => 'Live Sampler' };
      },
      textCompletionConstructPrompt: constructPrompt as jest.Mock,
      textCompletionCreateRequestData: createRequestData as jest.Mock,
      textCompletionSendRequest: sendRequest as jest.Mock,
    });
    context.TextCompletionService.presetToGeneratePayload = presetToGeneratePayload;
    context.getReasoningTemplateByName = (name: string) => {
      if (name !== 'Gemma 4') throw new Error('unknown');
      return GEMMA_REASONING_TEMPLATE;
    };
    installSillyTavernContext(context);

    const profile = options.profile ?? GEMMA_NON_REASONING_PROFILE;
    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: { connectionManager: { profiles: [profile, ...(options.activeProfile ? [options.activeProfile] : [])] } },
        CONNECT_API_MAP: textGenApiMap,
      },
      settingsManager: {
        getSettings: () => makeSettings({ profileId: profile.id, trackerSystemPromptMode: 'profile', ...(options.settings ?? {}) }),
      } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
      textCompletionStoryStringFormatterLoader: formatterLoader,
    });

    return { actions, context, constructPrompt, createRequestData, sendRequest, presetToGeneratePayload, formatterCalls };
  }

  beforeEach(() => {
    resetTrackerActionTestState();
    globalThis.CSS = originalCss ?? ({ escape: (value: string) => value } as typeof CSS);
    globalThis.structuredClone = originalStructuredClone ?? ((value: unknown) => JSON.parse(JSON.stringify(value)));
    buildPromptMock.mockResolvedValue({
      result: [
        { role: 'system', content: 'Existing system prompt' },
        { role: 'user', content: 'Prior chat message', name: 'Tobias' },
      ],
    } as any);
  });

  afterEach(() => {
    globalThis.CSS = originalCss;
    globalThis.structuredClone = originalStructuredClone;
  });

  describe('saved Text Completion profile on the wrapped path', () => {
    test('formats with the profile templates, preset and secret and ends with the reply cue plus its prefill', async () => {
      const { actions, constructPrompt, createRequestData, presetToGeneratePayload, sendRequest, formatterCalls } = setupTextCompletion();

      await actions.generateTracker(0);

      expect(buildPromptMock).toHaveBeenCalledWith('textgenerationwebui', expect.objectContaining({
        instructName: 'Gemma-4  (no reasoning)',
        contextName: 'Gemma-4  (no reasoning)',
      }));
      expect(formatterCalls.storyStrings[0]).toMatchObject({
        customInstructSettings: instructPresets['Gemma-4  (no reasoning)'],
        customContextSettings: contextPresets['Gemma-4  (no reasoning)'],
      });
      expect(formatterCalls.stoppingOptions[0]).toMatchObject({ customInstruct: instructPresets['Gemma-4  (no reasoning)'] });

      const [promptMessages, instructPreset] = constructPrompt.mock.calls[0] as unknown as [Array<{ role: string; content: string }>, unknown];
      expect(instructPreset).toBe(instructPresets['Gemma-4  (no reasoning)']);
      expect(promptMessages.at(-1)).toEqual({ role: 'assistant', content: closedEmptyBlock });
      expect(promptMessages.at(-2)).toEqual({ role: 'system', content: 'Generate tracker JSON' });

      expect(presetToGeneratePayload).toHaveBeenCalledWith(samplerPresets['Non Reasoning Sampler'], {}, expect.any(Object));
      expect(createRequestData).toHaveBeenCalledWith(expect.objectContaining({ secret_id: 'secret-1' }));
      const sentRequest = (sendRequest.mock.calls[0] as unknown as [Record<string, unknown>])[0];
      expect(sentRequest).toMatchObject({ temperature: 0.1, secret_id: 'secret-1' });
      expect(String(sentRequest.prompt)).toMatch(/\[assistant\]<\|channel>thought\n<channel\|>$/);
      expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
    });

    test('a profile that records an empty Start Reply With sends no prefill even when the live one is set', async () => {
      const { actions, constructPrompt } = setupTextCompletion({
        profile: GEMMA_REASONING_PROFILE,
        powerUserSettings: makeGemmaLivePowerUserSettings({ user_prompt_bias: 'LIVE PREFILL' }),
      });

      await actions.generateTracker(0);

      const [promptMessages, instructPreset] = constructPrompt.mock.calls[0] as unknown as [Array<{ role: string; content: string }>, unknown];
      expect(instructPreset).toBe(instructPresets['Gemma-4 Reasoning']);
      expect(promptMessages.map((message) => message.role)).not.toContain('assistant');
    });

    test('falls back to the live instruct template only for a field the profile does not record', async () => {
      const { instruct: _instruct, ...profileWithoutInstruct } = GEMMA_NON_REASONING_PROFILE;
      const { actions, formatterCalls } = setupTextCompletion({ profile: profileWithoutInstruct });

      await actions.generateTracker(0);

      expect(formatterCalls.storyStrings[0].customInstructSettings).toMatchObject({ preset: 'Gemma-4 Reasoning' });
      expect(formatterCalls.storyStrings[0].customContextSettings).toBe(contextPresets['Gemma-4  (no reasoning)']);
    });

    test('formats plain joined content without stop sequences when the profile turns instruct mode off', async () => {
      const { actions, constructPrompt, sendRequest, formatterCalls } = setupTextCompletion({
        profile: { ...GEMMA_NON_REASONING_PROFILE, 'instruct-state': 'false' },
      });

      await actions.generateTracker(0);

      expect(constructPrompt).not.toHaveBeenCalled();
      expect(formatterCalls.storyStrings).toHaveLength(0);
      const sentRequest = (sendRequest.mock.calls[0] as unknown as [Record<string, unknown>])[0];
      expect(sentRequest.prompt).toBe(`Existing system prompt\n\nTobias: Prior chat message\n\nGenerate tracker JSON\n\n${closedEmptyBlock}`);
      expect(sentRequest).not.toHaveProperty('stop');
    });

    test('adds the effective custom stop strings to the instruct stop sequences', async () => {
      const { actions, sendRequest } = setupTextCompletion({
        profile: { ...GEMMA_NON_REASONING_PROFILE, 'stop-strings': '["STOP-ME"]' },
      });

      await actions.generateTracker(0);

      const sentRequest = (sendRequest.mock.calls[0] as unknown as [Record<string, unknown>])[0];
      expect(sentRequest).toMatchObject({ stop: ['</s>', 'STOP-ME'], stopping_strings: ['</s>', 'STOP-ME'] });
    });
  });

  test('records the effective settings and fallback fields in the debug snapshot', async () => {
    const { instruct: _instruct, ...profileWithoutInstruct } = GEMMA_NON_REASONING_PROFILE;
    const { actions } = setupTextCompletion({ profile: profileWithoutInstruct });

    await actions.generateTracker(0);

    expect(captureTrackerRequestDebugSnapshot).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      settingsSource: 'profile',
      fallbackFields: ['instruct'],
      instructName: 'Gemma-4 Reasoning',
      contextName: 'Gemma-4  (no reasoning)',
      presetName: 'Non Reasoning Sampler',
      instructEnabled: true,
      startReplyWith: closedEmptyBlock,
      reasoningTemplateName: 'Gemma 4',
    }));
  });

  describe('live Text Completion connection', () => {
    test('receives the live sampler preset and the live Start Reply With prefill', async () => {
      const { actions, constructPrompt, presetToGeneratePayload } = setupTextCompletion({
        powerUserSettings: makeGemmaLivePowerUserSettings({ user_prompt_bias: '{' }),
        settings: { connectionSource: 'active', profileId: '' },
        activeProfile: { id: 'active-profile', api: 'textgenerationwebui', model: 'live-model', api_server: 'http://live.example' },
      });
      const liveContext = (globalThis as any).SillyTavern.getContext();
      liveContext.extensionSettings = { connectionManager: { selectedProfile: 'active-profile', profiles: [{ id: 'active-profile', api: 'textgenerationwebui', model: 'live-model', api_server: 'http://live.example' }] } };
      liveContext.mainApi = 'textgenerationwebui';
      liveContext.textCompletionSettings = { type: 'llamacpp' };

      await actions.generateTracker(0);

      expect(presetToGeneratePayload).toHaveBeenCalledWith(samplerPresets['Live Sampler'], {}, expect.any(Object));
      const [promptMessages] = constructPrompt.mock.calls[0] as unknown as [Array<{ role: string; content: string }>];
      expect(promptMessages.at(-1)).toEqual({ role: 'assistant', content: '{' });
    });
  });

  test('keeps the profile instruct and context templates when the System Prompt Source is "selected"', async () => {
    const { actions, constructPrompt } = setupTextCompletion({
      profile: { ...GEMMA_NON_REASONING_PROFILE, sysprompt: 'Profile Sysprompt' },
      settings: { trackerSystemPromptMode: 'selected' },
    });

    await actions.generateTracker(0);

    expect(buildPromptMock).toHaveBeenCalledWith('textgenerationwebui', expect.objectContaining({
      instructName: 'Gemma-4  (no reasoning)',
      contextName: 'Gemma-4  (no reasoning)',
      syspromptName: 'Profile Sysprompt',
    }));
    expect(constructPrompt.mock.calls[0][1]).toBe(instructPresets['Gemma-4  (no reasoning)']);
  });

  /** Wires a Chat Completion host whose generator returns `response` and records every request. */
  function setupChatCompletion(options: {
    profile?: Record<string, unknown>;
    settings?: Record<string, unknown>;
    powerUserSettings?: Record<string, unknown>;
    response?: unknown;
    chatMessage?: Record<string, unknown>;
  } = {}) {
    const context = makeContext({
      powerUserSettings: options.powerUserSettings ?? makeGemmaLivePowerUserSettings(),
      extensionSettings: { connectionManager: { selectedProfile: { id: 'live-profile', api: 'openai' } } },
      mainApi: 'openai',
    });
    context.getReasoningTemplateByName = (name: string) => {
      if (name !== 'Gemma 4') throw new Error('unknown');
      return GEMMA_REASONING_TEMPLATE;
    };
    installSillyTavernContext(context);
    buildPromptMock.mockResolvedValue({ result: [{ role: 'system', content: 'Existing system prompt' }, { role: 'user', content: 'Prior chat message' }] } as any);

    const profile = options.profile ?? makeProfile({ id: 'cc-profile', 'start-reply-with': 'Sure,', 'reasoning-template': 'Gemma 4' });
    const generateRequest = makeGenerateRequest({ content: options.response ?? { time: '10:00:00' } });
    const actions = createTrackerActions({
      globalContext: {
        chat: [options.chatMessage ?? { original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: { connectionManager: { profiles: [profile] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () => makeSettings({ profileId: profile.id, trackerSystemPromptMode: 'profile', ...(options.settings ?? {}) }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    return { actions, generateRequest };
  }

  const jsonModeSettings = { promptEngineeringMode: PromptEngineeringMode.JSON, promptJson: 'JSON TEMPLATE' };

  describe('Chat Completion prefill and reply handling', () => {
    beforeEach(() => {
      (schemaToExample as jest.Mock).mockReturnValue('{}');
      (schemaToPromptSchema as jest.Mock).mockReturnValue('type: object');
      (parseResponse as jest.Mock).mockReset();
      (parseResponse as jest.Mock).mockReturnValue({ time: '10:00:00' });
    });

    test('sends a saved profile Start Reply With as the last assistant message, right after the instruction', async () => {
      const { actions, generateRequest } = setupChatCompletion();

      await actions.generateTracker(0);

      const sent = (generateRequest.mock.calls[0][0] as any).prompt;
      expect(sent.at(-1)).toEqual({ role: 'assistant', content: 'Sure,' });
      expect(sent.at(-2)).toEqual({ role: 'system', content: 'Generate tracker JSON' });
    });

    test('keeps the prefill last for part regeneration too', async () => {
      document.body.innerHTML = '<div class="mes" mesid="0"><div class="mes_text"></div></div>';
      const { actions, generateRequest } = setupChatCompletion({
        chatMessage: { original_avatar: 'avatar.png', extra: { zTracker: { schemaValue: { time: '09:00:00' }, schemaHtml: '<div></div>' } } },
        settings: { trackerSystemPromptMode: 'saved' },
      });
      (globalThis as any).SillyTavern.getContext().getPresetManager = (apiId?: string) =>
        apiId === 'sysprompt' ? { getCompletionPresetByName: () => ({ name: 'zTracker', content: 'Saved prompt' }) } : null;

      await actions.generateTrackerPart(0, 'time');

      const sent = (generateRequest.mock.calls[0][0] as any).prompt;
      expect(sent.at(-1)).toEqual({ role: 'assistant', content: 'Sure,' });
      expect(sent.at(-2).role).toBe('system');
    });

    test('uses the live Start Reply With for the live connection', async () => {
      const { actions, generateRequest } = setupChatCompletion({
        powerUserSettings: makeGemmaLivePowerUserSettings({ user_prompt_bias: 'Live bias' }),
        settings: { connectionSource: 'active', profileId: '' },
      });

      await actions.generateTracker(0);

      const sent = (generateRequest.mock.calls[0][0] as any).prompt;
      expect(sent.at(-1)).toEqual({ role: 'assistant', content: 'Live bias' });
    });

    test('sends no prefill when the profile has an empty Start Reply With', async () => {
      const { actions, generateRequest } = setupChatCompletion({
        profile: makeProfile({ id: 'cc-profile', 'start-reply-with': '' }),
        powerUserSettings: makeGemmaLivePowerUserSettings({ user_prompt_bias: 'Live bias' }),
      });

      await actions.generateTracker(0);

      const sent = (generateRequest.mock.calls[0][0] as any).prompt;
      expect(sent.map((message: { role: string }) => message.role)).not.toContain('assistant');
    });

    test('puts the prefill back before parsing when the backend continued from it', async () => {
      const { actions } = setupChatCompletion({
        profile: makeProfile({ id: 'cc-profile', 'start-reply-with': '{' }),
        settings: jsonModeSettings,
        response: '"time":"10:00:00"}',
      });

      await actions.generateTracker(0);

      expect((parseResponse as jest.Mock).mock.calls[0][0]).toBe('{"time":"10:00:00"}');
      expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
    });

    test('does not put the prefill back a second time when the backend repeated it', async () => {
      const { actions } = setupChatCompletion({
        profile: makeProfile({ id: 'cc-profile', 'start-reply-with': '{' }),
        settings: jsonModeSettings,
        response: '{"time":"10:00:00"}',
      });

      await actions.generateTracker(0);

      expect((parseResponse as jest.Mock).mock.calls[0][0]).toBe('{"time":"10:00:00"}');
    });

    test('strips a reasoning block before parsing in prompt-engineered mode', async () => {
      const { actions } = setupChatCompletion({
        profile: makeProfile({ id: 'cc-profile', 'start-reply-with': '', 'reasoning-template': 'Gemma 4' }),
        settings: jsonModeSettings,
        response: '<|channel>thought\nlet me think<channel|>{"time":"10:00:00"}',
      });

      await actions.generateTracker(0);

      expect((parseResponse as jest.Mock).mock.calls[0][0]).toBe('{"time":"10:00:00"}');
      expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
    });

    test('parses a reply unchanged when it has no reasoning block', async () => {
      const { actions } = setupChatCompletion({
        profile: makeProfile({ id: 'cc-profile', 'start-reply-with': '', 'reasoning-template': 'Gemma 4' }),
        settings: jsonModeSettings,
        response: '{"time":"10:00:00"}',
      });

      await actions.generateTracker(0);

      expect((parseResponse as jest.Mock).mock.calls[0][0]).toBe('{"time":"10:00:00"}');
    });

    test.each([
      ['JSON', PromptEngineeringMode.JSON, 'promptJson'],
      ['XML', PromptEngineeringMode.XML, 'promptXml'],
      ['TOON', PromptEngineeringMode.TOON, 'promptToon'],
    ])('saves a %s reply that skipped thinking after an opening reasoning prefix', async (_label, mode, promptKey) => {
      const { actions } = setupChatCompletion({
        profile: makeProfile({ id: 'cc-profile', 'start-reply-with': '', 'reasoning-template': 'Gemma 4' }),
        settings: { promptEngineeringMode: mode, [promptKey]: 'TEMPLATE' },
        response: '<|channel>thought\n{"time":"10:00:00"}',
      });

      await actions.generateTracker(0);

      expect((parseResponse as jest.Mock).mock.calls[0][0]).toBe('{"time":"10:00:00"}');
      expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
    });

    test.each([
      ['JSON', PromptEngineeringMode.JSON, 'promptJson'],
      ['XML', PromptEngineeringMode.XML, 'promptXml'],
      ['TOON', PromptEngineeringMode.TOON, 'promptToon'],
      ['Native', PromptEngineeringMode.NATIVE, 'prompt'],
    ])('fails with the unclosed reasoning block error for an unparsable %s reply and saves nothing', async (_label, mode, promptKey) => {
      (parseResponse as jest.Mock).mockImplementation(() => {
        throw new Error('not parseable');
      });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { actions } = setupChatCompletion({
        profile: makeProfile({ id: 'cc-profile', 'start-reply-with': '', 'reasoning-template': 'Gemma 4' }),
        settings: { promptEngineeringMode: mode, [promptKey]: 'TEMPLATE' },
        response: '<|channel>thought\nhalf-finished reasoning',
      });

      await actions.generateTracker(0);

      expect(stEchoMock).toHaveBeenCalledWith('error', expect.stringContaining('unclosed reasoning block'));
      expect(applyTrackerUpdateAndRenderMock).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
      warnSpy.mockRestore();
    });

    test('keeps a plain parse error when the reply had no unclosed reasoning block', async () => {
      (parseResponse as jest.Mock).mockImplementation(() => {
        throw new Error('not parseable');
      });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { actions } = setupChatCompletion({ settings: jsonModeSettings, response: 'garbage', profile: makeProfile({ id: 'cc-profile' }) });

      await actions.generateTracker(0);

      expect(stEchoMock).toHaveBeenCalledWith('error', 'Tracker generation failed: not parseable');
      consoleSpy.mockRestore();
      warnSpy.mockRestore();
    });

    test('omits an open reasoning prefill in Native mode and sends a closed one', async () => {
      const open = setupChatCompletion({
        profile: makeProfile({ id: 'cc-profile', 'start-reply-with': GEMMA_REASONING_TEMPLATE.prefix, 'reasoning-template': 'Gemma 4' }),
      });
      await open.actions.generateTracker(0);
      const openSent = (open.generateRequest.mock.calls[0][0] as any).prompt;
      expect(openSent.map((message: { role: string }) => message.role)).not.toContain('assistant');

      const closed = setupChatCompletion({
        profile: makeProfile({ id: 'cc-profile', 'start-reply-with': closedEmptyBlock, 'reasoning-template': 'Gemma 4' }),
      });
      await closed.actions.generateTracker(0);
      const closedSent = (closed.generateRequest.mock.calls[0][0] as any).prompt;
      expect(closedSent.at(-1)).toEqual({ role: 'assistant', content: closedEmptyBlock });
    });

    test('grammar probe requests carry no prefill and get no reasoning handling', async () => {
      (parseResponse as jest.Mock).mockReturnValue({ ok: true });
      const { actions, generateRequest } = setupChatCompletion({
        profile: makeProfile({ id: 'cc-profile', 'start-reply-with': 'Sure,', 'reasoning-template': 'Gemma 4' }),
        response: '<|channel>thought\nhm<channel|>{"ok":true}',
      });

      await actions.testGrammarSchemaEnforcement('default');

      const sent = (generateRequest.mock.calls[0][0] as any).prompt;
      expect(sent).toEqual([expect.objectContaining({ role: 'system' })]);
      expect((parseResponse as jest.Mock).mock.calls[0][0]).toBe('<|channel>thought\nhm<channel|>{"ok":true}');
    });
  });

  describe('Text Completion reply handling', () => {
    test('restores the prefill, strips the closed empty reasoning block and saves the tracker', async () => {
      (parseResponse as jest.Mock).mockReset();
      (parseResponse as jest.Mock).mockReturnValue({ time: '10:00:00' });
      const { actions } = setupTextCompletion({
        sendResponse: '{"time":"10:00:00"}',
        settings: jsonModeSettings,
      });
      (schemaToExample as jest.Mock).mockReturnValue('{}');
      (schemaToPromptSchema as jest.Mock).mockReturnValue('type: object');

      await actions.generateTracker(0);

      expect((parseResponse as jest.Mock).mock.calls[0][0]).toBe('{"time":"10:00:00"}');
      expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
    });
  });
});
