import type { ExtensionSettings } from '../config.js';
import {
  extractLeadingSystemPrompt,
  includeZTrackerMessages,
  normalizeTrackerGenerationConversationRoles,
  sanitizeMessagesForGeneration,
  CHAT_MESSAGE_SCHEMA_VALUE_KEY,
} from '../tracker.js';
import { EXTENSION_KEY } from '../extension-metadata.js';

describe('includeZTrackerMessages', () => {
  const makeSettings = (
    count: number,
    role?: ExtensionSettings['embedZTrackerRole'],
    asCharacter = false,
    header = 'Tracker:',
  ) => {
    return {
      includeLastXZTrackerMessages: count,
      embedZTrackerRole: role,
      embedZTrackerAsCharacter: asCharacter,
      embedZTrackerSnapshotHeader: header,
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

  it('can inject tracker snapshots as a virtual character name', () => {
    const messages = [
      buildMessageWithTracker({ id: 1 }),
      { content: 'current', role: 'user' },
    ];

    const result = includeZTrackerMessages(messages as any, makeSettings(1, 'assistant', true)) as any[];

    expect(result).toHaveLength(3);
    expect(result[1].role).toBe('assistant');
    expect(result[1].name).toBe('Tracker');
    expect(result[1].content).not.toContain('Tracker:');
    expect(result[1].content).toContain('```json');
  });

  it('falls back to Tracker when the configured header is blank in virtual-character mode', () => {
    const messages = [
      buildMessageWithTracker({ id: 1 }),
      { content: 'current', role: 'user' },
    ];

    const result = includeZTrackerMessages(messages as any, makeSettings(1, 'system', true, '   ')) as any[];

    expect(result[1].role).toBe('system');
    expect(result[1].name).toBe('Tracker');
    expect(result[1].content).not.toContain('Tracker:');
  });

  it('strips trailing punctuation from the virtual-character label', () => {
    const messages = [
      buildMessageWithTracker({ id: 1 }),
      { content: 'current', role: 'user' },
    ];

    const result = includeZTrackerMessages(messages as any, makeSettings(1, 'assistant', true, 'Tracker Log:  ')) as any[];

    expect(result[1].name).toBe('Tracker Log');
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

  it('rewrites system snapshot injections to user turns for text-completion-safe prompt assembly', () => {
    const messages = [
      buildMessageWithTracker({ id: 1 }),
      { content: 'current', role: 'assistant' },
    ];

    const result = includeZTrackerMessages(
      messages as any,
      makeSettings(1, 'system', true, 'Scene details:'),
      { preserveTextCompletionTurnAlternation: true },
    ) as any[];

    expect(result).toHaveLength(3);
    expect(result[1].role).toBe('user');
    expect(result[1].name).toBe('Scene details');
    expect(result[1].is_user).toBe(true);
    expect(result[1].is_system).toBe(false);
  });

  it('inlines text-completion-safe tracker snapshots into user turns to avoid nested instruct blocks', () => {
    const messages = [
      {
        content: '"A drink, please."',
        role: 'user',
        extra: {
          [EXTENSION_KEY]: {
            [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: {
              time: '18:30:00; 09/15/2023 (Friday)',
              location: 'Inside a bar',
              changes: 'Customer entered the bar and ordered a drink.',
            },
          },
        },
      },
    ];

    const result = includeZTrackerMessages(
      messages as any,
      makeSettings(1, 'system', true, 'Scene details:'),
      { preserveTextCompletionTurnAlternation: true },
    ) as any[];

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toContain('"A drink, please."\n\nScene details:\n');
    expect(result[0].content).toContain('18:30:00; 09/15/2023 (Friday)');
    expect(result[0].content).toContain('Customer entered the bar and ordered a drink.');
  });

  it('inlines text-completion-safe tracker snapshots into live is_user chat turns', () => {
    const messages = [
      {
        content: '"A drink, please."',
        is_user: true,
        extra: {
          [EXTENSION_KEY]: {
            [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: {
              time: '18:30:00; 09/15/2023 (Friday)',
              location: 'Inside a bar',
              changes: 'Customer entered the bar and ordered a drink.',
            },
          },
        },
      },
    ];

    const result = includeZTrackerMessages(
      messages as any,
      makeSettings(1, 'system', true, 'Scene details:'),
      { preserveTextCompletionTurnAlternation: true },
    ) as any[];

    expect(result).toHaveLength(1);
    expect(result[0].is_user).toBe(true);
    expect(result[0].content).toContain('"A drink, please."\n\nScene details:\n');
    expect(result[0].content).toContain('18:30:00; 09/15/2023 (Friday)');
    expect(result[0].content).toContain('Customer entered the bar and ordered a drink.');
  });

  it('preserves mes-only live user content when inlining text-completion-safe tracker snapshots', () => {
    const messages = [
      {
        is_user: true,
        mes: '"A drink, please."',
        extra: {
          [EXTENSION_KEY]: {
            [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: {
              time: '18:30:00; 09/15/2023 (Friday)',
              location: 'Inside a bar',
              changes: 'Customer entered the bar and ordered a drink.',
            },
          },
        },
      },
    ];

    const result = includeZTrackerMessages(
      messages as any,
      makeSettings(1, 'system', true, 'Scene details:'),
      { preserveTextCompletionTurnAlternation: true },
    ) as any[];

    expect(result).toHaveLength(1);
    expect(result[0].is_user).toBe(true);
    expect(result[0].content).toContain('"A drink, please."\n\nScene details:\n');
    expect(result[0].mes).toContain('"A drink, please."\n\nScene details:\n');
  });

  it('keeps terminal assistant virtual-character snapshots after trailing assistant prefill in text-completion-safe mode', () => {
    const messages = [
      {
        is_user: true,
        mes: '"A drink, please."',
        extra: {
          [EXTENSION_KEY]: {
            [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: {
              time: '18:30:00; 09/15/2023 (Friday)',
              location: 'Inside a bar',
              changes: 'Customer entered the bar and ordered a drink.',
            },
          },
        },
      },
      {
        role: 'assistant',
        content: '',
        name: 'Bar',
      },
    ];

    const settings = makeSettings(1, 'assistant', true, 'Scene details:');
    settings.embedZTrackerSnapshotTransformPreset = 'minimal';

    const result = includeZTrackerMessages(
      messages as any,
      settings,
      { preserveTextCompletionTurnAlternation: true, isGroupChat: false },
    ) as any[];

    expect(result).toHaveLength(3);
    expect(result[0].mes).toBe('"A drink, please."');
    expect(result[1].role).toBe('assistant');
    expect(result[1].content).toBe('');
    expect(result[2].role).toBe('assistant');
    expect(result[2].ignoreInstruct).toBe(true);
    expect(result[2]).not.toHaveProperty('name');
    expect(result[2].content).toContain('Scene details:\n');
    expect(result[2].content).toContain('time: 18:30:00; 09/15/2023 (Friday)');
    expect(result[2].content).toMatch(/\nBar:$/);
  });

  it('keeps assistant virtual-character snapshots anchored after the tracked user turn in multi-character chats', () => {
    const messages = [
      {
        is_user: true,
        mes: '"A drink, please."',
        extra: {
          [EXTENSION_KEY]: {
            [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: {
              time: '18:30:00; 09/15/2023 (Friday)',
              location: 'Inside a bar',
              changes: 'Customer entered the bar and ordered a drink.',
            },
          },
        },
      },
      {
        role: 'assistant',
        content: 'Silvia pours the drink and sets it on the counter.',
        name: 'Bar',
      },
      {
        role: 'assistant',
        content: 'What brings you to Eldoria\'s forest?',
        name: 'Seraphina',
      },
      {
        role: 'assistant',
        content: '',
        name: 'Bar',
      },
    ];

    const settings = makeSettings(1, 'assistant', true, 'Scene details:');
    settings.embedZTrackerSnapshotTransformPreset = 'minimal';

    const result = includeZTrackerMessages(
      messages as any,
      settings,
      { preserveTextCompletionTurnAlternation: true, isGroupChat: false },
    ) as any[];

    expect(result).toHaveLength(5);
    expect(result[1].role).toBe('assistant');
    expect(result[1].name).toBe('Scene details');
    expect(result[1]).not.toHaveProperty('ignoreInstruct');
    expect(result[1].content).not.toContain('Scene details:');
    expect(result[1].content).toContain('time: 18:30:00; 09/15/2023 (Friday)');
    expect(result[2]).toMatchObject({ role: 'assistant', name: 'Bar' });
    expect(result[3]).toMatchObject({ role: 'assistant', name: 'Seraphina' });
    expect(result[4]).toMatchObject({ role: 'assistant', name: 'Bar', content: '' });
  });

  it('keeps terminal assistant virtual-character snapshots as assistant turns in normal chats', () => {
    const messages = [
      {
        role: 'assistant',
        content: 'As you enter the bar you realize you are the only customer.',
        name: 'Bar',
      },
      {
        is_user: true,
        mes: '"A drink, please."',
        extra: {
          [EXTENSION_KEY]: {
            [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: {
              time: '18:30:00; 09/15/2023 (Friday)',
              location: 'Inside a bar',
              changes: 'Customer entered the bar and ordered a drink.',
            },
          },
        },
      },
    ];

    const settings = makeSettings(1, 'assistant', true, 'Scene tracker:');
    settings.embedZTrackerSnapshotTransformPreset = 'minimal';

    const result = includeZTrackerMessages(
      messages as any,
      settings,
      { preserveTextCompletionTurnAlternation: true, isGroupChat: false },
    ) as any[];

    expect(result).toHaveLength(3);
    expect(result[1].is_user).toBe(true);
    expect(result[1].mes).toBe('"A drink, please."');
    expect(result[2].role).toBe('assistant');
    expect(result[2].ignoreInstruct).toBe(true);
    expect(result[2]).not.toHaveProperty('name');
    expect(result[2].content).toContain('Scene tracker:\n');
    expect(result[2].content).toContain('time: 18:30:00; 09/15/2023 (Friday)');
    expect(result[2].content).toMatch(/\nBar:$/);
  });

  it('keeps terminal assistant virtual-character snapshots inline in group chats until the host confirms a single-speaker chat', () => {
    const messages = [
      {
        role: 'assistant',
        content: 'As you enter the bar you realize you are the only customer.',
        name: 'Bar',
      },
      {
        is_user: true,
        mes: '"A drink, please."',
        extra: {
          [EXTENSION_KEY]: {
            [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: {
              time: '18:30:00; 09/15/2023 (Friday)',
              location: 'Inside a bar',
              changes: 'Customer entered the bar and ordered a drink.',
            },
          },
        },
      },
    ];

    const settings = makeSettings(1, 'assistant', true, 'Scene tracker:');
    settings.embedZTrackerSnapshotTransformPreset = 'minimal';

    const result = includeZTrackerMessages(
      messages as any,
      settings,
      { preserveTextCompletionTurnAlternation: true, isGroupChat: true },
    ) as any[];

    expect(result).toHaveLength(2);
    expect(result[1].is_user).toBe(true);
    expect(result[1].mes).toContain('"A drink, please."\n\nScene tracker:\n');
    expect(result[1].mes).toContain('time: 18:30:00; 09/15/2023 (Friday)');
    expect(result[1].mes).toContain('Customer entered the bar and ordered a drink.');
  });

  it('inlines terminal assistant virtual-character snapshots into the final user turn in text-completion-safe mode', () => {
    const messages = [
      {
        is_user: true,
        mes: '"A drink, please."',
        extra: {
          [EXTENSION_KEY]: {
            [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: {
              time: '18:30:00; 09/15/2023 (Friday)',
              location: 'Inside a bar',
              changes: 'Customer entered the bar and ordered a drink.',
            },
          },
        },
      },
    ];

    const settings = makeSettings(1, 'assistant', true, 'Scene details:');
    settings.embedZTrackerSnapshotTransformPreset = 'minimal';

    const result = includeZTrackerMessages(
      messages as any,
      settings,
      { preserveTextCompletionTurnAlternation: true },
    ) as any[];

    expect(result).toHaveLength(1);
    expect(result[0].is_user).toBe(true);
    expect(result[0].mes).toContain('"A drink, please."\n\nScene details:\n');
    expect(result[0].mes).toContain('time: 18:30:00; 09/15/2023 (Friday)');
    expect(result[0].mes).toContain('Customer entered the bar and ordered a drink.');
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

  it('extracts consecutive leading system messages into one story-string candidate', () => {
    const result = extractLeadingSystemPrompt([
      { role: 'system', content: 'Primary system prompt' },
      { role: 'system', content: 'World info block' },
      { role: 'user', content: 'Prior chat message' },
    ]);

    expect(result).toEqual({
      systemPrompt: 'Primary system prompt\n\nWorld info block',
      remainingMessages: [
        { role: 'user', content: 'Prior chat message' },
      ],
    });
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

  it('keeps normal chat names while giving injected snapshots their own virtual-character name', () => {
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

    const result = includeZTrackerMessages(messages, makeSettings(1, 'assistant', true)) as any[];

    expect(result[0]).toMatchObject({
      role: 'assistant',
      name: 'Bar',
    });
    expect(result[1]).toMatchObject({
      role: 'assistant',
      name: 'Tracker',
    });
    expect(result[2]).toMatchObject({
      role: 'user',
      name: 'Tobias',
    });
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

  it('inserts the active user-alignment message before assistant-opening text-completion prompts', () => {
    const messages = [
      {
        role: 'system',
        content: 'You are a structured data extraction assistant.',
      },
      {
        role: 'assistant',
        content: 'As you enter the bar you realize you are the only customer.',
        source: {
          name: 'Bar',
        },
      },
      {
        role: 'user',
        content: 'Just water, please.',
        source: {
          name: 'Tobias',
        },
      },
    ] as any;

    expect(sanitizeMessagesForGeneration(messages, {
      inlineNamesIntoContent: true,
      userAlignmentMessage: 'Let\'s get started. Please respond based on the information and instructions provided above.',
      userName: 'Tobias',
    })).toEqual([
      {
        role: 'system',
        content: 'You are a structured data extraction assistant.',
      },
      {
        role: 'user',
        content: 'Tobias: Let\'s get started. Please respond based on the information and instructions provided above.',
      },
      {
        role: 'assistant',
        content: 'Bar: As you enter the bar you realize you are the only customer.',
      },
      {
        role: 'user',
        content: 'Tobias: Just water, please.',
      },
    ]);
  });

  it('does not insert the active user-alignment message when the prompt already starts with a user turn', () => {
    const messages = [
      {
        role: 'system',
        content: 'You are a structured data extraction assistant.',
      },
      {
        role: 'user',
        content: 'Just water, please.',
        source: {
          name: 'Tobias',
        },
      },
    ] as any;

    expect(sanitizeMessagesForGeneration(messages, {
      inlineNamesIntoContent: true,
      userAlignmentMessage: 'Let\'s get started. Please respond based on the information and instructions provided above.',
      userName: 'Tobias',
    })).toEqual([
      {
        role: 'system',
        content: 'You are a structured data extraction assistant.',
      },
      {
        role: 'user',
        content: 'Tobias: Just water, please.',
      },
    ]);
  });

  it('normalizes user turns to assistant for tracker generation when configured', () => {
    const messages = [
      { role: 'system', content: 'Tracker instructions' },
      { role: 'user', content: 'Just water, please.', name: 'Tobias' },
      { role: 'assistant', content: 'The barkeeper nods.', name: 'Bar' },
    ] as any;

    expect(normalizeTrackerGenerationConversationRoles(messages, {
      trackerGenerationConversationRoleMode: 'all_assistant',
    } as ExtensionSettings)).toEqual([
      { role: 'system', content: 'Tracker instructions' },
      { role: 'assistant', content: 'Just water, please.', name: 'Tobias' },
      { role: 'assistant', content: 'The barkeeper nods.', name: 'Bar' },
    ]);
  });

  it('leaves embedded tracker snapshot roles unchanged during normalization', () => {
    const messages = includeZTrackerMessages([
      buildMessageWithTracker({ id: 7 }),
      { content: 'Current turn', role: 'user' },
    ] as any, makeSettings(1)) as any[];

    expect(normalizeTrackerGenerationConversationRoles(messages, {
      trackerGenerationConversationRoleMode: 'all_assistant',
    } as ExtensionSettings)).toEqual([
      expect.objectContaining({
        role: 'assistant',
        content: 'base',
      }),
      expect.objectContaining({
        role: 'user',
      }),
      expect.objectContaining({
        role: 'assistant',
        content: 'Current turn',
      }),
    ]);
  });

  it('leaves tracker-generation roles unchanged when preservation mode is active', () => {
    const messages = [
      { role: 'system', content: 'Tracker instructions' },
      { role: 'user', content: 'Just water, please.' },
      { role: 'assistant', content: 'The barkeeper nods.' },
    ] as any;

    expect(normalizeTrackerGenerationConversationRoles(messages, {
      trackerGenerationConversationRoleMode: 'preserve',
    } as ExtensionSettings)).toEqual(messages);
  });
});
