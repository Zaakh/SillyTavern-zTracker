import type { ExtensionSettings } from '../config.js';
import { includeZTrackerMessages, CHAT_MESSAGE_SCHEMA_VALUE_KEY } from '../tracker.js';
import { EXTENSION_KEY } from '../extension-metadata.js';

describe('includeZTrackerMessages', () => {
  const makeSettings = (count: number) => {
    return {
      includeLastXZTrackerMessages: count,
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
    expect(result[1].content).toContain('```json');
    expect(result[1].role).toBe('user');
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
