/**
 * @jest-environment jsdom
 *
 * Debug harness that prints one TOON prompt-engineering tracker-generation request
 * exactly as createTrackerActions sends it to the generator.
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
const { DEFAULT_PROMPT_TOON, PromptEngineeringMode, TrackerWorldInfoPolicyMode } = await import('../src/config.js');
const { EXTENSION_KEY } = await import('../src/extension-metadata.js');
const { CHAT_MESSAGE_SCHEMA_VALUE_KEY } = await import('../src/tracker.js');

function makeSettings() {
  return {
    profileId: 'profile-toon-debug',
    trackerSystemPromptMode: 'saved',
    trackerSystemPromptSavedName: 'zTracker-debug-toon',
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
    promptEngineeringMode: PromptEngineeringMode.TOON,
    promptJson: '',
    promptXml: '',
    promptToon: DEFAULT_PROMPT_TOON,
    debugLogging: false,
    trackerWorldInfoPolicyMode: TrackerWorldInfoPolicyMode.INCLUDE_ALL,
    trackerWorldInfoAllowlistBookNames: [],
    trackerWorldInfoAllowlistEntryIds: [],
  } as any;
}

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

describe('debug tracker context toon', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '<div id="extensionsMenu"></div><div class="mes" mesid="0"><div class="mes_text"></div></div>';
  });

  test('prints one captured TOON-mode request payload', async () => {
    const settings = makeSettings();
    const capturedRequests: Array<Record<string, unknown>> = [];

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
              name === 'zTracker-debug-toon'
                ? {
                    name: 'zTracker-debug-toon',
                    content: 'You extract structured tracker state from the visible conversation.',
                  }
                : undefined,
            getPresetList: () => ({ presets: [], preset_names: ['zTracker-debug-toon'] }),
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
          hooks.onStart('debug-request-toon-1');
          hooks.onFinish(
            'debug-request-toon-1',
            {
              content:
                '```toon\ntime: 09:13:00; 03/27/2026 (Friday)\nlocation: Atrium cafe, east window booth\nsummary: Alice greets a newly arrived customer near the front entrance.\n```',
            },
            null,
          );
        },
      ),
    } as any;

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'alice.png', extra: {} }],
        saveChat: jest.fn(async () => undefined),
        extensionSettings: {
          connectionManager: {
            profiles: [
              {
                id: 'profile-toon-debug',
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
      renderTrackerWithDeps: jest.fn(),
      importMetaUrl: import.meta.url,
    });

    await actions.generateTracker(0);

    expect(capturedRequests).toHaveLength(1);

    const capturedRequest = capturedRequests[0];
    console.log('TRACKER_CONTEXT_TOON_START');
    console.log(JSON.stringify({ scenario: { promptEngineeringMode: settings.promptEngineeringMode }, request: capturedRequest }, null, 2));
    console.log('TRACKER_CONTEXT_TOON_END');

    const promptMessages = capturedRequest.prompt as Array<Record<string, unknown>>;
    expect(promptMessages.map((message) => message.role)).toEqual(['system', 'system', 'user', 'assistant', 'user', 'user', 'user']);
    expect(promptMessages[promptMessages.length - 1].content).toContain('```toon');
    expect(promptMessages[promptMessages.length - 1].content).toContain('EXAMPLE OF A PERFECT RESPONSE');
    for (const promptMessage of promptMessages) {
      expect(promptMessage).not.toHaveProperty('zTrackerFound');
      expect(promptMessage).not.toHaveProperty('source');
      expect(promptMessage).not.toHaveProperty('is_user');
      expect(promptMessage).not.toHaveProperty('mes');
      expect(promptMessage).not.toHaveProperty('is_system');
    }
    expect(capturedRequest.overridePayload).toEqual({});
  });
});
