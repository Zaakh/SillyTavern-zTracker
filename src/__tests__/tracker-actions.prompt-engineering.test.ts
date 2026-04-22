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
  parseResponse,
  PromptEngineeringMode,
  renderTrackerWithDepsMock,
  resetTrackerActionTestState,
  schemaToExample,
  schemaToPromptSchema,
  TEST_IMPORT_META_URL,
} from '../test-utils/tracker-actions-test-helpers.js';

describe('createTrackerActions prompt engineering', () => {
  beforeEach(() => {
    resetTrackerActionTestState();
  });

  test('logs malformed prompt-engineered payloads when parsing fails', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    (schemaToExample as jest.Mock).mockReturnValue('time\tstring');
    (schemaToPromptSchema as jest.Mock).mockReturnValue('type: object');
    (parseResponse as jest.Mock).mockImplementation(() => {
      throw new Error('Model response is not valid TOON.');
    });
    const generateRequest = makeGenerateRequest({ content: '```toon\nnot valid\n```' });

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
        getSettings: () => makeSettings({
          promptEngineeringMode: PromptEngineeringMode.TOON,
          promptToon: 'TOON TEMPLATE\n{{example_response}}',
        }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'zTracker: malformed prompt-engineered payload',
      expect.objectContaining({
        format: 'toon',
        reason: 'parse failure',
        rawContent: '```toon\nnot valid\n```',
      }),
    );

    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test('logs malformed prompt-engineered payloads when parsed data fails strict rendering', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const parsedPayload = {
      time: '10:00:00',
      charactersPresent: ['Silvia', 'Tobias'],
      characters: [{ name: 'Silvia' }],
    };
    (schemaToExample as jest.Mock).mockReturnValue('time\tstring');
    (schemaToPromptSchema as jest.Mock).mockReturnValue('type: object');
    (parseResponse as jest.Mock).mockReturnValue(parsedPayload);
    applyTrackerUpdateAndRenderMock.mockImplementation(() => {
      throw new Error('render failed');
    });
    const generateRequest = makeGenerateRequest({ content: '```toon\ncharactersPresent[2]: "Silvia"\t"Tobias"\n```' });

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
        getSettings: () => makeSettings({
          promptEngineeringMode: PromptEngineeringMode.TOON,
          promptToon: 'TOON TEMPLATE\n{{example_response}}',
        }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'zTracker: malformed prompt-engineered payload',
      expect.objectContaining({
        format: 'toon',
        reason: 'render rollback',
        rawContent: '```toon\ncharactersPresent[2]: "Silvia"\t"Tobias"\n```',
        parsedContent: parsedPayload,
      }),
    );

    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test('uses TOON prompt-engineering mode when selected', async () => {
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    (schemaToExample as jest.Mock).mockReturnValue('time\tstring');
    (schemaToPromptSchema as jest.Mock).mockReturnValue('type: object\nproperties:\n  time:\n    type: string');
    (parseResponse as jest.Mock).mockReturnValue({ time: '10:00:00' });
    const generateRequest = makeGenerateRequest({ content: '```toon\ntime\t10:00:00\n```' });

    const toonSettings = makeSettings({
      promptEngineeringMode: PromptEngineeringMode.TOON,
      promptToon: 'TOON TEMPLATE\n{{example_response}}',
    });

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
      settingsManager: { getSettings: () => toonSettings } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    expect(schemaToExample).toHaveBeenCalledWith(toonSettings.schemaPresets.default.value, 'toon');
    expect(schemaToPromptSchema).toHaveBeenCalledWith(toonSettings.schemaPresets.default.value, 'toon');
    expect(parseResponse).toHaveBeenCalledWith('```toon\ntime\t10:00:00\n```', 'toon', {
      schema: toonSettings.schemaPresets.default.value,
    });

    const sentMessages = generateRequest.mock.calls[0][0].prompt;
    expect(sentMessages.at(-1)).toEqual({
      role: 'system',
      content: 'TOON TEMPLATE\ntime\tstring',
    });
    expect(sentMessages.at(-2)).toEqual({ role: 'user', content: 'Prior chat message' });
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('normalizes user chat turns before prompt-engineered JSON tracker generation when configured', async () => {
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    (schemaToExample as jest.Mock).mockReturnValue('{"time":"10:00:00"}');
    (schemaToPromptSchema as jest.Mock).mockReturnValue('{"type":"object"}');
    (parseResponse as jest.Mock).mockReturnValue({ time: '10:00:00' });
    const generateRequest = makeGenerateRequest({ content: '```json\n{"time":"10:00:00"}\n```' });

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
        getSettings: () => makeSettings({
          promptEngineeringMode: PromptEngineeringMode.JSON,
          promptJson: 'JSON TEMPLATE\n{{schema}}\n{{example_response}}',
          trackerGenerationConversationRoleMode: 'all_assistant',
        }),
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
      { role: 'system', content: 'JSON TEMPLATE\n{"type":"object"}\n{"time":"10:00:00"}' },
    ]);
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('injects the translated XML schema instead of raw JSON when XML prompt-engineering is selected', async () => {
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    (schemaToExample as jest.Mock).mockReturnValue('<time>string</time>');
    (schemaToPromptSchema as jest.Mock).mockReturnValue('<type>object</type>');
    (parseResponse as jest.Mock).mockReturnValue({ time: '10:00:00' });
    const generateRequest = makeGenerateRequest({ content: '```xml\n<root><time>10:00:00</time></root>\n```' });

    const xmlSettings = makeSettings({
      promptEngineeringMode: PromptEngineeringMode.XML,
      promptXml: 'XML TEMPLATE\n{{schema}}\n{{example_response}}',
    });

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
      settingsManager: { getSettings: () => xmlSettings } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    const sentMessages = generateRequest.mock.calls[0][0].prompt;
    expect(sentMessages.at(-1)).toEqual({
      role: 'system',
      content: 'XML TEMPLATE\n<type>object</type>\n<time>string</time>',
    });
    expect(sentMessages.at(-1).content).not.toContain('{\n  "type"');
  });
});
