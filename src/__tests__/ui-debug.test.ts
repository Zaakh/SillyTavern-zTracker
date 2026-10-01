/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';

const settingsManager = {
  getSettings: () => ({
    debugLogging: true,
    embedZTrackerSnapshotHeader: 'Tracker:',
  }),
} as any;

const {
  captureTrackerRequestDebugSnapshot,
  formatTrackerRequestDebugSnapshot,
  getLastTrackerRequestDebugSnapshot,
} = await import('../ui/debug.js');

describe('tracker request debug snapshots', () => {
  beforeEach(() => {
    delete (globalThis as any).zTrackerDiagnostics;
    jest.restoreAllMocks();
  });

  test('captures both raw and sanitized prompt views with source-name fallback', () => {
    const consoleSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);

    captureTrackerRequestDebugSnapshot(settingsManager, {
      messageId: 7,
      moduleId: 'minimal',
      moduleName: 'Minimal',
      connectionSource: 'saved',
      profileId: 'profile-1',
      api: 'openai',
      apiType: 'chat',
      model: 'gpt-test',
      apiServer: 'https://example.invalid',
      presetName: 'Tracker Prompt',
      promptEngineeringMode: 'native',
      maxTokens: 16000,
      overridePayload: { json_schema: { name: 'SceneTracker' } },
      requestMessages: [
        {
          role: 'assistant',
          content: 'The barkeeper slides a glass across the counter.',
          source: { name: 'Bar' },
        },
        {
          role: 'user',
          content: 'Thank you.',
          name: 'Tobias',
        },
      ],
      sanitizedPrompt: [
        {
          role: 'assistant',
          content: 'The barkeeper slides a glass across the counter.',
          source: { name: 'Bar' },
        },
        {
          role: 'user',
          content: 'Thank you.',
          name: 'Tobias',
        },
      ],
    });

    const snapshot = getLastTrackerRequestDebugSnapshot();
    expect(snapshot).toMatchObject({
      messageId: 7,
      moduleId: 'minimal',
      moduleName: 'Minimal',
      connectionSource: 'saved',
      profileId: 'profile-1',
      api: 'openai',
      apiType: 'chat',
      model: 'gpt-test',
      apiServer: 'https://example.invalid',
      presetName: 'Tracker Prompt',
      promptEngineeringMode: 'native',
      maxTokens: 16000,
      embedSnapshotHeader: 'Tracker:',
      requestMessages: [
        {
          role: 'assistant',
          name: 'Bar',
        },
        {
          role: 'user',
          name: 'Tobias',
        },
      ],
      sanitizedPrompt: [
        {
          role: 'assistant',
          name: 'Bar',
        },
        {
          role: 'user',
          name: 'Tobias',
        },
      ],
    });
    expect(snapshot?.flattenedSanitizedPrompt).toContain('Bar: The barkeeper slides a glass across the counter.');
    expect(snapshot?.flattenedSanitizedPrompt).toContain('Tobias: Thank you.');
    expect(consoleSpy).toHaveBeenCalled();
  });

  test('formats a readable diagnostics block for the last tracker request', () => {
    const lines = formatTrackerRequestDebugSnapshot({
      capturedAt: '2026-04-02T12:00:00.000Z',
      messageId: 3,
      moduleId: 'agenda',
      moduleName: 'Agenda',
      connectionSource: 'active',
      profileId: 'profile-2',
      api: 'textgenerationwebui',
      apiType: 'textgenerationwebui',
      model: 'live-model',
      apiServer: 'http://localhost:5000',
      instructName: 'Active Instruct',
      contextName: 'Active Context',
      syspromptName: 'Active Sysprompt',
      promptEngineeringMode: 'json',
      maxTokens: 512,
      embedSnapshotHeader: 'Scene details:',
      overridePayload: {},
      requestMessages: [],
      sanitizedPrompt: [],
      flattenedRequestMessages: 'Bar: hello',
      flattenedSanitizedPrompt: 'Bar: hello',
    });

    expect(lines.join('\n')).toContain('lastTrackerRequest:');
    expect(lines.join('\n')).toContain('moduleId: agenda');
    expect(lines.join('\n')).toContain('moduleName: Agenda');
    expect(lines.join('\n')).toContain('connectionSource: active');
    expect(lines.join('\n')).toContain('profileId: profile-2');
    expect(lines.join('\n')).toContain('api: textgenerationwebui');
    expect(lines.join('\n')).toContain('model: live-model');
    expect(lines.join('\n')).toContain('apiServer: http://localhost:5000');
    expect(lines.join('\n')).toContain('instructName: Active Instruct');
    expect(lines.join('\n')).toContain('embedSnapshotHeader: Scene details:');
    expect(lines.join('\n')).toContain('flattenedSanitizedPrompt:');
    expect(lines.join('\n')).toContain('Bar: hello');
    expect(lines.join('\n')).toContain('embedSnapshotHeader is the active zTracker-injected snapshot label');
  });

  const effectiveSettingsSnapshot = {
    messageId: 1,
    connectionSource: 'saved' as const,
    profileId: 'profile-1',
    api: 'textgenerationwebui',
    presetName: 'Non Reasoning Sampler',
    instructName: 'Gemma-4  (no reasoning)',
    contextName: 'Gemma-4  (no reasoning)',
    instructEnabled: true,
    reasoningTemplateName: 'Gemma 4',
    promptEngineeringMode: 'json',
    maxTokens: 512,
    overridePayload: {},
    requestMessages: [],
    sanitizedPrompt: [],
  };

  test('records the effective profile settings with no fallback fields for a fully recorded profile', () => {
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);

    captureTrackerRequestDebugSnapshot(settingsManager, {
      ...effectiveSettingsSnapshot,
      settingsSource: 'profile',
      fallbackFields: [],
      startReplyWith: '<|channel>thought\n<channel|>',
    });

    const snapshot = getLastTrackerRequestDebugSnapshot();
    expect(snapshot).toMatchObject({
      settingsSource: 'profile',
      fallbackFields: [],
      instructName: 'Gemma-4  (no reasoning)',
      startReplyWith: '<|channel>thought\n<channel|>',
      reasoningTemplateName: 'Gemma 4',
    });
    const text = formatTrackerRequestDebugSnapshot(snapshot).join('\n');
    expect(text).toContain('settingsSource: profile');
    expect(text).toContain('fallbackFields: none');
    expect(text).toContain('startReplyWith: "<|channel>thought\\n<channel|>"');
    expect(text).toContain('reasoningTemplate: Gemma 4');
    expect(text).toContain('instructEnabled: true');
  });

  test('lists a profile field that fell back to the live settings and marks an omitted prefill', () => {
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);

    captureTrackerRequestDebugSnapshot(settingsManager, {
      ...effectiveSettingsSnapshot,
      instructName: 'Live Instruct',
      settingsSource: 'profile',
      fallbackFields: ['instruct'],
      startReplyWith: '',
      startReplyWithOmitted: true,
    });

    const text = formatTrackerRequestDebugSnapshot(getLastTrackerRequestDebugSnapshot()).join('\n');
    expect(text).toContain('instructName: Live Instruct');
    expect(text).toContain('fallbackFields: instruct');
    expect(text).toContain('startReplyWith: omitted');
  });
});