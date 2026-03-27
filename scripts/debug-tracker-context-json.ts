/**
 * @jest-environment jsdom
 *
 * Debug harness that prints one JSON-mode tracker-generation request exactly as
 * createTrackerActions sends it to the generator, including injected tracker snapshots.
 */

import { jest } from '@jest/globals';

if (!globalThis.structuredClone) {
  globalThis.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
}

const buildPromptMock = jest.fn<() => Promise<{ result: Array<Record<string, unknown>> }>>();
const getWorldInfosMock = jest.fn(() => []);
const stEchoMock = jest.fn();

jest.unstable_mockModule('sillytavern-utils-lib', () => ({
  buildPrompt: buildPromptMock,
  Generator: class GeneratorMock {},
  getWorldInfos: getWorldInfosMock,
  Message: class MessageMock {},
}));

jest.unstable_mockModule('sillytavern-utils-lib/config', () => ({
  characters: [{ avatar: 'alice.png' }],
  selected_group: false,
  st_echo: stEchoMock,
}));

jest.unstable_mockModule('sillytavern-utils-lib/types/popup', () => ({
  POPUP_RESULT: { AFFIRMATIVE: 'affirmative' },
  POPUP_TYPE: { CONFIRM: 'confirm' },
}));

const { createTrackerActions } = await import('../src/ui/tracker-actions.js');
const { PromptEngineeringMode, TrackerWorldInfoPolicyMode } = await import('../src/config.js');
const { EXTENSION_KEY } = await import('../src/extension-metadata.js');
const { CHAT_MESSAGE_SCHEMA_VALUE_KEY } = await import('../src/tracker.js');

/** Builds a stable settings object for one JSON-mode capture run. */
function makeSettings() {
  return {
    profileId: 'profile-json-debug',
    trackerSystemPromptMode: 'saved',
    trackerSystemPromptSavedName: 'zTracker-debug-json',
    maxResponseToken: 512,
    autoMode: {},
    sequentialPartGeneration: false,
    schemaPreset: 'default',
    schemaPresets: {
      default: {
        name: 'Default',
        value: {
          type: 'object',
          additionalProperties: false,
          properties: {
            time: { type: 'string' },
            location: { type: 'string' },
            summary: { type: 'string' },
          },
          required: ['time', 'location', 'summary'],
        },
        html: '<div>{{data.summary}}</div>',
      },
    },
    prompt: 'Generate the tracker JSON for the latest chat message.',
    includeLastXMessages: 4,
    includeLastXZTrackerMessages: 1,
    embedZTrackerRole: 'user',
    embedZTrackerSnapshotHeader: 'Tracker:',
    embedZTrackerSnapshotTransformPreset: 'default',
    embedZTrackerSnapshotTransformPresets: {
      default: {
        name: 'Default (JSON)',
        input: 'pretty_json',
        pattern: '',
        flags: 'g',
        replacement: '',
        codeFenceLang: 'json',
        wrapInCodeFence: true,
      },
    },
    promptEngineeringMode: PromptEngineeringMode.NATIVE,
    promptJson: '',
    promptXml: '',
    promptToon: '',
    debugLogging: false,
    trackerWorldInfoPolicyMode: TrackerWorldInfoPolicyMode.INCLUDE_ALL,
    trackerWorldInfoAllowlistBookNames: [],
    trackerWorldInfoAllowlistEntryIds: [],
  } as any;
}

