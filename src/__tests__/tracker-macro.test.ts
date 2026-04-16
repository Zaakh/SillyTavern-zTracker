import { jest } from '@jest/globals';
import { EXTENSION_KEY } from '../extension-metadata.js';
import { CHAT_MESSAGE_SCHEMA_VALUE_KEY } from '../tracker.js';
import {
  buildZTrackerMacroText,
  expandZTrackerMacrosInText,
  findLatestTrackerMessage,
  registerZTrackerMacro,
} from '../tracker-macro.js';

describe('tracker macro helpers', () => {
  test('finds the latest tracker-bearing message', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: 'base',
        extra: {
          [EXTENSION_KEY]: {
            [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: { id: 1 },
          },
        },
      },
      {
        role: 'user',
        content: 'latest',
        extra: {
          [EXTENSION_KEY]: {
            [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: { id: 2 },
          },
        },
      },
    ] as any[];

    expect(findLatestTrackerMessage(messages)).toMatchObject({ content: 'latest' });
  });

  test('builds fenced tracker text for the macro from the latest tracker message', () => {
    const text = buildZTrackerMacroText(
      [
        {
          role: 'assistant',
          content: 'base',
          extra: {
            [EXTENSION_KEY]: {
              [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: { id: 1, time: '10:00' },
            },
          },
        },
      ] as any,
      {
        embedZTrackerSnapshotHeader: 'Tracker:',
        embedZTrackerSnapshotTransformPreset: 'default',
        embedZTrackerSnapshotTransformPresets: {
          default: {
            name: 'Default',
            input: 'pretty_json',
            pattern: '',
            flags: 'g',
            replacement: '',
            codeFenceLang: 'json',
            wrapInCodeFence: true,
          },
        },
        debugLogging: false,
      },
    );

    expect(text).toContain('Tracker:');
    expect(text).toContain('```json');
    expect(text).toContain('"time": "10:00"');
  });

  test('registers the zTracker macro through SillyTavern macros API', () => {
    const register = jest.fn();
    const unregisterMacro = jest.fn();

    const didRegister = registerZTrackerMacro(
      () => ({
        chat: [
          {
            role: 'assistant',
            content: 'base',
            extra: {
              [EXTENSION_KEY]: {
                [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: { id: 1 },
              },
            },
          },
        ],
        macros: {
          register,
          unregisterMacro,
          registry: { unregisterMacro },
          category: { UTILITY: 'utility' },
        },
      }),
      () => ({
        embedZTrackerSnapshotHeader: 'Tracker:',
        embedZTrackerSnapshotTransformPreset: 'default',
        embedZTrackerSnapshotTransformPresets: {
          default: {
            name: 'Default',
            input: 'pretty_json',
            pattern: '',
            flags: 'g',
            replacement: '',
            codeFenceLang: 'json',
            wrapInCodeFence: true,
          },
        },
        debugLogging: false,
      }),
    );

    expect(didRegister).toBe(true);
    expect(unregisterMacro).toHaveBeenCalledWith('zTracker');
    expect(register).toHaveBeenCalledWith('zTracker', expect.objectContaining({ description: expect.any(String) }));
  });

  test('expands zTracker tokens in external prompt text before Handlebars rendering', () => {
    const rendered = expandZTrackerMacrosInText(
      'System\n{{zTracker}}\nEnd',
      [
        {
          role: 'assistant',
          content: 'base',
          extra: {
            [EXTENSION_KEY]: {
              [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: { id: 2, name: 'Bar' },
            },
          },
        },
      ] as any,
      {
        embedZTrackerSnapshotHeader: 'Tracker:',
        embedZTrackerSnapshotTransformPreset: 'default',
        embedZTrackerSnapshotTransformPresets: {
          default: {
            name: 'Default',
            input: 'pretty_json',
            pattern: '',
            flags: 'g',
            replacement: '',
            codeFenceLang: 'json',
            wrapInCodeFence: true,
          },
        },
        debugLogging: false,
      },
    );

    expect(rendered).toContain('System');
    expect(rendered).toContain('Tracker:');
    expect(rendered).toContain('"name": "Bar"');
    expect(rendered).toContain('End');
  });
});
