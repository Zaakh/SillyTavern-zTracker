import { jest } from '@jest/globals';

/** Shared mocks and harness helpers for tracker-action tests. */
export const buildPromptMock = jest.fn<() => Promise<{ result: Array<{ role: string; content: string }> }>>();
export const applyTrackerUpdateAndRenderMock = jest.fn();
export const renderTrackerWithDepsMock = jest.fn();
export const stEchoMock = jest.fn();

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
  captureTrackerRequestDebugSnapshot: jest.fn(),
  debugLog: jest.fn(),
  isDebugLoggingEnabled: jest.fn(() => false),
}));

export const { createTrackerActions } = await import('../ui/tracker-actions.js');
export const { PromptEngineeringMode, TrackerWorldInfoPolicyMode } = await import('../config.js');
export const { parseResponse } = await import('../parser.js');
export const { schemaToExample, schemaToPromptSchema } = await import('../schema-to-example.js');

export const TEST_IMPORT_META_URL = import.meta.url;

/** Returns the default extension settings used across tracker-action tests. */
export function makeSettings(overrides: Record<string, unknown> = {}) {
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
    skipCharacterCardInTrackerGeneration: false,
    includeLastXZTrackerMessages: 0,
    embedZTrackerAsCharacter: false,
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
    ...overrides,
  } as any;
}

/** Builds a minimal chat array so tracker-action tests can target a specific message index. */
export function makeChat(length: number) {
  return Array.from({ length }, () => ({ original_avatar: 'avatar.png', extra: {} }));
}

/** Returns a default connection profile and lets tests override only the fields they care about. */
export function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'profile-1',
    api: 'openai',
    preset: 'preset-1',
    context: 'context-1',
    instruct: 'instruct-1',
    sysprompt: 'Profile Prompt',
    ...overrides,
  } as any;
}

/** Returns a minimal SillyTavern runtime context for tracker-action tests. */
export function makeContext(options: {
  includeSavedPromptPreset?: boolean;
  powerUserSettings?: Record<string, unknown>;
  getPresetManager?: (apiId?: string) => unknown;
  textCompletionProcessRequest?: jest.Mock;
} = {}) {
  const savedPromptPreset = {
    getCompletionPresetByName: (name?: string) =>
      name === 'zTracker' ? { name: 'zTracker', content: 'Saved tracker system prompt' } : undefined,
    getPresetList: () => ({ presets: [], preset_names: ['zTracker'] }),
  };

  return {
    chatMetadata: {},
    powerUserSettings: {
      prefer_character_prompt: true,
      sysprompt: { name: 'Neutral - Chat' },
      ...(options.powerUserSettings ?? {}),
    },
    TextCompletionService: {
      processRequest:
        options.textCompletionProcessRequest ?? jest.fn(async () => ({ content: { time: '10:00:00' } })),
    },
    getPresetManager:
      options.getPresetManager ??
      ((apiId?: string) => (options.includeSavedPromptPreset && apiId === 'sysprompt' ? savedPromptPreset : null)),
  } as any;
}

/** Installs the provided fake SillyTavern context on the test global. */
export function installSillyTavernContext(context: any): void {
  (globalThis as any).SillyTavern = {
    getContext: () => context,
  };
}

/** Returns the standard built prompt result used by most tracker-action tests. */
export function makeBuiltPromptResult() {
  return {
    result: [
      { role: 'system', content: 'Existing system prompt' },
      { role: 'user', content: 'Prior chat message' },
    ],
  };
}

/** Returns a successful mocked generator request with configurable payload content. */
export function makeGenerateRequest(response: unknown = { content: { time: '10:00:00' } }) {
  return jest.fn((
    _request: any,
    hooks: { onStart: (requestId: string) => void; onFinish: (requestId: string, data: unknown, error: unknown) => void },
  ) => {
    hooks.onStart('request-1');
    hooks.onFinish('request-1', response, null);
  });
}

/** Resets shared mocks and DOM state between tracker-action tests. */
export function resetTrackerActionTestState(): void {
  jest.clearAllMocks();
  buildPromptMock.mockReset();
  applyTrackerUpdateAndRenderMock.mockReset();
  renderTrackerWithDepsMock.mockReset();
  stEchoMock.mockReset();
  document.body.innerHTML = '<div id="extensionsMenu"></div>';
}