/** Creates a prior prompt message that already carries tracker data for injection. */
function makePromptMessageWithTracker(trackerValue: Record<string, unknown>) {
  return {
    role: 'assistant',
    content: 'Alice straightens the cafe table and checks the clock.',
    source: {
      extra: {
        [EXTENSION_KEY]: {
          [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: trackerValue,
        },
      },
    },
  };
}

describe('debug tracker context json', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '<div id="extensionsMenu"></div><div class="mes" mesid="0"><div class="mes_text"></div></div>';
  });

  test('prints one captured JSON-mode request payload', async () => {
    const settings = makeSettings();
    const capturedRequests: Array<Record<string, unknown>> = [];
    const saveChatMock = jest.fn(async () => undefined);
    const renderTrackerWithDepsMock = jest.fn();

    const context = {
      chatMetadata: {},
      powerUserSettings: {
        prefer_character_prompt: true,
        sysprompt: { name: 'Roleplay Default' },
      },
      getPresetManager: (apiId?: string) => {
        if (apiId === 'sysprompt') {
          return {
            getCompletionPresetByName: (name?: string) =>
              name === 'zTracker-debug-json'
                ? {
                    name: 'zTracker-debug-json',
                    content: 'You extract structured tracker state from the visible conversation.',
                  }
                : undefined,
            getPresetList: () => ({ presets: [], preset_names: ['zTracker-debug-json'] }),
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
        { role: 'system', content: 'You are in a quiet morning cafe scene.' },
        { role: 'user', content: 'Earlier context: Alice opened the cafe at dawn.' },
        makePromptMessageWithTracker({
          time: '09:12:00; 03/27/2026 (Friday)',
          location: 'Atrium cafe, east window booth',
          summary: 'Alice has already started her shift and prepared the front tables.',
        }),
        { role: 'user', content: 'Alice notices a new customer entering and waves them over.' },
      ],
    });

    const generator = {
      abortRequest: jest.fn(),
      generateRequest: jest.fn(
        (
          request: Record<string, unknown>,
          hooks: { onStart: (requestId: string) => void; onFinish: (requestId: string, data: unknown, error: unknown) => void },
        ) => {
          capturedRequests.push(structuredClone(request));
          hooks.onStart('debug-request-1');
          hooks.onFinish(
            'debug-request-1',
            {
              content: {
                time: '09:13:00; 03/27/2026 (Friday)',
                location: 'Atrium cafe, east window booth',
                summary: 'Alice greets a newly arrived customer near the front entrance.',
              },
            },
            null,
          );
        },
      ),
    } as any;

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'alice.png', extra: {} }],
        saveChat: saveChatMock,
        extensionSettings: {
          connectionManager: {
            profiles: [
              {
                id: 'profile-json-debug',
                api: 'openai',
                preset: 'debug-preset',
                context: 'debug-context',
                instruct: 'debug-instruct',
                sysprompt: 'Profile system prompt',
              },
            ],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () => settings,
      } as any,
      generator,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: import.meta.url,
    });

    await actions.generateTracker(0);

    expect(capturedRequests).toHaveLength(1);

    const capturedRequest = capturedRequests[0];
    const debugOutput = {
      scenario: {
        promptEngineeringMode: settings.promptEngineeringMode,
        includeLastXMessages: settings.includeLastXMessages,
        includeLastXZTrackerMessages: settings.includeLastXZTrackerMessages,
        trackerSystemPromptMode: settings.trackerSystemPromptMode,
      },
      request: capturedRequest,
    };

    console.log('TRACKER_CONTEXT_JSON_START');
    console.log(JSON.stringify(debugOutput, null, 2));
    console.log('TRACKER_CONTEXT_JSON_END');

    expect((capturedRequest.prompt as Array<Record<string, unknown>>).map((message) => message.role)).toEqual([
      'system',
      'system',
      'user',
      'assistant',
      'user',
      'user',
      'user',
    ]);
    const injectedTrackerMessage = (capturedRequest.prompt as Array<Record<string, unknown>>).find(
      (message) => typeof message.content === 'string' && message.content.startsWith('Tracker:\n```json'),
    );
    expect(injectedTrackerMessage).toBeDefined();
    expect((capturedRequest.prompt as Array<Record<string, unknown>>)[3]).toEqual({
      role: 'assistant',
      content: 'Alice straightens the cafe table and checks the clock.',
    });
    for (const promptMessage of capturedRequest.prompt as Array<Record<string, unknown>>) {
      expect(promptMessage).not.toHaveProperty('zTrackerFound');
      expect(promptMessage).not.toHaveProperty('source');
      expect(promptMessage).not.toHaveProperty('is_user');
      expect(promptMessage).not.toHaveProperty('mes');
      expect(promptMessage).not.toHaveProperty('is_system');
    }
    expect(capturedRequest.overridePayload).toEqual({
      json_schema: {
        name: 'SceneTracker',
        strict: true,
        value: settings.schemaPresets.default.value,
      },
    });
    expect(saveChatMock).toHaveBeenCalledTimes(1);
  });
});
