/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';

const buildPromptMock = jest.fn<() => Promise<{ result: Array<{ role: string; content: string }> }>>();
const applyTrackerUpdateAndRenderMock = jest.fn();
const renderTrackerWithDepsMock = jest.fn();
const stEchoMock = jest.fn();

jest.unstable_mockModule('sillytavern-utils-lib', () => ({
  buildPrompt: buildPromptMock,
  Generator: class GeneratorMock {},
  getWorldInfos: jest.fn(),
  Message: class MessageMock {},
}));

jest.unstable_mockModule('sillytavern-utils-lib/config', () => ({
  characters: [],
  selected_group: false,
  st_echo: stEchoMock,
}));

jest.unstable_mockModule('sillytavern-utils-lib/types/popup', () => ({
  POPUP_RESULT: { AFFIRMATIVE: 'affirmative' },
  POPUP_TYPE: { CONFIRM: 'confirm' },
}));

jest.unstable_mockModule('../parser.js', () => ({
  parseResponse: jest.fn(),
}));

jest.unstable_mockModule('../schema-to-example.js', () => ({
  schemaToExample: jest.fn(),
  schemaToPromptSchema: jest.fn(),
}));

jest.unstable_mockModule('../world-info-policy.js', () => ({
  shouldIgnoreWorldInfoDuringTrackerBuild: jest.fn(() => false),
}));

jest.unstable_mockModule('../world-info-allowlist.js', () => ({
  buildAllowlistedWorldInfoText: jest.fn(),
}));

jest.unstable_mockModule('../sillytavern-world-info.js', () => ({
  loadWorldInfoBookByName: jest.fn(),
}));

jest.unstable_mockModule('../tracker.js', () => ({
  applyTrackerUpdateAndRender: applyTrackerUpdateAndRenderMock,
  CHAT_METADATA_SCHEMA_PRESET_KEY: 'schemaPreset',
  CHAT_MESSAGE_SCHEMA_HTML_KEY: 'schemaHtml',
  CHAT_MESSAGE_SCHEMA_VALUE_KEY: 'schemaValue',
  CHAT_MESSAGE_PARTS_ORDER_KEY: 'partsOrder',
  includeZTrackerMessages: jest.fn((messages: Array<unknown>) => [...messages]),
  sanitizeMessagesForGeneration: jest.fn((messages: Array<unknown>) => [...messages]),
}));

jest.unstable_mockModule('../tracker-parts.js', () => ({
  buildArrayItemFieldSchema: jest.fn(),
  buildArrayItemSchema: jest.fn(),
  buildTopLevelPartSchema: jest.fn(),
  findArrayItemIndexByIdentity: jest.fn(),
  findArrayItemIndexByName: jest.fn(),
  getArrayItemIdentityKey: jest.fn(() => 'name'),
  resolveTopLevelPartsOrder: jest.fn(() => ['time']),
  mergeTrackerPart: jest.fn(),
  redactTrackerArrayItemValue: jest.fn(),
  redactTrackerPartValue: jest.fn(),
  replaceTrackerArrayItem: jest.fn(),
  replaceTrackerArrayItemField: jest.fn(),
  redactTrackerArrayItemFieldValue: jest.fn(),
}));

jest.unstable_mockModule('../ui/templates.js', () => ({
  checkTemplateUrl: jest.fn(),
  getExtensionRoot: jest.fn(() => 'root'),
  getTemplateUrl: jest.fn(() => 'url'),
}));

jest.unstable_mockModule('../ui/debug.js', () => ({
  debugLog: jest.fn(),
  isDebugLoggingEnabled: jest.fn(() => false),
}));

const { createTrackerActions } = await import('../ui/tracker-actions.js');
const { PromptEngineeringMode, TrackerWorldInfoPolicyMode } = await import('../config.js');
const { parseResponse } = await import('../parser.js');
const { schemaToExample, schemaToPromptSchema } = await import('../schema-to-example.js');

