/**
 * @jest-environment node
 */

/**
 * Covers src/startup.ts's branch-selection logic (fresh-install seeding vs. legacy-settings
 * migration) in isolation, since src/index.tsx itself is never imported in tests (see CLAUDE.md).
 */
import { jest } from '@jest/globals';

const seedStarterTrackerModulesMock = jest.fn(async () => []);

jest.unstable_mockModule('../fresh-install-seeding.js', () => ({
  seedStarterTrackerModules: seedStarterTrackerModulesMock,
}));

const { initializeStartupSettings } = await import('../startup.js');

function makeLegacySettings() {
  return {
    version: '0.1.0',
    formatVersion: 'F_1.0',
    modules: [],
    debugLogging: false,
    connectionSource: 'active',
    profileId: '',
    trackerSystemPromptMode: 'profile',
    trackerSystemPromptSavedName: '',
    maxResponseToken: 16000,
    schemaPreset: 'default',
    schemaPresets: {},
    prompt: 'a prompt',
    skipFirstXMessages: 0,
    includeLastXMessages: 0,
    skipCharacterCardInTrackerGeneration: false,
    trackerGenerationConversationRoleMode: 'preserve',
    includeLastXZTrackerMessages: 1,
    embedZTrackerRole: 'user',
    embedZTrackerAsCharacter: false,
    embedZTrackerSnapshotHeader: 'Tracker:',
    embedZTrackerSnapshotTransformPreset: 'default',
    embedZTrackerSnapshotTransformPresets: {},
    promptEngineeringMode: 'native',
    trackerWorldInfoPolicyMode: 'include_all',
    trackerWorldInfoAllowlistBookNames: [],
    trackerWorldInfoAllowlistEntryIds: [],
  } as any;
}

describe('initializeStartupSettings', () => {
  beforeEach(() => {
    seedStarterTrackerModulesMock.mockClear();
    seedStarterTrackerModulesMock.mockImplementation(async () => []);
  });

  test('fresh install seeds starter templates and never runs the legacy migration pipeline', async () => {
    const settings: any = { version: '0.1.0', formatVersion: 'F_2.0', modules: [], debugLogging: false };
    const settingsManager = { getSettings: () => settings, saveSettings: jest.fn() };

    await initializeStartupSettings({ isFreshInstall: true, settingsManager, importMetaUrl: 'file:///dist/index.js' });

    expect(seedStarterTrackerModulesMock).toHaveBeenCalledTimes(1);
    expect(seedStarterTrackerModulesMock).toHaveBeenCalledWith({ settingsManager, importMetaUrl: 'file:///dist/index.js' });
    // Guards the bug this test was added for: the legacy migration pipeline must not run on a
    // fresh install - it would otherwise fabricate a legacy "Default" module before seeding
    // could populate anything real (settings.modules would go from [] to [Default] here).
    expect(settings.modules).toEqual([]);
  });

  test('a seeding failure on a fresh install is caught, not thrown', async () => {
    seedStarterTrackerModulesMock.mockRejectedValueOnce(new Error('network down'));
    const settings: any = { version: '0.1.0', formatVersion: 'F_2.0', modules: [], debugLogging: false };
    const settingsManager = { getSettings: () => settings, saveSettings: jest.fn() };

    await expect(
      initializeStartupSettings({ isFreshInstall: true, settingsManager, importMetaUrl: 'file:///dist/index.js' }),
    ).resolves.toBeUndefined();
  });

  test('an upgrading install runs the legacy migration pipeline once, without seeding', async () => {
    const settings = makeLegacySettings();
    const saveSettings = jest.fn();
    const settingsManager = { getSettings: () => settings, saveSettings };

    await initializeStartupSettings({ isFreshInstall: false, settingsManager, importMetaUrl: 'file:///dist/index.js' });

    expect(seedStarterTrackerModulesMock).not.toHaveBeenCalled();
    expect(settings.modules).toHaveLength(1);
    expect(settings.formatVersion).toBe('F_2.0');
    expect(settings.modules[0].systemPrompt.content).toBe('');
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  test('an upgrading install with corrupted (empty) modules on an already-current format still recovers a module', async () => {
    // Not a fresh install (oldSettings !== null upstream), but the module collection is empty
    // despite formatVersion already being current - the same "corrupted settings" shape
    // migrateLegacySettingsToModules already recovers from today, unrelated to fresh-install
    // seeding (see module-storage-migration spec's recovery scenarios).
    const settings: any = { version: '0.1.0', formatVersion: 'F_2.0', modules: [], debugLogging: false };
    const saveSettings = jest.fn();
    const settingsManager = { getSettings: () => settings, saveSettings };

    await initializeStartupSettings({ isFreshInstall: false, settingsManager, importMetaUrl: 'file:///dist/index.js' });

    expect(seedStarterTrackerModulesMock).not.toHaveBeenCalled();
    expect(settings.modules).toHaveLength(1);
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  test('an upgrading install with a Module that already has systemPrompt.content leaves it untouched', async () => {
    const settings: any = {
      version: '0.1.0',
      formatVersion: 'F_2.0',
      modules: [
        {
          id: 'scene-tracker',
          name: 'Scene Tracker',
          enabled: true,
          order: 0,
          auto: { enabled: false, direction: 'both' },
          systemPrompt: { mode: 'saved', savedName: 'zTracker-SceneTracker-1.0', content: 'existing content' },
          generation: { includeModules: [{ target: 'self', count: 1 }] },
          injection: { includeLastXMessages: 1 },
        },
      ],
      debugLogging: false,
    };
    const settingsManager = { getSettings: () => settings, saveSettings: jest.fn() };

    await initializeStartupSettings({ isFreshInstall: false, settingsManager, importMetaUrl: 'file:///dist/index.js' });

    expect(seedStarterTrackerModulesMock).not.toHaveBeenCalled();
    // migrateTrackerModuleSystemPromptContent is idempotent for a Module that already stores a
    // string `content` - it must never overwrite existing (possibly customized) content with ''.
    expect(settings.modules[0].systemPrompt.content).toBe('existing content');
  });

  test('an error while reading settings on an upgrading install propagates to the caller', async () => {
    const settingsManager = {
      getSettings: () => {
        throw new Error('settings read failed');
      },
      saveSettings: jest.fn(),
    };

    await expect(
      initializeStartupSettings({ isFreshInstall: false, settingsManager, importMetaUrl: 'file:///dist/index.js' }),
    ).rejects.toThrow('settings read failed');
  });
});
