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
});
