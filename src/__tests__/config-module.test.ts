/**
 * @jest-environment node
 */

import {
  DEFAULT_MODULE_ID,
  DEFAULT_SCHEMA_HTML,
  DEFAULT_SCHEMA_VALUE,
  defaultSettings,
  applySettingsToTrackerModule,
  createDefaultTrackerModule,
  getSettingsForTrackerModule,
  migrateLegacySettingsToModules,
  migrateLegacyChatMetadataToModules,
  migrateTrackerModuleIncludeLists,
  normalizeTrackerModuleIncludeList,
  pruneTrackerModuleIncludeReferences,
  readModuleChatSchemaPresetKey,
  writeModuleChatSchemaPresetKey,
} from '../config.js';

describe('tracker module defaults', () => {
  test('default settings include the stable default module', () => {
    expect(defaultSettings.modules).toHaveLength(1);
    expect(defaultSettings.modules[0].id).toBe(DEFAULT_MODULE_ID);
    expect(defaultSettings.modules[0].order).toBe(0);
  });

  test('new modules default to enabled with auto mode off', () => {
    const module = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 1 });

    expect(module.id).toBe('agenda');
    expect(module.name).toBe('Agenda');
    expect(module.order).toBe(1);
    expect(module.enabled).toBe(true);
    expect(module.auto.enabled).toBe(false);
  });

  test('module owns schema, prompt, generation, and injection defaults', () => {
    const module = createDefaultTrackerModule();

    expect(module.schema.preset).toBe('default');
    expect(module.schema.presets.default.value).toBe(DEFAULT_SCHEMA_VALUE);
    expect(module.schema.presets.default.html).toBe(DEFAULT_SCHEMA_HTML);
    expect(module.generation.mode).toBe('full');
    expect(module.generation.conversationRoleMode).toBe('preserve');
    expect(module.injection.transformPreset).toBe('default');
    expect(module.injection.transformPresets.default.name).toBe('Default (JSON)');
  });

  test('new modules default to a self-only generation include list', () => {
    const module = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 1 });

    expect(module.generation.includeModules).toEqual([{ target: 'self', count: 1 }]);
  });

  test('legacy flat settings migrate into the default module', () => {
    const legacySettings: any = {
      ...structuredClone(defaultSettings),
      formatVersion: 'F_1.0',
      modules: [],
      connectionSource: 'active',
      profileId: 'profile-1',
      trackerSystemPromptMode: 'saved',
      trackerSystemPromptSavedName: 'System A',
      maxResponseToken: 1234,
      autoMode: 'response',
      sequentialPartGeneration: true,
      schemaPreset: 'agenda',
      schemaPresets: {
        agenda: { name: 'Agenda', value: { type: 'object' }, html: '<div>{{data.goal}}</div>' },
      },
      prompt: 'agenda prompt',
      promptEngineeringMode: 'json',
      promptJson: 'json prompt',
      promptXml: 'xml prompt',
      promptToon: 'toon prompt',
      skipFirstXMessages: 3,
      includeLastXMessages: 4,
      skipCharacterCardInTrackerGeneration: true,
      trackerGenerationConversationRoleMode: 'all_assistant',
      includeLastXZTrackerMessages: 5,
      embedZTrackerRole: 'system',
      embedZTrackerAsCharacter: true,
      embedZTrackerSnapshotHeader: 'Agenda:',
      embedZTrackerSnapshotTransformPreset: 'plain',
      embedZTrackerSnapshotTransformPresets: {
        plain: {
          name: 'Plain',
          input: 'top_level_lines',
          pattern: '',
          flags: 'g',
          replacement: '',
          codeFenceLang: 'text',
        },
      },
      trackerWorldInfoPolicyMode: 'allowlist',
      trackerWorldInfoAllowlistBookNames: ['Book'],
      trackerWorldInfoAllowlistEntryIds: [42],
    };

    expect(migrateLegacySettingsToModules(legacySettings)).toBe(true);

    expect(legacySettings.formatVersion).toBe(defaultSettings.formatVersion);
    expect(legacySettings.modules).toHaveLength(1);
    expect(legacySettings.modules[0]).toEqual(
      expect.objectContaining({
        id: DEFAULT_MODULE_ID,
        name: 'Default',
        enabled: true,
        order: 0,
      }),
    );
    expect(legacySettings.modules[0].auto.enabled).toBe(true);
    expect(legacySettings.modules[0].connection).toEqual({ source: 'active', profileId: 'profile-1' });
    expect(legacySettings.modules[0].systemPrompt).toEqual({ mode: 'saved', savedName: 'System A' });
    expect(legacySettings.modules[0].generation).toEqual(
      expect.objectContaining({
        mode: 'sequential-parts',
        maxResponseToken: 1234,
        skipFirstXMessages: 3,
        includeLastXMessages: 4,
        conversationRoleMode: 'all_assistant',
        worldInfoPolicyMode: 'allowlist',
        worldInfoAllowlistBookNames: ['Book'],
        worldInfoAllowlistEntryIds: [42],
      }),
    );
    expect(legacySettings.modules[0].schema).toEqual({
      preset: 'agenda',
      presets: legacySettings.schemaPresets,
    });
    expect(legacySettings.modules[0].prompts.prompt).toBe('agenda prompt');
    expect(legacySettings.modules[0].prompts.promptEngineeringMode).toBe('json');
    expect(legacySettings.modules[0].injection).toEqual(
      expect.objectContaining({
        includeLastXMessages: 5,
        embedRole: 'system',
        embedAsCharacter: true,
        snapshotHeader: 'Agenda:',
        transformPreset: 'plain',
      }),
    );
    // The mandatory self entry is seeded once from the legacy self-history value (5) during this same upgrade.
    expect(legacySettings.modules[0].generation.includeModules).toEqual([{ target: 'self', count: 5 }]);
  });

  test('settings migration is idempotent after the format bump', () => {
    const settings: any = structuredClone(defaultSettings);

    expect(migrateLegacySettingsToModules(settings)).toBe(false);
    expect(settings.modules).toHaveLength(1);
  });

  test('legacy chat schema metadata migrates under the default module', () => {
    const chatMetadata: any = { zTracker: { schemaKey: 'agenda' } };

    expect(migrateLegacyChatMetadataToModules(chatMetadata)).toBe(true);
    expect(chatMetadata).toEqual({ zTracker: { byModule: { [DEFAULT_MODULE_ID]: { schemaKey: 'agenda' } } } });
    expect(readModuleChatSchemaPresetKey(chatMetadata)).toBe('agenda');
    expect(migrateLegacyChatMetadataToModules(chatMetadata)).toBe(false);
  });

  test('module chat schema metadata writes are scoped by module id', () => {
    const chatMetadata: any = {};

    expect(writeModuleChatSchemaPresetKey(chatMetadata, 'agenda')).toBe(true);
    expect(writeModuleChatSchemaPresetKey(chatMetadata, 'stats', 'stats')).toBe(true);

    expect(readModuleChatSchemaPresetKey(chatMetadata)).toBe('agenda');
    expect(readModuleChatSchemaPresetKey(chatMetadata, 'stats')).toBe('stats');
  });
});

