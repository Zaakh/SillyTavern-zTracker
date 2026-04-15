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
import {
  LEGACY_PROMPT_TOON,
  LEGACY_PROMPT_XML,
  ZTRACKER_SYSTEM_PROMPT_PRESET_NAME,
  ZTRACKER_SYSTEM_PROMPT_TEXT,
  DEFAULT_PROMPT_TOON,
  PREVIOUS_DEFAULT_PROMPT_TOON,
  DEFAULT_PROMPT_XML,
  PREVIOUS_DEFAULT_PROMPT_XML,
  migrateLegacyPromptTemplates,
} from '../config.js';

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

  test('resolves the active global system prompt in profile mode', () => {
    expect(
      resolveTrackerSystemPromptName(
        {
          trackerSystemPromptMode: 'profile',
          trackerSystemPromptSavedName: 'zTracker',
        },
        {
          getPresetManager: () => ({
            getPresetList: () => ({ presets: [], preset_names: [] }),
          }),
          powerUserSettings: {
            sysprompt: {
              name: 'Active Prompt',
            },
          },
        },
      ),
    ).toBe('Active Prompt');
  });

  test('resolves saved system prompt in saved mode', () => {
    expect(
      resolveTrackerSystemPromptName(
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
              name: 'Profile Prompt',
            },
          },
        },
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

  test('migrates legacy XML and TOON prompt templates without touching customized values', () => {
    const legacySettings = {
      promptXml: LEGACY_PROMPT_XML,
      promptToon: LEGACY_PROMPT_TOON,
    };

    expect(migrateLegacyPromptTemplates(legacySettings)).toBe(true);
    expect(legacySettings.promptXml).toBe(DEFAULT_PROMPT_XML);
    expect(legacySettings.promptToon).toBe(DEFAULT_PROMPT_TOON);

    const customizedSettings = {
      promptXml: `${LEGACY_PROMPT_XML}\ncustomized`,
      promptToon: `${LEGACY_PROMPT_TOON}\ncustomized`,
    };

    expect(migrateLegacyPromptTemplates(customizedSettings)).toBe(false);
    expect(customizedSettings.promptXml).toContain('customized');
    expect(customizedSettings.promptToon).toContain('customized');
  });

  test('migrates the previous XML schema-wrapper prompt to the current default', () => {
    const settings = {
      promptXml: PREVIOUS_DEFAULT_PROMPT_XML,
      promptToon: DEFAULT_PROMPT_TOON,
    };

    expect(migrateLegacyPromptTemplates(settings)).toBe(true);
    expect(settings.promptXml).toBe(DEFAULT_PROMPT_XML);
    expect(settings.promptToon).toBe(DEFAULT_PROMPT_TOON);
  });

  test('migrates the previous TOON prompt to the stronger current default', () => {
    const settings = {
      promptXml: DEFAULT_PROMPT_XML,
      promptToon: PREVIOUS_DEFAULT_PROMPT_TOON,
    };

    expect(migrateLegacyPromptTemplates(settings)).toBe(true);
    expect(settings.promptXml).toBe(DEFAULT_PROMPT_XML);
    expect(settings.promptToon).toBe(DEFAULT_PROMPT_TOON);
  });

  test('ships a TOON prompt that explicitly forbids JSON-like output and wrapper objects', () => {
    expect(DEFAULT_PROMPT_TOON).toContain('DO NOT output JSON, XML, JavaScript objects, braces, brackets, commas between fields, or quoted property names.');
    expect(DEFAULT_PROMPT_TOON).toContain('Do not invent wrapper keys like `root`, `scene`, `data`, or `response` unless the schema explicitly requires them.');
    expect(DEFAULT_PROMPT_TOON).toContain('For uniform arrays of objects, preserve the tabular TOON layout shown in the example, including the header row and tab-delimited values.');
  });
});
