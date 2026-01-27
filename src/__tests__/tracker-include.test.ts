import type { ExtensionSettings } from '../config.js';
import { includeZTrackerMessages, CHAT_MESSAGE_SCHEMA_VALUE_KEY } from '../tracker.js';
import { EXTENSION_KEY } from '../extension-metadata.js';

describe('includeZTrackerMessages', () => {
  const makeSettings = (count: number, role?: ExtensionSettings['embedZTrackerRole']) => {
    return {
      includeLastXZTrackerMessages: count,
      embedZTrackerRole: role,
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
        minimal: {
          name: 'Minimal',
          input: 'top_level_lines',
          pattern: '^[\\t ]*\"([^\"]+)\"[\\t ]*:[\\t ]*(.*?)(?:,)?[\\t ]*$',
          flags: 'gm',
          replacement: '$1: $2',
          codeFenceLang: 'text',
          wrapInCodeFence: false,
        },
      },
    } as ExtensionSettings;
  };

  const buildMessageWithTracker = (value: Record<string, unknown>) => ({
    content: 'base',
    role: 'assistant',
    extra: {
      [EXTENSION_KEY]: {
        [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: value,
      },
    },
  });

  it('injects tracker snapshots after the discovered message', () => {
    const messages = [
      buildMessageWithTracker({ id: 1 }),
      { content: 'current', role: 'user' },
    ];
    const result = includeZTrackerMessages(messages as any, makeSettings(1));
    expect(result).toHaveLength(3);
    expect(result[1].content).toContain('Tracker:');
    expect(result[1].content).toContain('```json');
    expect(result[1].role).toBe('user');
  });

  it('can discover a tracker on the last message', () => {
    const messages = [
      { content: 'first', role: 'user' },
      buildMessageWithTracker({ id: 1 }),
    ];
    const result = includeZTrackerMessages(messages as any, makeSettings(1));
    expect(result).toHaveLength(3);
    expect(result[2].content).toContain('Tracker:');
    expect(result[2].content).toContain('```json');
  });

  it('can apply a minimal formatting preset during embedding', () => {
    const messages = [
      buildMessageWithTracker({ time: '10:00', location: 'Mall', topics: { primaryTopic: 'Talk' } }),
      { content: 'current', role: 'user' },
    ];
    const settings = makeSettings(1);
    settings.embedZTrackerSnapshotTransformPreset = 'minimal';

    const result = includeZTrackerMessages(messages as any, settings);
    expect(result).toHaveLength(3);

    const injected = result[1].content as string;
    expect(injected).not.toContain('```');
    expect(injected).toContain('Tracker:');
    expect(injected).toContain('time: "10:00"');
    expect(injected).toContain('location: "Mall"');
    expect(injected).toContain('topics:\n');
    expect(injected).toContain('  primaryTopic: "Talk"');
  });

  it('can embed snapshots as system messages', () => {
    const messages = [
      buildMessageWithTracker({ id: 1 }),
      { content: 'current', role: 'user' },
    ];
    const result = includeZTrackerMessages(messages as any, makeSettings(1, 'system'));
    expect(result).toHaveLength(3);
    expect(result[1].role).toBe('system');
  });

  it('can embed snapshots as assistant messages', () => {
    const messages = [
      buildMessageWithTracker({ id: 1 }),
      { content: 'current', role: 'user' },
    ];
    const result = includeZTrackerMessages(messages as any, makeSettings(1, 'assistant'));
    expect(result).toHaveLength(3);
    expect(result[1].role).toBe('assistant');
  });

  it('leaves messages untouched when no trackers are found', () => {
    const messages = [
      { content: 'first', role: 'user' },
      { content: 'current', role: 'assistant' },
    ];
    const result = includeZTrackerMessages(messages as any, makeSettings(2));
    expect(result).toHaveLength(messages.length);
    expect(result).not.toBe(messages);
  });

  it('injects up to N distinct tracker snapshots without duplicating the same message', () => {
    const messages = [
      buildMessageWithTracker({ id: 1 }),
      { content: 'middle', role: 'assistant' },
      buildMessageWithTracker({ id: 2 }),
      { content: 'current', role: 'user' },
    ];

    const result = includeZTrackerMessages(messages as any, makeSettings(2));

    // Original 4 + 2 injected
    expect(result).toHaveLength(6);

    const injected = result.filter((m: any) => typeof m.content === 'string' && m.content.startsWith('Tracker:\n```json'));
    expect(injected).toHaveLength(2);
      // The implementation inserts each found snapshot immediately after the message it was found on.
      // So after inserting snapshot #2, snapshot #1 will appear earlier in the final list.
      expect(injected[0].content).toContain('"id": 1');
      expect(injected[1].content).toContain('"id": 2');
  });
});
