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
} from './tracker-actions-test-helpers.js';

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
        syspromptName: undefined,
      }),
    );
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();

    const sentMessages = generateRequest.mock.calls[0][0].prompt;
    expect(sentMessages).toEqual([
      { role: 'system', content: 'Existing system prompt' },
      { role: 'system', content: 'Saved tracker system prompt' },
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

  test.each(['openai', 'textgenerationwebui'])(
    'omits undefined preset slots from buildPrompt for %s profiles',
    async (api) => {
      installSillyTavernContext(makeContext());

      buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
      const generateRequest = makeGenerateRequest();

      const actions = createTrackerActions({
        globalContext: {
          chat: [{ original_avatar: 'avatar.png', extra: {} }],
          saveChat: async () => undefined,
          extensionSettings: {
            connectionManager: {
              profiles: [makeProfile({ api, preset: undefined, context: '   ', instruct: undefined })],
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
      expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
    },
  );

  test.each([
    { api: 'openai', expectedSelectedApi: 'openai', shouldIncludeInstruct: false },
    { api: 'textgenerationwebui', expectedSelectedApi: 'textgenerationwebui', shouldIncludeInstruct: true },
  ])(
    'only forwards instructName to buildPrompt when SillyTavern uses text completion for $api profiles',
    async ({ api, expectedSelectedApi, shouldIncludeInstruct }) => {
      installSillyTavernContext(makeContext());

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
      if (shouldIncludeInstruct) {
        expect(buildPromptOptions).toHaveProperty('instructName', 'instruct-1');
      } else {
        expect(buildPromptOptions).not.toHaveProperty('instructName');
      }
      expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
    },
  );
});
