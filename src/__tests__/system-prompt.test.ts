import { jest } from '@jest/globals';
import {
  ensureZTrackerSystemPromptPresetInstalled,
  getCurrentGlobalSystemPromptName,
  getSystemPromptPresetContent,
  hasSystemPromptPreset,
  insertSystemPromptMessage,
  listSystemPromptPresetNames,
  resolveTrackerSystemPromptName,
  shouldWarnAboutSharedSystemPromptSelection,
} from '../system-prompt.js';
import { ZTRACKER_SYSTEM_PROMPT_PRESET_NAME, ZTRACKER_SYSTEM_PROMPT_TEXT } from '../config.js';

describe('system prompt helpers', () => {
  test('lists preset names from array-based preset list', () => {
    const names = listSystemPromptPresetNames({
      getPresetManager: () => ({
        getPresetList: () => ({
          presets: [],
          preset_names: ['Default', 'zTracker'],
        }),
        getCompletionPresetByName: () => undefined,
      }),
    });

    expect(names).toEqual(['Default', 'zTracker']);
  });

  test('lists preset names from object-based preset list', () => {
    const names = listSystemPromptPresetNames({
      getPresetManager: () => ({
        getPresetList: () => ({
          presets: [],
          preset_names: { Default: 0, zTracker: 1 },
        }),
        getCompletionPresetByName: () => undefined,
      }),
    });

    expect(names).toEqual(['Default', 'zTracker']);
  });

  test('prefers getAllPresets when available', () => {
    const names = listSystemPromptPresetNames({
      getPresetManager: () => ({
        getAllPresets: () => ['Default', 'zTracker'],
        getPresetList: () => ({
          presets: [],
          preset_names: [],
        }),
        getCompletionPresetByName: () => undefined,
      }),
    });

    expect(names).toEqual(['Default', 'zTracker']);
  });

  test('installs shipped zTracker system prompt when missing', async () => {
    const savePreset = jest.fn(async () => undefined);

    const installed = await ensureZTrackerSystemPromptPresetInstalled({
      getPresetManager: () => ({
        getCompletionPresetByName: () => undefined,
        getPresetList: () => ({ presets: [], preset_names: [] }),
        savePreset,
      }),
    });

    expect(installed).toBe(true);
    expect(savePreset).toHaveBeenCalledWith(ZTRACKER_SYSTEM_PROMPT_PRESET_NAME, {
      name: ZTRACKER_SYSTEM_PROMPT_PRESET_NAME,
      content: ZTRACKER_SYSTEM_PROMPT_TEXT,
    });
  });

  test('does not overwrite existing shipped zTracker system prompt', async () => {
    const savePreset = jest.fn(async () => undefined);

    const installed = await ensureZTrackerSystemPromptPresetInstalled({
      getPresetManager: () => ({
        getCompletionPresetByName: () => ({
          name: ZTRACKER_SYSTEM_PROMPT_PRESET_NAME,
          content: 'customized',
        }),
        getPresetList: () => ({ presets: [], preset_names: [] }),
        savePreset,
      }),
    });

    expect(installed).toBe(false);
    expect(savePreset).not.toHaveBeenCalled();
  });

  test('checks whether a saved preset exists', () => {
    expect(
      hasSystemPromptPreset('zTracker', {
        getPresetManager: () => ({
          getCompletionPresetByName: (name?: string) =>
            name === 'zTracker' ? { name: 'zTracker', content: 'x' } : undefined,
          getPresetList: () => ({ presets: [], preset_names: [] }),
        }),
      }),
    ).toBe(true);

    expect(
      hasSystemPromptPreset('missing', {
        getPresetManager: () => ({
          getCompletionPresetByName: () => undefined,
          getPresetList: () => ({ presets: [], preset_names: [] }),
        }),
      }),
    ).toBe(false);
  });

  test('returns saved preset content when present', () => {
    expect(
      getSystemPromptPresetContent('zTracker', {
        getPresetManager: () => ({
          getCompletionPresetByName: (name?: string) =>
            name === 'zTracker' ? { name: 'zTracker', content: '  extracted prompt  ' } : undefined,
          getPresetList: () => ({ presets: [], preset_names: [] }),
        }),
      }),
    ).toBe('extracted prompt');
  });

  test('reads the current global system prompt name from power user settings', () => {
    expect(
      getCurrentGlobalSystemPromptName({
        getPresetManager: () => ({
          getPresetList: () => ({ presets: [], preset_names: [] }),
        }),
        powerUserSettings: {
          sysprompt: {
            name: '  Neutral - Chat  ',
          },
        },
      }),
    ).toBe('Neutral - Chat');
  });

  test('resolves profile system prompt in profile mode', () => {
    expect(
      resolveTrackerSystemPromptName(
        {
          trackerSystemPromptMode: 'profile',
          trackerSystemPromptSavedName: 'zTracker',
        },
        { sysprompt: 'Profile Prompt' },
      ),
    ).toBe('Profile Prompt');
  });

  test('resolves saved system prompt in saved mode', () => {
    expect(
      resolveTrackerSystemPromptName(
        {
          trackerSystemPromptMode: 'saved',
          trackerSystemPromptSavedName: 'zTracker',
        },
        { sysprompt: 'Profile Prompt' },
      ),
    ).toBe('zTracker');
  });

  test('warns when tracker saved prompt matches the active global system prompt', () => {
    expect(
      shouldWarnAboutSharedSystemPromptSelection(
        {
          trackerSystemPromptMode: 'saved',
          trackerSystemPromptSavedName: 'zTracker',
        },
        {
          getPresetManager: () => ({
            getPresetList: () => ({ presets: [], preset_names: [] }),
          }),
          powerUserSettings: {
            sysprompt: {
              name: 'ZTRACKER',
            },
          },
        },
      ),
    ).toBe(true);

    expect(
      shouldWarnAboutSharedSystemPromptSelection(
        {
          trackerSystemPromptMode: 'saved',
          trackerSystemPromptSavedName: 'zTracker',
        },
        {
          getPresetManager: () => ({
            getPresetList: () => ({ presets: [], preset_names: [] }),
          }),
          powerUserSettings: {
            sysprompt: {
              name: 'Neutral - Chat',
            },
          },
        },
      ),
    ).toBe(false);
  });

  test('inserts a saved system prompt after existing leading system messages', () => {
    const result = insertSystemPromptMessage(
      [
        { role: 'system', content: 'existing system' },
        { role: 'user', content: 'hello' },
      ],
      'saved tracker prompt',
    );

    expect(result).toEqual([
      { role: 'system', content: 'existing system' },
      { role: 'system', content: 'saved tracker prompt' },
      { role: 'user', content: 'hello' },
    ]);
  });
});
