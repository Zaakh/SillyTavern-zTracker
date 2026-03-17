import { jest } from '@jest/globals';
import {
  ensureZTrackerSystemPromptPresetInstalled,
  hasSystemPromptPreset,
  listSystemPromptPresetNames,
  resolveTrackerSystemPromptName,
  shouldForceTrackerSystemPromptSelection,
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

  test('forces saved system prompt selection only when a saved name is configured', () => {
    expect(
      shouldForceTrackerSystemPromptSelection({
        trackerSystemPromptMode: 'saved',
        trackerSystemPromptSavedName: 'zTracker',
      }),
    ).toBe(true);

    expect(
      shouldForceTrackerSystemPromptSelection({
        trackerSystemPromptMode: 'saved',
        trackerSystemPromptSavedName: '',
      }),
    ).toBe(false);

    expect(
      shouldForceTrackerSystemPromptSelection({
        trackerSystemPromptMode: 'profile',
        trackerSystemPromptSavedName: 'zTracker',
      }),
    ).toBe(false);
  });
});