function makeSettings() {
  return {
    profileId: 'profile-1',
    trackerSystemPromptMode: 'saved',
    trackerSystemPromptSavedName: 'zTracker',
    maxResponseToken: 512,
    promptEngineeringMode: PromptEngineeringMode.NATIVE,
    prompt: 'Generate tracker JSON',
    promptJson: '',
    promptXml: '',
    promptToon: '',
    skipFirstXMessages: 0,
    includeLastXMessages: 0,
    includeLastXZTrackerMessages: 0,
    sequentialPartGeneration: false,
    trackerWorldInfoPolicyMode: TrackerWorldInfoPolicyMode.INCLUDE_ALL,
    trackerWorldInfoAllowlistBookNames: [],
    trackerWorldInfoAllowlistEntryIds: [],
    schemaPreset: 'default',
    schemaPresets: {
      default: {
        name: 'Default',
        value: {
          type: 'object',
          properties: {
            time: { type: 'string' },
          },
          required: ['time'],
        },
        html: '<div></div>',
      },
    },
    debugLogging: false,
  } as any;
}

/** Builds a minimal chat array so tracker-action tests can target a specific message index. */
function makeChat(length: number) {
  return Array.from({ length }, () => ({ original_avatar: 'avatar.png', extra: {} }));
}

describe('createTrackerActions skipFirstXMessages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    buildPromptMock.mockReset();
    applyTrackerUpdateAndRenderMock.mockReset();
    renderTrackerWithDepsMock.mockReset();
    stEchoMock.mockReset();
    document.body.innerHTML = '<div id="extensionsMenu"></div>';
    (globalThis as any).SillyTavern = {
      getContext: () => ({
        chatMetadata: {},
        powerUserSettings: {
          prefer_character_prompt: true,
          sysprompt: { name: 'Neutral - Chat' },
        },
        getPresetManager: () => null,
      }),
    };
  });

  test('shows an info toast and skips manual generation before the threshold', async () => {
    const generateRequest = jest.fn();

    const actions = createTrackerActions({
      globalContext: {
        chat: makeChat(4),
        saveChat: jest.fn(async () => undefined),
        extensionSettings: {
          connectionManager: {
            profiles: [{ id: 'profile-1', api: 'openai', preset: 'preset-1', context: 'context-1', instruct: 'instruct-1' }],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () => ({
          ...makeSettings(),
          trackerSystemPromptMode: 'profile',
          skipFirstXMessages: 6,
        }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: import.meta.url,
    });

    await actions.generateTracker(3);

    expect(stEchoMock).toHaveBeenCalledWith(
      'info',
      'Tracker generation skipped: this message is within the first 6 messages.',
    );
    expect(buildPromptMock).not.toHaveBeenCalled();
    expect(generateRequest).not.toHaveBeenCalled();
  });

  test('silently skips auto generation before the threshold', async () => {
    const generateRequest = jest.fn();

    const actions = createTrackerActions({
      globalContext: {
        chat: makeChat(4),
        saveChat: jest.fn(async () => undefined),
        extensionSettings: {
          connectionManager: {
            profiles: [{ id: 'profile-1', api: 'openai', preset: 'preset-1', context: 'context-1', instruct: 'instruct-1' }],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () => ({
          ...makeSettings(),
          trackerSystemPromptMode: 'profile',
          skipFirstXMessages: 6,
        }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: import.meta.url,
    });

    await actions.generateTracker(3, { silent: true });

    expect(stEchoMock).not.toHaveBeenCalled();
    expect(buildPromptMock).not.toHaveBeenCalled();
    expect(generateRequest).not.toHaveBeenCalled();
  });

  test('allows generation once the message reaches the threshold', async () => {
    applyTrackerUpdateAndRenderMock.mockImplementation(() => undefined);
    buildPromptMock.mockResolvedValue({
      result: [
        { role: 'system', content: 'Existing system prompt' },
        { role: 'user', content: 'Prior chat message' },
      ],
    });

    const generateRequest = jest.fn((
      _request: any,
      hooks: { onStart: (requestId: string) => void; onFinish: (requestId: string, data: unknown, error: unknown) => void },
    ) => {
      hooks.onStart('request-1');
      hooks.onFinish('request-1', { content: { time: '10:00:00' } }, null);
    });

    const actions = createTrackerActions({
      globalContext: {
        chat: makeChat(7),
        saveChat: jest.fn(async () => undefined),
        extensionSettings: {
          connectionManager: {
            profiles: [{ id: 'profile-1', api: 'openai', preset: 'preset-1', context: 'context-1', instruct: 'instruct-1' }],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () => ({
          ...makeSettings(),
          trackerSystemPromptMode: 'profile',
          skipFirstXMessages: 6,
        }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: import.meta.url,
    });

    await actions.generateTracker(6);

    expect(buildPromptMock).toHaveBeenCalled();
    expect(generateRequest).toHaveBeenCalled();
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
    expect(stEchoMock).not.toHaveBeenCalled();
  });
});

describe('createTrackerActions saved system prompt mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '<div id="extensionsMenu"></div>';
  });

  test('logs malformed prompt-engineered payloads when parsing fails', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const context = {
      chatMetadata: {},
      powerUserSettings: {
        prefer_character_prompt: true,
        sysprompt: { name: 'Neutral - Chat' },
      },
      getPresetManager: (apiId?: string) => {
        if (apiId === 'sysprompt') {
          return {
            getCompletionPresetByName: (name?: string) =>
              name === 'zTracker' ? { name: 'zTracker', content: 'Saved tracker system prompt' } : undefined,
            getPresetList: () => ({ presets: [], preset_names: ['zTracker'] }),
          };
        }
        return null;
      },
    };

    (globalThis as any).SillyTavern = {
      getContext: () => context,
    };

    buildPromptMock.mockResolvedValue({
      result: [
        { role: 'system', content: 'Existing system prompt' },
        { role: 'user', content: 'Prior chat message' },
      ],
    });

    (schemaToExample as jest.Mock).mockReturnValue('time\tstring');
    (schemaToPromptSchema as jest.Mock).mockReturnValue('type: object');
    (parseResponse as jest.Mock).mockImplementation(() => {
      throw new Error('Model response is not valid TOON.');
    });

    const generateRequest = jest.fn((
      _request: any,
      hooks: { onStart: (requestId: string) => void; onFinish: (requestId: string, data: unknown, error: unknown) => void },
    ) => {
      hooks.onStart('request-1');
      hooks.onFinish('request-1', { content: '```toon\nnot valid\n```' }, null);
    });

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: jest.fn(async () => undefined),
        extensionSettings: {
          connectionManager: {
            profiles: [{ id: 'profile-1', api: 'openai', preset: 'preset-1', context: 'context-1', instruct: 'instruct-1', sysprompt: 'Profile Prompt' }],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () => ({
          ...makeSettings(),
          promptEngineeringMode: PromptEngineeringMode.TOON,
          promptToon: 'TOON TEMPLATE\n{{example_response}}',
        }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: import.meta.url,
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

    const context = {
      chatMetadata: {},
      powerUserSettings: {
        prefer_character_prompt: true,
        sysprompt: { name: 'Neutral - Chat' },
      },
      getPresetManager: (apiId?: string) => {
        if (apiId === 'sysprompt') {
          return {
            getCompletionPresetByName: (name?: string) =>
              name === 'zTracker' ? { name: 'zTracker', content: 'Saved tracker system prompt' } : undefined,
            getPresetList: () => ({ presets: [], preset_names: ['zTracker'] }),
          };
        }
        return null;
      },
    };

    (globalThis as any).SillyTavern = {
      getContext: () => context,
    };

    buildPromptMock.mockResolvedValue({
      result: [
        { role: 'system', content: 'Existing system prompt' },
        { role: 'user', content: 'Prior chat message' },
      ],
    });

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

    const generateRequest = jest.fn((
      _request: any,
      hooks: { onStart: (requestId: string) => void; onFinish: (requestId: string, data: unknown, error: unknown) => void },
    ) => {
      hooks.onStart('request-1');
      hooks.onFinish('request-1', { content: '```toon\ncharactersPresent[2]: "Silvia"\t"Tobias"\n```' }, null);
    });

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: jest.fn(async () => undefined),
        extensionSettings: {
          connectionManager: {
            profiles: [{ id: 'profile-1', api: 'openai', preset: 'preset-1', context: 'context-1', instruct: 'instruct-1', sysprompt: 'Profile Prompt' }],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () => ({
          ...makeSettings(),
          promptEngineeringMode: PromptEngineeringMode.TOON,
          promptToon: 'TOON TEMPLATE\n{{example_response}}',
        }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: import.meta.url,
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

  test('injects the saved prompt without mutating prefer_character_prompt', async () => {
    const powerUserSettings = {
      prefer_character_prompt: true,
      sysprompt: { name: 'Neutral - Chat' },
    };

    const context = {
      chatMetadata: {},
      powerUserSettings,
      getPresetManager: (apiId?: string) => {
        if (apiId === 'sysprompt') {
          return {
            getCompletionPresetByName: (name?: string) =>
              name === 'zTracker' ? { name: 'zTracker', content: 'Saved tracker system prompt' } : undefined,
            getPresetList: () => ({ presets: [], preset_names: ['zTracker'] }),
          };
        }
        return null;
      },
    };

    (globalThis as any).SillyTavern = {
      getContext: () => context,
    };

    buildPromptMock.mockResolvedValue({
      result: [
        { role: 'system', content: 'Existing system prompt' },
        { role: 'user', content: 'Prior chat message' },
      ],
    });

    const generateRequest = jest.fn((
        _request: any,
        hooks: { onStart: (requestId: string) => void; onFinish: (requestId: string, data: unknown, error: unknown) => void },
      ) => {
        hooks.onStart('request-1');
        hooks.onFinish('request-1', { content: { time: '10:00:00' } }, null);
      });

    const generator = {
      generateRequest,
      abortRequest: jest.fn(),
    };

    const globalContext = {
      chat: [{ original_avatar: 'avatar.png', extra: {} }],
      saveChat: jest.fn(async () => undefined),
      extensionSettings: {
        connectionManager: {
          profiles: [
            {
              id: 'profile-1',
              api: 'openai',
              preset: 'preset-1',
              context: 'context-1',
              instruct: 'instruct-1',
              sysprompt: 'Profile Prompt',
            },
          ],
        },
      },
      CONNECT_API_MAP: {
        openai: { selected: 'openai' },
      },
    };

    const actions = createTrackerActions({
      globalContext,
      settingsManager: { getSettings: () => makeSettings() } as any,
      generator: generator as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: import.meta.url,
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

  test('uses TOON prompt-engineering mode when selected', async () => {
    const context = {
      chatMetadata: {},
      powerUserSettings: {
        prefer_character_prompt: true,
        sysprompt: { name: 'Neutral - Chat' },
      },
      getPresetManager: (apiId?: string) => {
        if (apiId === 'sysprompt') {
          return {
            getCompletionPresetByName: (name?: string) =>
              name === 'zTracker' ? { name: 'zTracker', content: 'Saved tracker system prompt' } : undefined,
            getPresetList: () => ({ presets: [], preset_names: ['zTracker'] }),
          };
        }
        return null;
      },
    };

    (globalThis as any).SillyTavern = {
      getContext: () => context,
    };

    buildPromptMock.mockResolvedValue({
      result: [
        { role: 'system', content: 'Existing system prompt' },
        { role: 'user', content: 'Prior chat message' },
      ],
    });

    (schemaToExample as jest.Mock).mockReturnValue('time\tstring');
    (schemaToPromptSchema as jest.Mock).mockReturnValue('type: object\nproperties:\n  time:\n    type: string');
    (parseResponse as jest.Mock).mockReturnValue({ time: '10:00:00' });

    const generateRequest = jest.fn((
      _request: any,
      hooks: { onStart: (requestId: string) => void; onFinish: (requestId: string, data: unknown, error: unknown) => void },
    ) => {
      hooks.onStart('request-1');
      hooks.onFinish('request-1', { content: '```toon\ntime\t10:00:00\n```' }, null);
    });

    const generator = {
      generateRequest,
      abortRequest: jest.fn(),
    };

    const globalContext = {
      chat: [{ original_avatar: 'avatar.png', extra: {} }],
      saveChat: jest.fn(async () => undefined),
      extensionSettings: {
        connectionManager: {
          profiles: [
            {
              id: 'profile-1',
              api: 'openai',
              preset: 'preset-1',
              context: 'context-1',
              instruct: 'instruct-1',
              sysprompt: 'Profile Prompt',
            },
          ],
        },
      },
      CONNECT_API_MAP: {
        openai: { selected: 'openai' },
      },
    };

    const toonSettings = {
      ...makeSettings(),
      promptEngineeringMode: PromptEngineeringMode.TOON,
      promptToon: 'TOON TEMPLATE\n{{example_response}}',
    };

    const actions = createTrackerActions({
      globalContext,
      settingsManager: { getSettings: () => toonSettings } as any,
      generator: generator as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: import.meta.url,
    });

    await actions.generateTracker(0);

    expect(schemaToExample).toHaveBeenCalledWith(toonSettings.schemaPresets.default.value, 'toon');
    expect(schemaToPromptSchema).toHaveBeenCalledWith(toonSettings.schemaPresets.default.value, 'toon');
    expect(parseResponse).toHaveBeenCalledWith('```toon\ntime\t10:00:00\n```', 'toon', {
      schema: toonSettings.schemaPresets.default.value,
    });

    const sentMessages = generateRequest.mock.calls[0][0].prompt;
    expect(sentMessages.at(-1)).toEqual({
      role: 'user',
      content: 'TOON TEMPLATE\ntime\tstring',
    });
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('injects the translated XML schema instead of raw JSON when XML prompt-engineering is selected', async () => {
    const context = {
      chatMetadata: {},
      powerUserSettings: {
        prefer_character_prompt: true,
        sysprompt: { name: 'Neutral - Chat' },
      },
      getPresetManager: (apiId?: string) => {
        if (apiId === 'sysprompt') {
          return {
            getCompletionPresetByName: (name?: string) =>
              name === 'zTracker' ? { name: 'zTracker', content: 'Saved tracker system prompt' } : undefined,
            getPresetList: () => ({ presets: [], preset_names: ['zTracker'] }),
          };
        }
        return null;
      },
    };

    (globalThis as any).SillyTavern = {
      getContext: () => context,
    };

    buildPromptMock.mockResolvedValue({
      result: [
        { role: 'system', content: 'Existing system prompt' },
        { role: 'user', content: 'Prior chat message' },
      ],
    });

    (schemaToExample as jest.Mock).mockReturnValue('<time>string</time>');
    (schemaToPromptSchema as jest.Mock).mockReturnValue('<type>object</type>');
    (parseResponse as jest.Mock).mockReturnValue({ time: '10:00:00' });

    const generateRequest = jest.fn((
      _request: any,
      hooks: { onStart: (requestId: string) => void; onFinish: (requestId: string, data: unknown, error: unknown) => void },
    ) => {
      hooks.onStart('request-1');
      hooks.onFinish('request-1', { content: '```xml\n<root><time>10:00:00</time></root>\n```' }, null);
    });

    const generator = {
      generateRequest,
      abortRequest: jest.fn(),
    };

    const globalContext = {
      chat: [{ original_avatar: 'avatar.png', extra: {} }],
      saveChat: jest.fn(async () => undefined),
      extensionSettings: {
        connectionManager: {
          profiles: [
            {
              id: 'profile-1',
              api: 'openai',
              preset: 'preset-1',
              context: 'context-1',
              instruct: 'instruct-1',
              sysprompt: 'Profile Prompt',
            },
          ],
        },
      },
      CONNECT_API_MAP: {
        openai: { selected: 'openai' },
      },
    };

    const xmlSettings = {
      ...makeSettings(),
      promptEngineeringMode: PromptEngineeringMode.XML,
      promptXml: 'XML TEMPLATE\n{{schema}}\n{{example_response}}',
    };

    const actions = createTrackerActions({
      globalContext,
      settingsManager: { getSettings: () => xmlSettings } as any,
      generator: generator as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: import.meta.url,
    });

    await actions.generateTracker(0);

    const sentMessages = generateRequest.mock.calls[0][0].prompt;
    expect(sentMessages.at(-1)).toEqual({
      role: 'user',
      content: 'XML TEMPLATE\n<type>object</type>\n<time>string</time>',
    });
    expect(sentMessages.at(-1).content).not.toContain('{\n  "type"');
  });
});
