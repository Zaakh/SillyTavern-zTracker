import type { ExtensionSettings } from '../config.js';
import { includeZTrackerMessages, sanitizeMessagesForGeneration, CHAT_MESSAGE_SCHEMA_VALUE_KEY } from '../tracker.js';
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
        toon: {
          name: 'TOON (compact)',
          input: 'toon' as any,
          pattern: '',
          flags: 'g',
          replacement: '',
          codeFenceLang: 'toon',
          wrapInCodeFence: true,
        },
      },
    } as unknown as ExtensionSettings;
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
    const result = includeZTrackerMessages(messages as any, makeSettings(1)) as any[];
    expect(result).toHaveLength(3);
    expect(result[1].content).toContain('Tracker:');
    expect(result[1].content).toContain('```json');
    expect(result[1].role).toBe('user');
    expect(result[1]).not.toHaveProperty('name');
  });

  it('can discover a tracker on the last message', () => {
    const messages = [
      { content: 'first', role: 'user' },
      buildMessageWithTracker({ id: 1 }),
    ];
    const result = includeZTrackerMessages(messages as any, makeSettings(1)) as any[];
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

    const result = includeZTrackerMessages(messages as any, settings) as any[];
    expect(result).toHaveLength(3);

    const injected = result[1].content as string;
    expect(injected).not.toContain('```');
    expect(injected).toContain('Tracker:');
    expect(injected).toContain('time: 10:00');
    expect(injected).toContain('location: Mall');
    expect(injected).toContain('topics:\n');
    expect(injected).toContain('  primaryTopic: Talk');
  });

  it('can apply a TOON formatting preset during embedding', () => {
    const messages = [
      buildMessageWithTracker({
        time: '10:00',
        location: 'Mall',
        topics: { primaryTopic: 'Talk' },
        characters: [
          {
            name: 'Silvia',
            outfit: 'Black apron over a white button-down shirt, dark slacks, black shoes',
            mood: 'calm',
          },
        ],
      }),
      { content: 'current', role: 'user' },
    ];
    const settings = makeSettings(1);
    settings.embedZTrackerSnapshotTransformPreset = 'toon';

    const result = includeZTrackerMessages(messages as any, settings) as any[];
    expect(result).toHaveLength(3);

    const injected = result[1].content as string;
    expect(injected).toContain('Tracker:');
    expect(injected).toContain('```toon');
    expect(injected).not.toContain('```json');
    expect(injected).toContain('characters[');
    expect(injected).not.toContain('```toon\n{');
  });

  it('can embed snapshots as system messages', () => {
    const messages = [
      buildMessageWithTracker({ id: 1 }),
      { content: 'current', role: 'user' },
    ];
    const result = includeZTrackerMessages(messages as any, makeSettings(1, 'system')) as any[];
    expect(result).toHaveLength(3);
    expect(result[1].role).toBe('system');
    expect(result[1]).not.toHaveProperty('name');
  });

  it('can embed snapshots as assistant messages', () => {
    const messages = [
      buildMessageWithTracker({ id: 1 }),
      { content: 'current', role: 'user' },
    ];
    const result = includeZTrackerMessages(messages as any, makeSettings(1, 'assistant')) as any[];
    expect(result).toHaveLength(3);
    expect(result[1].role).toBe('assistant');
    expect(result[1]).not.toHaveProperty('name');
  });

  it('leaves messages untouched when no trackers are found', () => {
    const messages = [
      { content: 'first', role: 'user' },
      { content: 'current', role: 'assistant' },
    ];
    const result = includeZTrackerMessages(messages as any, makeSettings(2)) as any[];
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

    const result = includeZTrackerMessages(messages as any, makeSettings(2)) as any[];

    // Original 4 + 2 injected
    expect(result).toHaveLength(6);

    const injected = result.filter(
      (m: any) =>
        typeof m.content === 'string' &&
        m.content.startsWith('Tracker:\n```json'),
    );
    expect(injected).toHaveLength(2);
      // The implementation inserts each found snapshot immediately after the message it was found on.
      // So after inserting snapshot #2, snapshot #1 will appear earlier in the final list.
      expect(injected[0].content).toContain('"id": 1');
      expect(injected[1].content).toContain('"id": 2');
  });

  it('sanitizes prompt messages before generation requests', () => {
    const messages = [
      {
        role: 'assistant',
        content: 'base',
        name: 'Narrator',
        ignoreInstruct: true,
        source: { extra: { [EXTENSION_KEY]: { [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: { id: 1 } } } },
        extra: { uiOnly: true },
        zTrackerFound: true,
        mes: 'base',
        is_user: false,
        is_system: false,
      },
      {
        role: 'user',
        content: 'current',
        mes: 'current',
        is_user: true,
      },
    ] as any;

    expect(sanitizeMessagesForGeneration(messages)).toEqual([
      {
        role: 'assistant',
        content: 'base',
        name: 'Narrator',
        ignoreInstruct: true,
      },
      {
        role: 'user',
        content: 'current',
      },
    ]);
  });

  it('preserves source-based speaker names on normal chat messages during interceptor embedding', () => {
    const messages = [
      {
        role: 'assistant',
        content: 'As you enter the bar you realize you are the only customer.',
        source: {
          name: 'Bar',
          extra: {
            [EXTENSION_KEY]: {
              [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: { id: 1 },
            },
          },
        },
      },
      {
        role: 'user',
        content: '"A glass of water please" I say and sit down at the bar.',
        source: {
          name: 'Tobias',
        },
      },
    ] as any;

    const result = includeZTrackerMessages(messages, makeSettings(1)) as any[];

    expect(result[0]).toMatchObject({
      role: 'assistant',
      name: 'Bar',
      content: 'As you enter the bar you realize you are the only customer.',
    });
    expect(result[2]).toMatchObject({
      role: 'user',
      name: 'Tobias',
      content: '"A glass of water please" I say and sit down at the bar.',
    });
    expect(result[1]).not.toHaveProperty('name');
  });

  it('falls back to source message names when prompt-builder keeps speaker attribution there', () => {
    const messages = [
      {
        role: 'assistant',
        content: 'The barkeeper sets down the glass.',
        source: {
          name: 'Bar',
        },
      },
      {
        role: 'user',
        content: 'Thank you.',
        source: {
          name: 'Tobias',
        },
      },
    ] as any;

    expect(sanitizeMessagesForGeneration(messages)).toEqual([
      {
        role: 'assistant',
        content: 'The barkeeper sets down the glass.',
        name: 'Bar',
      },
      {
        role: 'user',
        content: 'Thank you.',
        name: 'Tobias',
      },
    ]);
  });

  it('inlines assistant and user speaker names into content for text-completion prompts', () => {
    const messages = [
      {
        role: 'assistant',
        content: 'As you enter the bar you realize you are the only customer.',
        source: {
          name: 'Bar',
        },
      },
      {
        role: 'user',
        content: '"A glass of water please" I say and sit down at the bar.',
        source: {
          name: 'Tobias',
        },
      },
      {
        role: 'system',
        content: 'Scene details:\ntime: 14:32:05',
      },
    ] as any;

    expect(sanitizeMessagesForGeneration(messages, { inlineNamesIntoContent: true })).toEqual([
      {
        role: 'assistant',
        content: 'Bar: As you enter the bar you realize you are the only customer.',
      },
      {
        role: 'user',
        content: 'Tobias: "A glass of water please" I say and sit down at the bar.',
      },
      {
        role: 'system',
        content: 'Scene details:\ntime: 14:32:05',
      },
    ]);
  });

  it('does not duplicate an existing speaker prefix when inlining text-completion prompts', () => {
    const messages = [
      {
        role: 'assistant',
        content: 'Bar: As you enter the bar you realize you are the only customer.',
        source: {
          name: 'Bar',
        },
      },
      {
        role: 'user',
        content: 'Tobias: "A glass of water please" I say and sit down at the bar.',
        source: {
          name: 'Tobias',
        },
      },
    ] as any;

    expect(sanitizeMessagesForGeneration(messages, { inlineNamesIntoContent: true })).toEqual([
      {
        role: 'assistant',
        content: 'Bar: As you enter the bar you realize you are the only customer.',
      },
      {
        role: 'user',
        content: 'Tobias: "A glass of water please" I say and sit down at the bar.',
      },
    ]);
  });
});
