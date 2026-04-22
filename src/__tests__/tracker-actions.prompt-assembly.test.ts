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
  TEST_IMPORT_META_URL,
} from '../test-utils/tracker-actions-test-helpers.js';

describe('createTrackerActions prompt assembly', () => {
  const originalCss = globalThis.CSS;

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
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true, powerUserSettings }));

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

    expect(powerUserSettings.prefer_character_prompt).toBe(true);
    expect(buildPromptMock).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({
        includeNames: true,
      }),
    );
    const buildPromptOptions = (buildPromptMock as jest.Mock).mock.calls[0][1];
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

  test.each([
    { api: 'openai', expectedSyspromptName: undefined },
    { api: 'textgenerationwebui', expectedSyspromptName: 'Neutral - Chat' },
  ])(
    'omits stored preset/context slots and uses active runtime prompt state for $api profiles',
    async ({ api, expectedSyspromptName }) => {
      installSillyTavernContext(makeContext());

      buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
      const generateRequest = makeGenerateRequest();

      const actions = createTrackerActions({
        globalContext: {
          chat: [{ original_avatar: 'avatar.png', extra: {} }],
          saveChat: async () => undefined,
          extensionSettings: {
            connectionManager: {
              profiles: [makeProfile({ api, preset: undefined, context: '   ', instruct: undefined, sysprompt: '   ' })],
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
      expect(buildPromptOptions).not.toHaveProperty('presetName');
      expect(buildPromptOptions).not.toHaveProperty('contextName');
      expect(buildPromptOptions).not.toHaveProperty('instructName');
      if (expectedSyspromptName) {
        expect(buildPromptOptions).toHaveProperty('syspromptName', expectedSyspromptName);
      } else {
        expect(buildPromptOptions).not.toHaveProperty('syspromptName');
      }
      expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
    },
  );

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
