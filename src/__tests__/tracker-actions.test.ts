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

describe('createTrackerActions saved system prompt mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '<div id="extensionsMenu"></div>';
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
});
