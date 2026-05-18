/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import {
  applyTrackerUpdateAndRenderMock,
  buildPromptMock,
  createTrackerActions,
  includeZTrackerMessagesMock,
  installSillyTavernContext,
  markEmbeddedTrackerSnapshot,
  makeBuiltPromptResult,
  makeContext,
  makeGenerateRequest,
  makeProfile,
  makeSettings,
  renderTrackerWithDepsMock,
  resetTrackerActionTestState,
  sanitizeMessagesForGenerationMock,
  stEchoMock,
  TEST_IMPORT_META_URL,
} from '../test-utils/tracker-actions-test-helpers.js';

const trackerPartsModule = await import('../tracker-parts.js');

describe('createTrackerActions prompt assembly', () => {
  const originalCss = globalThis.CSS;
  const activeTextConnectApiMap = {
    koboldcpp: { selected: 'textgenerationwebui', type: 'koboldcpp' },
    kcpp: { selected: 'textgenerationwebui', type: 'koboldcpp' },
    'openrouter-text': { selected: 'textgenerationwebui', type: 'openrouter' },
    ooba: { selected: 'textgenerationwebui', type: 'ooba' },
  };

  function makeActiveTextRuntimeContext(options: {
    profileOverrides?: Record<string, unknown>;
    selectedProfile?: unknown;
    mainApi?: string;
    textCompletionType?: string;
    textCompletionProcessRequest?: jest.Mock;
    textCompletionConstructPrompt?: jest.Mock;
    textCompletionCreateRequestData?: jest.Mock;
    textCompletionSendRequest?: jest.Mock;
    powerUserSettings?: Record<string, unknown>;
  } = {}) {
    const activeProfile = {
      id: 'active-text-profile',
      api: 'textgenerationwebui',
      model: 'live-model',
      api_server: 'http://live.example',
      ...options.profileOverrides,
    };
    const context = makeContext({
      extensionSettings: {
        connectionManager: {
          selectedProfile: options.selectedProfile ?? activeProfile.id,
          profiles: [activeProfile],
        },
      },
      mainApi: options.mainApi ?? 'textgenerationwebui',
      powerUserSettings: options.powerUserSettings,
      textCompletionProcessRequest: options.textCompletionProcessRequest,
      textCompletionConstructPrompt: options.textCompletionConstructPrompt,
      textCompletionCreateRequestData: options.textCompletionCreateRequestData,
      textCompletionSendRequest: options.textCompletionSendRequest,
    });

    if (options.textCompletionType !== undefined) {
      context.textCompletionSettings = { type: options.textCompletionType };
    }

    return context;
  }

  function createActiveTrackerActions(options: {
    connectApiMap?: Record<string, unknown>;
    settingsOverrides?: Record<string, unknown>;
    textCompletionStoryStringFormatterLoader?: () => Promise<unknown>;
  } = {}) {
    return createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile({ id: 'saved-profile', api: 'openai' })],
          },
        },
        CONNECT_API_MAP: options.connectApiMap ?? activeTextConnectApiMap,
      },
      settingsManager: {
        getSettings: () => makeSettings({ profileId: '', connectionSource: 'active', trackerSystemPromptMode: 'profile', ...(options.settingsOverrides ?? {}) }),
      } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
      ...(options.textCompletionStoryStringFormatterLoader
        ? { textCompletionStoryStringFormatterLoader: options.textCompletionStoryStringFormatterLoader }
        : {}),
    });
  }

  beforeEach(() => {
    resetTrackerActionTestState();
    globalThis.CSS = originalCss ?? ({ escape: (value: string) => value } as typeof CSS);
  });

  afterEach(() => {
    globalThis.CSS = originalCss;
  });

  test('injects the saved prompt without mutating prefer_character_prompt', async () => {
    const powerUserSettings = {
      prefer_character_prompt: true,
      sysprompt: { name: 'Neutral - Chat' },
    };
    installSillyTavernContext(makeContext({
      includeSavedPromptPreset: true,
      powerUserSettings,
      getPresetManager: () => ({
        getSelectedPresetName: () => 'Active Preset',
        getCompletionPresetByName: (name?: string) =>
          name === 'zTracker' ? { name: 'zTracker', content: 'Saved tracker system prompt' } : undefined,
        getPresetList: () => ({ presets: [], preset_names: ['zTracker'] }),
      }),
    }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const generateRequest = makeGenerateRequest();

    const actions = createTrackerActions({
        globalContext: {
          chat: [{ original_avatar: 'avatar.png', extra: {} }],
          saveChat: async () => undefined,
          extensionSettings: {
            connectionManager: {
              profiles: [makeProfile({ preset: 'Profile Preset' })],
            },
          },
          CONNECT_API_MAP: { openai: { selected: 'openai' } },
        },
      settingsManager: { getSettings: () => makeSettings() } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    expect(powerUserSettings.prefer_character_prompt).toBe(true);
    expect(buildPromptMock).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({
        includeNames: true,
      }),
    );
    const buildPromptOptions = (buildPromptMock as jest.Mock).mock.calls[0][1];
    expect(buildPromptOptions).toHaveProperty('presetName', 'Active Preset');
    expect(buildPromptOptions).not.toHaveProperty('syspromptName');
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();

    const sentMessages = generateRequest.mock.calls[0][0].prompt;
    expect(sentMessages).toEqual([
      { role: 'system', content: 'Existing system prompt' },
      { role: 'system', content: 'Saved tracker system prompt' },
      { role: 'user', content: 'Prior chat message' },
      { role: 'system', content: 'Generate tracker JSON' },
    ]);
  });

  test('uses the chat metadata schema preset for full tracker generation', async () => {
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const generateRequest = makeGenerateRequest({ content: { weather: 'Rain' } });

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile()],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () =>
          makeSettings({
            schemaPreset: 'default',
            schemaPresets: {
              default: {
                name: 'Default',
                value: { type: 'object', properties: { time: { type: 'string' } }, required: ['time'] },
                html: '<div>default</div>',
              },
              alternate: {
                name: 'Alternate',
                value: { type: 'object', properties: { weather: { type: 'string' } }, required: ['weather'] },
                html: '<div>alternate</div>',
              },
            },
          }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    const context = SillyTavern.getContext() as any;
    context.chatMetadata = { zTracker: { schemaKey: 'alternate' } };

    await actions.generateTracker(0);

    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        trackerHtml: '<div>alternate</div>',
        extensionData: expect.objectContaining({
          schemaKey: 'alternate',
        }),
      }),
    );
  });

  test('persists normalized chat metadata when the stored schema preset is missing or stale', async () => {
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile()],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () => makeSettings(),
      } as any,
      generator: { generateRequest: makeGenerateRequest(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    const context = SillyTavern.getContext() as any;
    context.chatMetadata = { zTracker: { schemaKey: 'missing' } };
    context.saveMetadataDebounced = jest.fn();

    await actions.generateTracker(0);

    expect(context.chatMetadata).toEqual({ zTracker: { schemaKey: 'default' } });
    expect(context.saveMetadataDebounced).toHaveBeenCalledTimes(1);
  });

  test('passes the saved tracker system prompt through buildPrompt for textgenerationwebui profiles', async () => {
    const context = makeContext({ includeSavedPromptPreset: true });
    installSillyTavernContext(context);

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const generateRequest = makeGenerateRequest();

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile({ api: 'textgenerationwebui' })],
          },
        },
        CONNECT_API_MAP: { textgenerationwebui: { selected: 'textgenerationwebui' } },
      },
      settingsManager: { getSettings: () => makeSettings() } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    const buildPromptOptions = (buildPromptMock as jest.Mock).mock.calls[0][1];
    expect(buildPromptOptions).toHaveProperty('syspromptName', 'zTracker');
    expect(buildPromptOptions).toHaveProperty('includeNames', false);

    expect(generateRequest).not.toHaveBeenCalled();
    const sentMessages = (context.TextCompletionService.processRequest as jest.Mock).mock.calls[0][0].prompt;
    expect(sentMessages).toEqual([
      { role: 'system', content: 'Existing system prompt' },
      { role: 'user', content: 'Prior chat message' },
      { role: 'system', content: 'Generate tracker JSON' },
    ]);
  });

  test('normalizes user chat turns to assistant for chat-completion tracker generation when configured', async () => {
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const generateRequest = makeGenerateRequest();

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile()],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerGenerationConversationRoleMode: 'all_assistant' }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    const sentMessages = generateRequest.mock.calls[0][0].prompt;
    expect(sentMessages).toEqual([
      { role: 'system', content: 'Existing system prompt' },
      { role: 'system', content: 'Saved tracker system prompt' },
      { role: 'assistant', content: 'Prior chat message' },
      { role: 'system', content: 'Generate tracker JSON' },
    ]);
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('preserves embedded tracker snapshot roles while normalizing chat turns', async () => {
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    includeZTrackerMessagesMock.mockImplementationOnce((messages: Array<any>) => [
      ...messages,
      markEmbeddedTrackerSnapshot({
        role: 'user',
        content: 'Tracker:\n```json\n{"time":"09:00:00"}\n```',
      }),
    ]);
    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const generateRequest = makeGenerateRequest();

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile()],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerGenerationConversationRoleMode: 'all_assistant' }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    const sentMessages = generateRequest.mock.calls[0][0].prompt;
    expect(sentMessages).toEqual([
      { role: 'system', content: 'Existing system prompt' },
      { role: 'system', content: 'Saved tracker system prompt' },
      { role: 'assistant', content: 'Prior chat message' },
      {
        role: 'user',
        content: 'Tracker:\n```json\n{"time":"09:00:00"}\n```',
      },
      { role: 'system', content: 'Generate tracker JSON' },
    ]);
  });

  test('normalizes user chat turns to assistant before text-completion prompt sanitization when configured', async () => {
    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    installSillyTavernContext(makeContext());

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile({ api: 'textgenerationwebui' })],
          },
        },
        CONNECT_API_MAP: {
          textgenerationwebui: { selected: 'textgenerationwebui', type: 'textgenerationwebui' },
        },
      },
      settingsManager: {
        getSettings: () => makeSettings({
          trackerSystemPromptMode: 'profile',
          trackerGenerationConversationRoleMode: 'all_assistant',
        }),
      } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    expect(sanitizeMessagesForGenerationMock).toHaveBeenNthCalledWith(
      1,
      [
        { role: 'system', content: 'Existing system prompt' },
        { role: 'assistant', content: 'Prior chat message' },
        { role: 'system', content: 'Generate tracker JSON' },
      ],
      expect.objectContaining({
        userName: 'Tobias',
      }),
    );
    expect(sanitizeMessagesForGenerationMock).toHaveBeenNthCalledWith(
      2,
      [
        { role: 'system', content: 'Existing system prompt' },
        { role: 'assistant', content: 'Prior chat message' },
        { role: 'system', content: 'Generate tracker JSON' },
      ],
      expect.objectContaining({
        inlineNamesIntoContent: true,
        userName: 'Tobias',
      }),
    );
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('normalizes user chat turns during part regeneration when configured', async () => {
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));
    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const generateRequest = makeGenerateRequest({ content: { time: '10:00:00' } });

    document.body.innerHTML = [
      '<div id="extensionsMenu"></div>',
      '<div class="mes" mesid="0">',
      '<div class="ztracker-part-regenerate-button" data-ztracker-part="time"></div>',
      '<div class="mes_text"></div>',
      '</div>',
    ].join('');

    const actions = createTrackerActions({
      globalContext: {
        chat: [
          {
            original_avatar: 'avatar.png',
            extra: {
              zTracker: {
                schemaValue: { time: '09:00:00' },
                schemaHtml: '<div></div>',
              },
            },
          },
        ],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile()],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerGenerationConversationRoleMode: 'all_assistant' }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTrackerPart(0, 'time');

    const sentMessages = generateRequest.mock.calls[0][0].prompt;
    expect(sentMessages).toEqual(expect.arrayContaining([
      { role: 'assistant', content: 'Prior chat message' },
    ]));
    expect(sentMessages).not.toEqual(expect.arrayContaining([
      { role: 'user', content: 'Prior chat message' },
    ]));
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('keeps character-card prompt fields by default during tracker generation', async () => {
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const generateRequest = makeGenerateRequest();

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile()],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: { getSettings: () => makeSettings() } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    const buildPromptOptions = (buildPromptMock as jest.Mock).mock.calls[0][1];
    expect(buildPromptOptions).not.toHaveProperty('ignoreCharacterFields');
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('omits character-card prompt fields when the tracker-generation setting is enabled', async () => {
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const generateRequest = makeGenerateRequest();

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile()],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () => makeSettings({ skipCharacterCardInTrackerGeneration: true }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    expect(buildPromptMock).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({
        ignoreCharacterFields: true,
        ignoreWorldInfo: false,
      }),
    );
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('uses the active SillyTavern connection for chat APIs without requiring a saved profile id', async () => {
    const context = makeContext({
      extensionSettings: {
        connectionManager: {
          selectedProfile: {
            id: 'active-profile',
            api: 'openai',
            preset: 'Live Active Preset',
          },
        },
      },
      getPresetManager: () => ({
        getSelectedPresetName: () => 'Active Preset',
      }),
      mainApi: 'openai',
    });
    installSillyTavernContext(context);

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const generateRequest = makeGenerateRequest();

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile({ id: 'saved-profile', api: 'openai', preset: 'Saved Preset' })],
          },
        },
        CONNECT_API_MAP: {
          openai: { selected: 'openai' },
        },
      },
      settingsManager: {
        getSettings: () => makeSettings({ profileId: '', connectionSource: 'active', trackerSystemPromptMode: 'profile' }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    expect(buildPromptMock).toHaveBeenCalledWith('openai', expect.any(Object));
    expect((buildPromptMock as jest.Mock).mock.calls[0][1]).toHaveProperty('presetName', 'Active Preset');
    expect(generateRequest).toHaveBeenCalled();
    expect(generateRequest.mock.calls[0][0].profileId).toBe('active-profile');
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test.each([
    ['api-url', { 'api-url': 'http://live.example' }, 'http://live.example'],
    ['api_server', { api_server: 'http://live.example' }, 'http://live.example'],
    ['conflicting live and saved fields', { 'api-url': 'http://saved.example', api_server: 'http://live.example' }, 'http://live.example'],
  ])('uses the active SillyTavern connection for textgenerationwebui with %s server data without requiring a saved profile id', async (_serverField, serverValue, expectedApiServer) => {
    const textCompletionProcessRequest = jest.fn(async () => ({ content: { time: '10:00:00' } }));
    const context = makeContext({
      extensionSettings: {
        connectionManager: {
          selectedProfile: {
            id: 'active-text-profile',
            api: 'textgenerationwebui',
            model: 'live-model',
            ...serverValue,
          },
        },
      },
      mainApi: 'textgenerationwebui',
      powerUserSettings: {
        instruct: { preset: 'Active Instruct' },
        context: { preset: 'Active Context' },
        sysprompt: { name: 'Active Sysprompt' },
      },
      textCompletionProcessRequest,
    });
    installSillyTavernContext(context);

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile({ id: 'saved-profile', api: 'openai' })],
          },
        },
        CONNECT_API_MAP: {
          textgenerationwebui: { selected: 'textgenerationwebui', type: 'textgenerationwebui' },
        },
      },
      settingsManager: {
        getSettings: () => makeSettings({ profileId: '', connectionSource: 'active', trackerSystemPromptMode: 'profile' }),
      } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    const buildPromptOptions = (buildPromptMock as jest.Mock).mock.calls[0][1];
    expect(buildPromptOptions).toHaveProperty('instructName', 'Active Instruct');
    expect(buildPromptOptions).toHaveProperty('contextName', 'Active Context');
    expect(buildPromptOptions).toHaveProperty('syspromptName', 'Active Sysprompt');
    expect(textCompletionProcessRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        api_type: 'textgenerationwebui',
        model: 'live-model',
        api_server: expectedApiServer,
      }),
      expect.objectContaining({
        instructName: 'Active Instruct',
      }),
      true,
      expect.any(AbortSignal),
    );
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('resolves active textgenerationwebui connections even when the host API map uses an alias key', async () => {
    const textCompletionProcessRequest = jest.fn(async () => ({ content: { time: '10:00:00' } }));
    const context = makeContext({
      extensionSettings: {
        connectionManager: {
          selectedProfile: {
            id: 'active-text-profile',
            api: 'textgenerationwebui',
            model: 'live-model',
            'api-url': 'http://live.example',
          },
        },
      },
      mainApi: 'textgenerationwebui',
      textCompletionProcessRequest,
    });
    installSillyTavernContext(context);

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile({ id: 'saved-profile', api: 'openai' })],
          },
        },
        CONNECT_API_MAP: {
          text: { selected: 'textgenerationwebui', type: 'textgenerationwebui' },
        },
      },
      settingsManager: {
        getSettings: () => makeSettings({ profileId: '', connectionSource: 'active', trackerSystemPromptMode: 'profile' }),
      } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    expect(buildPromptMock).toHaveBeenCalledWith('textgenerationwebui', expect.any(Object));
    expect(textCompletionProcessRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        api_type: 'textgenerationwebui',
      }),
      expect.any(Object),
      true,
      expect.any(AbortSignal),
    );
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('ignores unusable direct api-map entries when a unique selected alias entry exists', async () => {
    const textCompletionProcessRequest = jest.fn(async () => ({ content: { time: '10:00:00' } }));
    const context = makeContext({
      extensionSettings: {
        connectionManager: {
          selectedProfile: {
            id: 'active-text-profile',
            api: 'textgenerationwebui',
          },
        },
      },
      mainApi: 'textgenerationwebui',
      textCompletionProcessRequest,
    });
    installSillyTavernContext(context);

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile({ id: 'saved-profile', api: 'openai' })],
          },
        },
        CONNECT_API_MAP: {
          textgenerationwebui: { type: 'textgenerationwebui' },
          text: { selected: 'textgenerationwebui', type: 'textgenerationwebui' },
        },
      },
      settingsManager: {
        getSettings: () => makeSettings({ profileId: '', connectionSource: 'active', trackerSystemPromptMode: 'profile' }),
      } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    expect(buildPromptMock).toHaveBeenCalledWith('textgenerationwebui', expect.any(Object));
    expect(textCompletionProcessRequest).toHaveBeenCalled();
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('resolves saved textgenerationwebui profiles even when the host API map uses an alias key', async () => {
    const textCompletionProcessRequest = jest.fn(async () => ({ content: { time: '10:00:00' } }));
    const context = makeContext({ textCompletionProcessRequest });
    installSillyTavernContext(context);

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile({ api: 'textgenerationwebui', model: 'saved-model', 'api-url': 'http://saved.example' })],
          },
        },
        CONNECT_API_MAP: {
          text: { selected: 'textgenerationwebui', type: 'textgenerationwebui' },
        },
      },
      settingsManager: {
        getSettings: () => makeSettings({ connectionSource: 'saved', profileId: 'profile-1', trackerSystemPromptMode: 'profile' }),
      } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    expect(buildPromptMock).toHaveBeenCalledWith('textgenerationwebui', expect.any(Object));
    expect(textCompletionProcessRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        api_type: 'textgenerationwebui',
        model: 'saved-model',
        api_server: 'http://saved.example',
      }),
      expect.any(Object),
      true,
      expect.any(AbortSignal),
    );
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('collapses multiple selected API-map aliases to the requested active connection family', async () => {
    const textCompletionProcessRequest = jest.fn(async () => ({ content: { time: '10:00:00' } }));
    const context = makeContext({
      extensionSettings: {
        connectionManager: {
          selectedProfile: {
            id: 'active-text-profile',
            api: 'textgenerationwebui',
            model: 'live-model',
            'api-url': 'http://live.example',
          },
        },
      },
      mainApi: 'textgenerationwebui',
      textCompletionProcessRequest,
    });
    installSillyTavernContext(context);
    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile({ id: 'saved-profile', api: 'openai' })],
          },
        },
        CONNECT_API_MAP: {
          textA: { selected: 'textgenerationwebui', type: 'textgenerationwebui' },
          textB: { selected: 'textgenerationwebui', type: 'textgenerationwebui' },
        },
      },
      settingsManager: {
        getSettings: () => makeSettings({ profileId: '', connectionSource: 'active', trackerSystemPromptMode: 'profile' }),
      } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    expect(buildPromptMock).toHaveBeenCalledWith('textgenerationwebui', expect.any(Object));
    expect(textCompletionProcessRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        api_type: 'textgenerationwebui',
        model: 'live-model',
        api_server: 'http://live.example',
      }),
      expect.any(Object),
      true,
      expect.any(AbortSignal),
    );
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('fails clearly when matching selected API-map aliases disagree on type', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const textCompletionProcessRequest = jest.fn(async () => ({ content: { time: '10:00:00' } }));
    const context = makeContext({ textCompletionProcessRequest });
    installSillyTavernContext(context);

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile({ api: 'textgenerationwebui', model: 'saved-model', 'api-url': 'http://saved.example' })],
          },
        },
        CONNECT_API_MAP: {
          textA: { selected: 'textgenerationwebui', type: 'koboldcpp' },
          textB: { selected: 'textgenerationwebui', type: 'openrouter-text' },
        },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerSystemPromptMode: 'profile' }),
      } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await expect(actions.generateTracker(0)).resolves.toBe(false);

    expect(buildPromptMock).not.toHaveBeenCalled();
    expect(textCompletionProcessRequest).not.toHaveBeenCalled();
    expect(stEchoMock).toHaveBeenCalledWith(
      'error',
      'Tracker generation failed: Conflicting SillyTavern API mapping types for tracker connection API: textgenerationwebui. Matching selected entries: textA (koboldcpp), textB (openrouter-text)',
    );

    consoleSpy.mockRestore();
  });

  test('uses the selected connection-manager profile id to resolve the active text-generation backend key before falling back to mainApi', async () => {
    const textCompletionProcessRequest = jest.fn(async () => ({ content: { time: '10:00:00' } }));
    const context = makeActiveTextRuntimeContext({
      profileOverrides: { api: 'koboldcpp' },
      textCompletionProcessRequest,
    });
    installSillyTavernContext(context);
    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());

    const actions = createActiveTrackerActions();

    await actions.generateTracker(0);

    expect(buildPromptMock).toHaveBeenCalledWith('textgenerationwebui', expect.any(Object));
    expect(textCompletionProcessRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        api_type: 'koboldcpp',
        model: 'live-model',
        api_server: 'http://live.example',
      }),
      expect.any(Object),
      true,
      expect.any(AbortSignal),
    );
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('uses textCompletionSettings.type to resolve the active text-generation backend when the runtime profile stays generic', async () => {
    const textCompletionProcessRequest = jest.fn(async () => ({ content: { time: '10:00:00' } }));
    const context = makeActiveTextRuntimeContext({
      profileOverrides: { sysprompt: 'Live Prompt' },
      textCompletionType: 'koboldcpp',
      textCompletionProcessRequest,
    });
    installSillyTavernContext(context);
    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());

    const actions = createActiveTrackerActions();

    await actions.generateTracker(0);

    expect(buildPromptMock).toHaveBeenCalledWith('textgenerationwebui', expect.any(Object));
    expect(textCompletionProcessRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        api_type: 'koboldcpp',
        model: 'live-model',
        api_server: 'http://live.example',
      }),
      expect.any(Object),
      true,
      expect.any(AbortSignal),
    );
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test.each([
    ['the runtime type is missing', undefined],
    ['the runtime type stays generic', 'textgenerationwebui'],
  ])('fails with a targeted error when %s', async (_label, textCompletionType) => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const textCompletionProcessRequest = jest.fn(async () => ({ content: { time: '10:00:00' } }));
    const context = makeActiveTextRuntimeContext({
      ...(textCompletionType !== undefined ? { textCompletionType } : {}),
      textCompletionProcessRequest,
    });
    installSillyTavernContext(context);

    const actions = createActiveTrackerActions({
      connectApiMap: {
        koboldcpp: { selected: 'textgenerationwebui', type: 'koboldcpp' },
        'openrouter-text': { selected: 'textgenerationwebui', type: 'openrouter' },
      },
    });

    await expect(actions.generateTracker(0)).resolves.toBe(false);

    expect(buildPromptMock).not.toHaveBeenCalled();
    expect(textCompletionProcessRequest).not.toHaveBeenCalled();
    expect(stEchoMock).toHaveBeenCalledWith(
      'error',
      'Tracker generation failed: Could not resolve the active SillyTavern text-generation backend. The live runtime only exposed the generic textgenerationwebui family without a concrete backend type. Select a saved zTracker connection profile or switch the active SillyTavern backend to one with a concrete runtime type.',
    );

    consoleSpy.mockRestore();
  });

  test.each([
    { api: 'openai', expectedSyspromptName: undefined, expectedContextName: undefined, expectedPresetName: 'Active Preset' },
    { api: 'textgenerationwebui', expectedSyspromptName: 'Neutral - Chat', expectedContextName: 'Active Context', expectedPresetName: undefined },
  ])(
    'uses the active runtime preset for chat APIs in profile mode and keeps text-completion prompt selectors active',
    async ({ api, expectedSyspromptName, expectedContextName, expectedPresetName }) => {
      installSillyTavernContext(makeContext({
        powerUserSettings: {
          ...(expectedContextName ? { context: { preset: expectedContextName } } : {}),
        },
        getPresetManager: () => ({
          getSelectedPresetName: () => 'Active Preset',
        }),
      }));

      buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
      const generateRequest = makeGenerateRequest();

      const actions = createTrackerActions({
        globalContext: {
          chat: [{ original_avatar: 'avatar.png', extra: {} }],
          saveChat: async () => undefined,
          extensionSettings: {
            connectionManager: {
              profiles: [makeProfile({ api, preset: 'Profile Preset', context: '   ', instruct: undefined, sysprompt: '   ' })],
            },
          },
          CONNECT_API_MAP: {
            [api]: { selected: api },
          },
        },
        settingsManager: {
          getSettings: () => makeSettings({ trackerSystemPromptMode: 'profile' }),
        } as any,
        generator: { generateRequest, abortRequest: jest.fn() } as any,
        pendingRequests: new Map(),
        renderTrackerWithDeps: renderTrackerWithDepsMock,
        importMetaUrl: TEST_IMPORT_META_URL,
      });

      await actions.generateTracker(0);

      expect(buildPromptMock).toHaveBeenCalledWith(api, expect.any(Object));
      const buildPromptOptions = (buildPromptMock as jest.Mock).mock.calls[0][1];
      if (expectedPresetName) {
        expect(buildPromptOptions).toHaveProperty('presetName', expectedPresetName);
      } else {
        expect(buildPromptOptions).not.toHaveProperty('presetName');
      }
      expect(buildPromptOptions).not.toHaveProperty('instructName');
      if (expectedContextName) {
        expect(buildPromptOptions).toHaveProperty('contextName', expectedContextName);
      } else {
        expect(buildPromptOptions).not.toHaveProperty('contextName');
      }
      if (expectedSyspromptName) {
        expect(buildPromptOptions).toHaveProperty('syspromptName', expectedSyspromptName);
      } else {
        expect(buildPromptOptions).not.toHaveProperty('syspromptName');
      }
      expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
    },
  );

  test.each([
    { api: 'openai', expectedPresetName: 'Selected Profile Prompt' },
    { api: 'textgenerationwebui', expectedPresetName: undefined },
  ])(
    'uses the selected connection profile preset for $api profiles only when supported',
    async ({ api, expectedPresetName }) => {
      installSillyTavernContext(makeContext());

      buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
      const generateRequest = makeGenerateRequest();

      const actions = createTrackerActions({
        globalContext: {
          chat: [{ original_avatar: 'avatar.png', extra: {} }],
          saveChat: async () => undefined,
          extensionSettings: {
            connectionManager: {
              profiles: [makeProfile({ api, preset: 'Selected Profile Prompt' })],
            },
          },
          CONNECT_API_MAP: {
            [api]: { selected: api },
          },
        },
        settingsManager: {
          getSettings: () => makeSettings({ trackerSystemPromptMode: 'selected' }),
        } as any,
        generator: { generateRequest, abortRequest: jest.fn() } as any,
        pendingRequests: new Map(),
        renderTrackerWithDeps: renderTrackerWithDepsMock,
        importMetaUrl: TEST_IMPORT_META_URL,
      });

      await actions.generateTracker(0);

      const buildPromptOptions = (buildPromptMock as jest.Mock).mock.calls[0][1];
      if (expectedPresetName) {
        expect(buildPromptOptions).toHaveProperty('presetName', expectedPresetName);
      } else {
        expect(buildPromptOptions).not.toHaveProperty('presetName');
      }
      expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
    },
  );

  test('uses the connection profile presets for textgenerationwebui in selected mode even when they differ from active presets', async () => {
    const powerUserSettings = {
      instruct: { preset: 'Active Instruct' },
      context: { preset: 'Active Context' },
      sysprompt: { name: 'Active Sysprompt' },
    };
    installSillyTavernContext(makeContext({ powerUserSettings }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const generateRequest = makeGenerateRequest();

    const api = 'textgenerationwebui';
    const profilePresets = {
      instruct: 'Profile Instruct',
      context: 'Profile Context',
      sysprompt: 'Profile Sysprompt',
    };

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile({ api, ...profilePresets })],
          },
        },
        CONNECT_API_MAP: {
          [api]: { selected: api },
        },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerSystemPromptMode: 'selected' }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    const buildPromptOptions = (buildPromptMock as jest.Mock).mock.calls[0][1];
    expect(buildPromptOptions).toHaveProperty('instructName', profilePresets.instruct);
    expect(buildPromptOptions).toHaveProperty('contextName', profilePresets.context);
    expect(buildPromptOptions).toHaveProperty('syspromptName', profilePresets.sysprompt);
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('uses the connection profile presetName for chat APIs in selected mode even when it differs from active sysprompt', async () => {
    const powerUserSettings = {
      sysprompt: { name: 'Active Sysprompt' },
    };
    installSillyTavernContext(makeContext({ powerUserSettings }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const generateRequest = makeGenerateRequest();

    const api = 'openai';
    const profilePreset = 'Profile Preset';

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile({ api, preset: profilePreset })],
          },
        },
        CONNECT_API_MAP: {
          [api]: { selected: api },
        },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerSystemPromptMode: 'selected' }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    const buildPromptOptions = (buildPromptMock as jest.Mock).mock.calls[0][1];
    expect(buildPromptOptions).toHaveProperty('presetName', profilePreset);
    // For chat APIs, syspromptName should be undefined because it's handled via presetName
    expect(buildPromptOptions).not.toHaveProperty('syspromptName');
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('omits syspromptName from buildPrompt when profile mode has no selected system prompt', async () => {
    installSillyTavernContext(makeContext());

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const generateRequest = makeGenerateRequest();

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile({ sysprompt: '   ' })],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerSystemPromptMode: 'profile' }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    const buildPromptOptions = (buildPromptMock as jest.Mock).mock.calls[0][1];
    expect(buildPromptOptions).not.toHaveProperty('syspromptName');
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test.each([
    { api: 'openai', expectedSelectedApi: 'openai', powerUserSettings: {}, expectedInstructName: undefined },
    {
      api: 'textgenerationwebui',
      expectedSelectedApi: 'textgenerationwebui',
      powerUserSettings: { instruct: { preset: 'Active Instruct' } },
      expectedInstructName: 'Active Instruct',
    },
  ])(
    'uses the active SillyTavern instruct preset for $api profiles',
    async ({ api, expectedSelectedApi, powerUserSettings, expectedInstructName }) => {
      installSillyTavernContext(makeContext({ powerUserSettings }));

      buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
      const generateRequest = makeGenerateRequest();

      const actions = createTrackerActions({
        globalContext: {
          chat: [{ original_avatar: 'avatar.png', extra: {} }],
          saveChat: async () => undefined,
          extensionSettings: {
            connectionManager: {
              profiles: [makeProfile({ api })],
            },
          },
          CONNECT_API_MAP: {
            [api]: { selected: expectedSelectedApi },
          },
        },
        settingsManager: {
          getSettings: () => makeSettings({ trackerSystemPromptMode: 'profile' }),
        } as any,
        generator: { generateRequest, abortRequest: jest.fn() } as any,
        pendingRequests: new Map(),
        renderTrackerWithDeps: renderTrackerWithDepsMock,
        importMetaUrl: TEST_IMPORT_META_URL,
      });

      await actions.generateTracker(0);

      const buildPromptOptions = (buildPromptMock as jest.Mock).mock.calls[0][1];
      if (expectedInstructName) {
        expect(buildPromptOptions).toHaveProperty('instructName', expectedInstructName);
      } else {
        expect(buildPromptOptions).not.toHaveProperty('instructName');
      }
      expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
    },
  );

  test('uses the active global system prompt for textgenerationwebui profile mode instead of the stored profile prompt', async () => {
    installSillyTavernContext(
      makeContext({
        powerUserSettings: {
          sysprompt: {
            name: 'Active System Prompt',
          },
        },
      }),
    );

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const generateRequest = makeGenerateRequest();

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile({ api: 'textgenerationwebui', sysprompt: 'Profile Prompt' })],
          },
        },
        CONNECT_API_MAP: {
          textgenerationwebui: { selected: 'textgenerationwebui' },
        },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerSystemPromptMode: 'profile' }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    const buildPromptOptions = (buildPromptMock as jest.Mock).mock.calls[0][1];
    expect(buildPromptOptions).toHaveProperty('syspromptName', 'Active System Prompt');
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('falls back to the active instruct preset for textgenerationwebui profiles when the profile leaves it unset', async () => {
    installSillyTavernContext(
      makeContext({
        powerUserSettings: {
          instruct: {
            preset: 'Active Instruct',
          },
        },
      }),
    );

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const generateRequest = makeGenerateRequest();

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile({ api: 'textgenerationwebui', instruct: '   ' })],
          },
        },
        CONNECT_API_MAP: {
          textgenerationwebui: { selected: 'textgenerationwebui' },
        },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerSystemPromptMode: 'profile' }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    const buildPromptOptions = (buildPromptMock as jest.Mock).mock.calls[0][1];
    expect(buildPromptOptions).toHaveProperty('instructName', 'Active Instruct');
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('passes the active instruct preset to textgenerationwebui request transport without mutating the shared profile', async () => {
    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const profile = makeProfile({ api: 'textgenerationwebui', instruct: 'Profile Instruct' });
    let instructOptionDuringRequest: string | undefined;
    let profileInstructDuringRequest: string | undefined;
    const textCompletionProcessRequest = jest.fn(async (_requestData: unknown, requestOptions: { instructName?: string }) => {
      instructOptionDuringRequest = requestOptions.instructName;
      profileInstructDuringRequest = profile.instruct;
      return { content: { time: '10:00:00' } };
    });
    installSillyTavernContext(
      makeContext({
        powerUserSettings: {
          instruct: {
            preset: 'Active Instruct',
          },
        },
        textCompletionProcessRequest,
      }),
    );

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [profile],
          },
        },
        CONNECT_API_MAP: {
          textgenerationwebui: { selected: 'textgenerationwebui', type: 'textgenerationwebui' },
        },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerSystemPromptMode: 'profile' }),
      } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    const buildPromptOptions = (buildPromptMock as jest.Mock).mock.calls[0][1];
    expect(buildPromptOptions).toHaveProperty('instructName', 'Active Instruct');
    expect(textCompletionProcessRequest).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), true, expect.any(AbortSignal));
    expect((textCompletionProcessRequest as jest.Mock).mock.calls[0][1]).toMatchObject({
      instructName: 'Active Instruct',
    });
    expect((textCompletionProcessRequest as jest.Mock).mock.calls[0][1]).not.toHaveProperty('presetName');
    expect(instructOptionDuringRequest).toBe('Active Instruct');
    expect(profileInstructDuringRequest).toBe('Profile Instruct');
    expect(profile.instruct).toBe('Profile Instruct');
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('passes the active context preset to textgenerationwebui prompt assembly', async () => {
    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    installSillyTavernContext(
      makeContext({
        powerUserSettings: {
          context: {
            preset: 'Active Context',
          },
        },
      }),
    );

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile({ api: 'textgenerationwebui', context: 'Profile Context' })],
          },
        },
        CONNECT_API_MAP: {
          textgenerationwebui: { selected: 'textgenerationwebui', type: 'textgenerationwebui' },
        },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerSystemPromptMode: 'profile' }),
      } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    const buildPromptOptions = (buildPromptMock as jest.Mock).mock.calls[0][1];
    expect(buildPromptOptions).toHaveProperty('contextName', 'Active Context');
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('passes the active instruct preset to field-level textgenerationwebui regeneration requests', async () => {
    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const profile = makeProfile({ api: 'textgenerationwebui', instruct: 'Profile Instruct' });
    let instructOptionDuringRequest: string | undefined;
    const originalStructuredClone = globalThis.structuredClone;
    globalThis.structuredClone = originalStructuredClone ?? ((value: unknown) => JSON.parse(JSON.stringify(value)));
    const textCompletionProcessRequest = jest.fn(async (_requestData: unknown, requestOptions: { instructName?: string }) => {
      instructOptionDuringRequest = requestOptions.instructName;
      return { content: { value: 'updated status' } };
    });
    installSillyTavernContext(
      makeContext({
        powerUserSettings: {
          instruct: {
            preset: 'Active Instruct',
          },
        },
        textCompletionProcessRequest,
      }),
    );

    const actions = createTrackerActions({
      globalContext: {
        chat: [
          {
            original_avatar: 'avatar.png',
            extra: {
              zTracker: {
                schemaValue: {
                  characters: [{ name: 'Alice', status: 'old status' }],
                },
              },
            },
          },
        ],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [profile],
          },
        },
        CONNECT_API_MAP: {
          textgenerationwebui: { selected: 'textgenerationwebui', type: 'textgenerationwebui' },
        },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerSystemPromptMode: 'profile' }),
      } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    try {
      await actions.generateTrackerArrayItemField(0, 'characters', 0, 'status');
    } finally {
      globalThis.structuredClone = originalStructuredClone;
    }

    expect(textCompletionProcessRequest).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), true, expect.any(AbortSignal));
    expect((textCompletionProcessRequest as jest.Mock).mock.calls[0][1]).toMatchObject({
      instructName: 'Active Instruct',
    });
    expect(instructOptionDuringRequest).toBe('Active Instruct');
    expect(profile.instruct).toBe('Profile Instruct');
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('regenerates an array item by name through the context-menu locator path', async () => {
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const generateRequest = makeGenerateRequest({
      content: {
        item: {
          name: 'Alice',
          status: 'updated status',
        },
      },
    });
    (trackerPartsModule.findArrayItemIndexByName as jest.Mock).mockReturnValue(0);
    (trackerPartsModule.buildArrayItemSchema as jest.Mock).mockReturnValue({
      type: 'object',
      properties: {
        item: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            status: { type: 'string' },
          },
          required: ['name', 'status'],
        },
      },
      required: ['item'],
    });
    (trackerPartsModule.redactTrackerArrayItemValue as jest.Mock).mockImplementation((tracker) => tracker);
    (trackerPartsModule.replaceTrackerArrayItem as jest.Mock).mockImplementation((tracker, partKey, index, item) => ({
      ...tracker,
      [partKey]: (tracker?.[partKey] ?? []).map((entry: unknown, entryIndex: number) =>
        entryIndex === index ? item : entry,
      ),
    }));

    const actions = createTrackerActions({
      globalContext: {
        chat: [
          {
            original_avatar: 'avatar.png',
            extra: {
              zTracker: {
                schemaValue: {
                  characters: [{ name: 'Alice', status: 'old status' }],
                },
                schemaHtml: '<div></div>',
              },
            },
          },
        ],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile()],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: { getSettings: () => makeSettings() } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTrackerArrayItemByName(0, 'characters', 'Alice');

    expect(trackerPartsModule.findArrayItemIndexByName).toHaveBeenCalledWith(
      [{ name: 'Alice', status: 'old status' }],
      'Alice',
    );
    expect(trackerPartsModule.replaceTrackerArrayItem).toHaveBeenCalledWith(
      { characters: [{ name: 'Alice', status: 'old status' }] },
      'characters',
      0,
      { name: 'Alice', status: 'updated status' },
    );
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        trackerData: { characters: [{ name: 'Alice', status: 'updated status' }] },
      }),
    );
  });

  test('regenerates an array-item field by identity through the context-menu locator path', async () => {
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const generateRequest = makeGenerateRequest({
      content: {
        value: 'updated status',
      },
    });
    const originalStructuredClone = globalThis.structuredClone;
    globalThis.structuredClone = originalStructuredClone ?? ((value: unknown) => JSON.parse(JSON.stringify(value)));
    (trackerPartsModule.getArrayItemIdentityKey as jest.Mock).mockReturnValue('id');
    (trackerPartsModule.findArrayItemIndexByIdentity as jest.Mock).mockReturnValue(0);
    (trackerPartsModule.buildArrayItemFieldSchema as jest.Mock).mockReturnValue({
      type: 'object',
      properties: {
        value: { type: 'string' },
      },
      required: ['value'],
    });
    (trackerPartsModule.redactTrackerArrayItemFieldValue as jest.Mock).mockImplementation((tracker) => tracker);
    (trackerPartsModule.replaceTrackerArrayItemField as jest.Mock).mockImplementation((tracker, partKey, index, fieldKey, value) => ({
      ...tracker,
      [partKey]: (tracker?.[partKey] ?? []).map((entry: Record<string, unknown>, entryIndex: number) =>
        entryIndex === index ? { ...entry, [fieldKey]: value } : entry,
      ),
    }));

    const actions = createTrackerActions({
      globalContext: {
        chat: [
          {
            original_avatar: 'avatar.png',
            extra: {
              zTracker: {
                schemaValue: {
                  characters: [{ id: 'char-1', name: 'Alice', status: 'old status' }],
                },
                schemaHtml: '<div></div>',
              },
            },
          },
        ],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile()],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: { getSettings: () => makeSettings() } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    try {
      await actions.generateTrackerArrayItemFieldByIdentity(0, 'characters', 'id', 'char-1', 'status');
    } finally {
      globalThis.structuredClone = originalStructuredClone;
    }

    expect(trackerPartsModule.findArrayItemIndexByIdentity).toHaveBeenCalledWith(
      [{ id: 'char-1', name: 'Alice', status: 'old status' }],
      'id',
      'char-1',
    );
    expect(trackerPartsModule.replaceTrackerArrayItemField).toHaveBeenCalledWith(
      { characters: [{ id: 'char-1', name: 'Alice', status: 'old status' }] },
      'characters',
      0,
      'status',
      'updated status',
    );
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        trackerData: { characters: [{ id: 'char-1', name: 'Alice', status: 'updated status' }] },
      }),
    );
  });

  test('clears stale profile instruct transport state by omitting the request-local instruct preset when none is active', async () => {
    const textCompletionProcessRequest = jest.fn(async () => ({ content: { time: '10:00:00' } }));
    installSillyTavernContext(makeContext({ textCompletionProcessRequest }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const profile = makeProfile({ api: 'textgenerationwebui', instruct: 'Profile Instruct' });

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [profile],
          },
        },
        CONNECT_API_MAP: {
          textgenerationwebui: { selected: 'textgenerationwebui', type: 'textgenerationwebui' },
        },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerSystemPromptMode: 'profile' }),
      } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    const buildPromptOptions = (buildPromptMock as jest.Mock).mock.calls[0][1];
    expect(buildPromptOptions).not.toHaveProperty('instructName');
    expect(textCompletionProcessRequest).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), true, expect.any(AbortSignal));
    expect((textCompletionProcessRequest as jest.Mock).mock.calls[0][1]).not.toHaveProperty('instructName');
    expect((textCompletionProcessRequest as jest.Mock).mock.calls[0][1]).toMatchObject({
      instructSettings: {},
    });
    expect((textCompletionProcessRequest as jest.Mock).mock.calls[0][1]).not.toHaveProperty('presetName');
    expect(profile.instruct).toBe('Profile Instruct');
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('calls textgenerationwebui request transport with the live service as its this-context', async () => {
    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const createRequestData = jest.fn((requestData: Record<string, unknown>) => requestData);
    const processRequest = jest.fn(function (this: { createRequestData: typeof createRequestData }, requestData: Record<string, unknown>) {
      this.createRequestData(requestData);
      return Promise.resolve({ content: { time: '10:00:00' } });
    });
    const context = makeContext();
    context.TextCompletionService = {
      createRequestData,
      processRequest,
    };
    installSillyTavernContext(context);

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile({ api: 'textgenerationwebui' })],
          },
        },
        CONNECT_API_MAP: {
          textgenerationwebui: { selected: 'textgenerationwebui', type: 'textgenerationwebui' },
        },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerSystemPromptMode: 'profile' }),
      } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    expect(createRequestData).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.any(Array),
    }));
    expect((processRequest as jest.Mock).mock.contexts[0]).toBe(context.TextCompletionService);
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('passes the active user-alignment message into textgenerationwebui prompt sanitization', async () => {
    buildPromptMock.mockResolvedValue({
      result: [
        { role: 'system', content: 'Existing system prompt' },
        { role: 'assistant', content: 'Opening reply', name: 'Bar' },
      ],
    });
    installSillyTavernContext(
      makeContext({
        powerUserSettings: {
          instruct: {
            preset: 'Active Instruct',
            user_alignment_message: 'Let\'s get started. Please respond based on the information and instructions provided above.',
          },
        },
      }),
    );

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile({ api: 'textgenerationwebui' })],
          },
        },
        CONNECT_API_MAP: {
          textgenerationwebui: { selected: 'textgenerationwebui', type: 'textgenerationwebui' },
        },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerSystemPromptMode: 'profile' }),
      } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    expect(sanitizeMessagesForGenerationMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        inlineNamesIntoContent: true,
        userAlignmentMessage: 'Let\'s get started. Please respond based on the information and instructions provided above.',
        userName: 'Tobias',
      }),
    );
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('wraps leading text-completion system messages through the active story string before sending tracker requests', async () => {
    buildPromptMock.mockResolvedValue({
      result: [
        { role: 'system', content: 'Existing system prompt' },
        { role: 'user', content: 'Prior chat message', name: 'Tobias' },
        { role: 'assistant', content: 'Prior assistant reply', name: 'Bar' },
      ],
    });
    const textCompletionConstructPrompt = jest.fn((prompt: Array<{ role: string; content: string; name?: string }>) => {
      const dialogueMessages = prompt.filter((message) => message.role !== 'system');
      const trailingSystemMessages = prompt.filter((message) => message.role === 'system');
      const dialogueBody = dialogueMessages.map((message) => `${message.name ?? message.role}:${message.content}`).join(' | ');
      const systemTail = trailingSystemMessages.map((message) => message.content).join('\n\n');
      return `BODY:${dialogueBody}${systemTail ? `\n\n${systemTail}` : ''}`;
    });
    const textCompletionCreateRequestData = jest.fn((requestData: Record<string, unknown>) => requestData);
    const textCompletionSendRequest = jest.fn(async () => ({ content: { time: '10:00:00' } }));
    const textCompletionStoryStringFormatterLoader = jest.fn(async () => ({
      renderStoryString: (params: Record<string, unknown>) => `SYSTEM:${String(params.system ?? '')}`,
      formatInstructModeStoryString: (storyString: string) => `WRAPPED:${storyString}`,
      getInstructStoppingSequences: () => ['</s>'],
    }));
    installSillyTavernContext(
      makeContext({
        powerUserSettings: {
          instruct: {
            preset: 'Active Instruct',
            story_string_prefix: '[INST]',
            story_string_suffix: '[/INST]Understood.</s>',
          },
          context: {
            preset: 'Active Context',
            story_string: '{{#if system}}{{system}}{{/if}}',
            story_string_position: 0,
          },
        },
        textCompletionConstructPrompt,
        textCompletionCreateRequestData,
        textCompletionSendRequest,
      }),
    );

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile({ api: 'textgenerationwebui' })],
          },
        },
        CONNECT_API_MAP: {
          textgenerationwebui: { selected: 'textgenerationwebui', type: 'textgenerationwebui' },
        },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerSystemPromptMode: 'profile' }),
      } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
      textCompletionStoryStringFormatterLoader,
    });

    await actions.generateTracker(0);

    expect(sanitizeMessagesForGenerationMock).toHaveBeenCalledTimes(2);
    expect((sanitizeMessagesForGenerationMock as jest.Mock).mock.calls[0][1]).toEqual(expect.objectContaining({
      userName: 'Tobias',
    }));
    expect((sanitizeMessagesForGenerationMock as jest.Mock).mock.calls[0][1]).not.toHaveProperty('inlineNamesIntoContent');
    expect((sanitizeMessagesForGenerationMock as jest.Mock).mock.calls[1][1]).toEqual(expect.objectContaining({
      inlineNamesIntoContent: true,
      userName: 'Tobias',
    }));
    expect(textCompletionStoryStringFormatterLoader).toHaveBeenCalled();
    expect(textCompletionConstructPrompt).toHaveBeenCalledWith(
      [
        { role: 'user', content: 'Prior chat message', name: 'Tobias' },
        { role: 'assistant', content: 'Prior assistant reply', name: 'Bar' },
        { role: 'system', content: 'Generate tracker JSON' },
      ],
      expect.objectContaining({
        preset: 'Active Instruct',
      }),
      {},
    );
    expect(textCompletionCreateRequestData).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'WRAPPED:SYSTEM:Existing system prompt\nBODY:Tobias:Prior chat message | Bar:Prior assistant reply\n\nGenerate tracker JSON',
      stop: ['</s>'],
      stopping_strings: ['</s>'],
    }));
    expect(textCompletionSendRequest).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'WRAPPED:SYSTEM:Existing system prompt\nBODY:Tobias:Prior chat message | Bar:Prior assistant reply\n\nGenerate tracker JSON',
    }), true, expect.any(AbortSignal));
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('uses the resolved active text-generation backend for wrapped text-completion tracker requests when the runtime profile stays generic', async () => {
    buildPromptMock.mockResolvedValue({
      result: [
        { role: 'system', content: 'Existing system prompt' },
        { role: 'user', content: 'Prior chat message', name: 'Tobias' },
      ],
    });
    const textCompletionConstructPrompt = jest.fn((prompt: Array<{ role: string; content: string; name?: string }>) => {
      const dialogueBody = prompt.map((message) => `${message.name ?? message.role}:${message.content}`).join(' | ');
      return `BODY:${dialogueBody}`;
    });
    const textCompletionCreateRequestData = jest.fn((requestData: Record<string, unknown>) => requestData);
    const textCompletionSendRequest = jest.fn(async () => ({ content: { time: '10:00:00' } }));
    const textCompletionStoryStringFormatterLoader = jest.fn(async () => ({
      renderStoryString: (params: Record<string, unknown>) => `SYSTEM:${String(params.system ?? '')}`,
      formatInstructModeStoryString: (storyString: string) => `WRAPPED:${storyString}`,
      getInstructStoppingSequences: () => ['</s>'],
    }));
    const context = makeActiveTextRuntimeContext({
      textCompletionType: 'koboldcpp',
      powerUserSettings: {
        instruct: {
          preset: 'Active Instruct',
          story_string_prefix: '[INST]',
          story_string_suffix: '[/INST]Understood.</s>',
        },
        context: {
          preset: 'Active Context',
          story_string: '{{#if system}}{{system}}{{/if}}',
          story_string_position: 0,
        },
      },
      textCompletionConstructPrompt,
      textCompletionCreateRequestData,
      textCompletionSendRequest,
    });
    installSillyTavernContext(context);

    const actions = createActiveTrackerActions({ textCompletionStoryStringFormatterLoader });

    await actions.generateTracker(0);

    expect(buildPromptMock).toHaveBeenCalledWith('textgenerationwebui', expect.any(Object));
    expect(textCompletionCreateRequestData).toHaveBeenCalledWith(expect.objectContaining({
      api_type: 'koboldcpp',
      api_server: 'http://live.example',
      model: 'live-model',
    }));
    expect(textCompletionSendRequest).toHaveBeenCalledWith(expect.objectContaining({
      api_type: 'koboldcpp',
    }), true, expect.any(AbortSignal));
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('does not ask buildPrompt to pre-inline speaker names for text-completion tracker prompts', async () => {
    installSillyTavernContext(makeContext());

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile({ api: 'textgenerationwebui' })],
          },
        },
        CONNECT_API_MAP: {
          textgenerationwebui: { selected: 'textgenerationwebui', type: 'textgenerationwebui' },
        },
      },
      settingsManager: { getSettings: () => makeSettings({ trackerSystemPromptMode: 'profile' }) } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    expect(buildPromptMock).toHaveBeenCalledWith(
      'textgenerationwebui',
      expect.objectContaining({
        includeNames: false,
      }),
    );
  });
});
