/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import {
  applyTrackerUpdateAndRenderMock,
  buildPromptMock,
  createTrackerActions,
  installSillyTavernContext,
  makeBuiltPromptResult,
  makeContext,
  makeGenerateRequest,
  makeProfile,
  makeSettings,
  renderTrackerWithDepsMock,
  resetTrackerActionTestState,
  TEST_IMPORT_META_URL,
} from '../test-utils/tracker-actions-test-helpers.js';

describe('createTrackerActions prompt assembly', () => {
  beforeEach(() => {
    resetTrackerActionTestState();
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
      { role: 'user', content: 'Generate tracker JSON' },
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

    expect(generateRequest).not.toHaveBeenCalled();
    const sentMessages = (context.TextCompletionService.processRequest as jest.Mock).mock.calls[0][0].prompt;
    expect(sentMessages).toEqual([
      { role: 'system', content: 'Existing system prompt' },
      { role: 'user', content: 'Prior chat message' },
      { role: 'user', content: 'Generate tracker JSON' },
    ]);
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
    expect(textCompletionProcessRequest).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        instructName: 'Active Instruct',
        presetName: profile.preset,
      }),
      true,
      expect.any(AbortSignal),
    );
    expect(instructOptionDuringRequest).toBe('Active Instruct');
    expect(profileInstructDuringRequest).toBe('Profile Instruct');
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
    expect(textCompletionProcessRequest).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        instructName: undefined,
        presetName: profile.preset,
      }),
      true,
      expect.any(AbortSignal),
    );
    expect(profile.instruct).toBe('Profile Instruct');
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });
});