describe('migrateTrackerModuleIncludeLists', () => {
  test('seeds a self entry from a non-zero legacy self-history count', () => {
    const module = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    module.injection.includeLastXMessages = 3;
    (module.generation as any).includeModules = undefined;
    const settings: any = { ...structuredClone(defaultSettings), modules: [module] };

    expect(migrateTrackerModuleIncludeLists(settings)).toBe(true);
    expect(settings.modules[0].generation.includeModules).toEqual([{ target: 'self', count: 3 }]);
  });

  test('preserves a legacy zero as no self-history', () => {
    const module = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    module.injection.includeLastXMessages = 0;
    (module.generation as any).includeModules = undefined;
    const settings: any = { ...structuredClone(defaultSettings), modules: [module] };

    expect(migrateTrackerModuleIncludeLists(settings)).toBe(true);
    expect(settings.modules[0].generation.includeModules).toEqual([{ target: 'self', count: 0 }]);
  });

  test('does not re-run for a module that already has an include list', () => {
    const module = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    module.injection.includeLastXMessages = 9;
    module.generation.includeModules = [{ target: 'self', count: 2 }];
    const settings: any = { ...structuredClone(defaultSettings), modules: [module] };

    expect(migrateTrackerModuleIncludeLists(settings)).toBe(false);
    expect(settings.modules[0].generation.includeModules).toEqual([{ target: 'self', count: 2 }]);
  });

  test('repairs a non-empty include list that is missing the mandatory self entry', () => {
    const module = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    module.injection.includeLastXMessages = 4;
    // Non-empty but self-less - e.g. a hand-edited or corrupted import.
    (module.generation.includeModules as any) = [{ target: 'agenda', count: 1 }];
    const settings: any = { ...structuredClone(defaultSettings), modules: [module] };

    expect(migrateTrackerModuleIncludeLists(settings)).toBe(true);
    expect(settings.modules[0].generation.includeModules).toEqual([
      { target: 'self', count: 4 },
      { target: 'agenda', count: 1 },
    ]);
  });
});

