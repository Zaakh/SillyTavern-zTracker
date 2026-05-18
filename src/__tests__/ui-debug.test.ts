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
});