describe('normalizeTrackerModuleIncludeList', () => {
  test('adds a missing self entry using the fallback count', () => {
    expect(normalizeTrackerModuleIncludeList(undefined, 3)).toEqual([{ target: 'self', count: 3 }]);
    expect(normalizeTrackerModuleIncludeList(null, 3)).toEqual([{ target: 'self', count: 3 }]);
    expect(normalizeTrackerModuleIncludeList([], 3)).toEqual([{ target: 'self', count: 3 }]);
  });

  test('preserves an existing valid self entry and sanitizes malformed chained entries', () => {
    const result = normalizeTrackerModuleIncludeList(
      [
        { target: 'self', count: 2 },
        { target: 'agenda', count: -5 },
        { target: '', count: 1 },
        { target: 42, count: 1 },
        'not-an-entry',
      ],
      99,
    );

    expect(result).toEqual([
      { target: 'self', count: 2 },
      { target: 'agenda', count: 0 },
    ]);
  });
});

describe('getSettingsForTrackerModule / applySettingsToTrackerModule round trip for includeModules', () => {
  test('an edit made on the flattened settings persists back onto the real Module via a clone, not a shared reference', () => {
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    const agenda = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 1 });
    agenda.generation.includeModules = [{ target: 'self', count: 1 }];
    const settings: any = { ...structuredClone(defaultSettings), modules: [scene, agenda] };

    const flattened = getSettingsForTrackerModule(settings, 'agenda');
    flattened.includeModules = [...flattened.includeModules, { target: 'scene', count: 2 }];
    applySettingsToTrackerModule(agenda, flattened);

    expect(agenda.generation.includeModules).toEqual([
      { target: 'self', count: 1 },
      { target: 'scene', count: 2 },
    ]);
    // The real Module's stored array must be its own clone, not the same array reference the
    // settings-UI mutated, so a later unrelated edit to that UI-local array can't corrupt it.
    expect(agenda.generation.includeModules).not.toBe(flattened.includeModules);
  });
});

describe('pruneTrackerModuleIncludeReferences', () => {
  test('removes only entries that reference the deleted module id', () => {
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    const agenda = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 1 });
    agenda.generation.includeModules = [
      { target: 'self', count: 1 },
      { target: 'scene', count: 2 },
    ];
    const inventory = createDefaultTrackerModule({ id: 'inventory', name: 'Inventory', order: 2 });
    inventory.generation.includeModules = [
      { target: 'self', count: 1 },
      { target: 'agenda', count: 1 },
    ];

    pruneTrackerModuleIncludeReferences([scene, agenda, inventory], 'scene');

    expect(agenda.generation.includeModules).toEqual([{ target: 'self', count: 1 }]);
    expect(inventory.generation.includeModules).toEqual([
      { target: 'self', count: 1 },
      { target: 'agenda', count: 1 },
    ]);
  });
});
