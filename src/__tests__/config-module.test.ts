/**
 * @jest-environment node
 */

import {
  DEFAULT_MODULE_ID,
  PLACEHOLDER_SCHEMA_HTML,
  PLACEHOLDER_SCHEMA_VALUE,
  defaultSettings,
  applySettingsToTrackerModule,
  createDefaultTrackerModule,
  createTrackerModuleFromLegacySettings,
  getSettingsForTrackerModule,
  getTrackerModule,
  migrateLegacySettingsToModules,
  migrateLegacyChatMetadataToModules,
  migrateTrackerModuleAutoSettings,
  migrateTrackerModuleIncludeLists,
  migrateTrackerModuleSystemPromptContent,
  migrateTrackerModuleWorldInfoAllowlists,
  migrateTransformPresetsToGlobal,
  mergeTransformPresets,
  seedBuiltInTransformPresets,
  normalizeWorldInfoAllowlist,
  normalizeTrackerModuleIncludeList,
  pruneTrackerModuleIncludeReferences,
  readModuleChatSchemaPresetKey,
  writeModuleChatSchemaPresetKey,
} from '../config.js';

describe('tracker module defaults', () => {
  test('fresh install has no synchronous default module - the only source of Module content is fresh-install seeding', () => {
    // A fresh install's built-in Module comes from seeding templates/modules/scene-tracker.json
    // (see src/index.tsx's fresh-install branch and premade-module-templates.test.ts), not from
    // this constant.
    expect(defaultSettings.modules).toEqual([]);
  });

  test('the generic placeholder Module builder is distinct from any shipped starter template', () => {
    const module = createDefaultTrackerModule();

    expect(module.name).toBe('New Tracker');
    expect(module.id).toBe(DEFAULT_MODULE_ID);
    expect(module.systemPrompt.content).toBe('');
  });

  test('recovering a missing module collection also uses the descriptive name and the legacy id, not the new scene-tracker id', () => {
    const settingsWithNoModules: any = { ...structuredClone(defaultSettings), modules: [] };

    const recovered = getTrackerModule(settingsWithNoModules);
    expect(recovered.name).toBe('Scene Tracker');
    // This is the transient read-time recovery fallback (corrupted-settings recovery on an
    // already-migrated install, or every fresh-install seed template failing) - it must keep using
    // the legacy id so an already-migrated install's existing per-message data stays reachable.
    expect(recovered.id).toBe(DEFAULT_MODULE_ID);
  });

  test('new modules default to enabled with auto mode off', () => {
    const module = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 1 });

    expect(module.id).toBe('agenda');
    expect(module.name).toBe('Agenda');
    expect(module.order).toBe(1);
    expect(module.enabled).toBe(true);
    expect(module.auto.enabled).toBe(false);
    expect(module.auto.direction).toBe('both');
  });

  test('new modules default to the active connection instead of an empty saved profile', () => {
    // resolveTrackerConnection() rejects `saved` with an empty profileId outright, so both
    // "Add Module" and the legacy-upgrade base must not default to that combination.
    const module = createDefaultTrackerModule();

    expect(module.connection).toEqual({ source: 'active', profileId: '' });
  });

  test('module owns schema, prompt, generation, and injection defaults', () => {
    const module = createDefaultTrackerModule();

    expect(module.schema.preset).toBe('default');
    expect(module.schema.presets.default.value).toBe(PLACEHOLDER_SCHEMA_VALUE);
    expect(module.schema.presets.default.html).toBe(PLACEHOLDER_SCHEMA_HTML);
    expect(module.generation.mode).toBe('full');
    expect(module.generation.conversationRoleMode).toBe('preserve');
    expect(module.injection.transformPreset).toBe('flat');
    expect((module.injection as any).transformPresets).toBeUndefined();
    expect(defaultSettings.transformPresets.default.name).toBe('Default (JSON)');
  });

  test('new modules default grammar/schema enforcement to disabled', () => {
    const module = createDefaultTrackerModule();

    expect(module.prompts.grammarEnforcementEnabled).toBe(false);
  });

  test('grammarEnforcementEnabled round-trips through flatten/mutate/re-apply', () => {
    const module = createDefaultTrackerModule();

    const flattened = getSettingsForTrackerModule({ ...defaultSettings, modules: [module] }, module.id);
    expect(flattened.grammarEnforcementEnabled).toBe(false);

    flattened.grammarEnforcementEnabled = true;
    applySettingsToTrackerModule(module, flattened);

    expect(module.prompts.grammarEnforcementEnabled).toBe(true);
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
    expect(legacySettings.modules[0].systemPrompt).toEqual({ mode: 'saved', savedName: 'System A', content: '' });
    expect(legacySettings.modules[0].generation).toEqual(
      expect.objectContaining({
        mode: 'sequential-parts',
        maxResponseToken: 1234,
        skipFirstXMessages: 3,
        includeLastXMessages: 4,
        conversationRoleMode: 'all_assistant',
        worldInfoPolicyMode: 'allowlist',
        worldInfoAllowlist: [{ book: 'Book', activeVia: [], entryIds: [], trigger: 'always' }],
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

  test('a legacy Module with an explicit persisted connectionSource keeps it after the connection default change', () => {
    // createTrackerModuleFromLegacySettings() falls back to createDefaultTrackerModule()'s
    // connection default only when the legacy settings never persisted connectionSource. A legacy
    // user who explicitly had `saved` must not be silently upgraded to `active`.
    const savedModule = createTrackerModuleFromLegacySettings({ connectionSource: 'saved', profileId: 'legacy-profile' });
    expect(savedModule.connection).toEqual({ source: 'saved', profileId: 'legacy-profile' });
  });

  test('a legacy Module with no persisted connectionSource upgrades to the new active-connection default', () => {
    const upgradedModule = createTrackerModuleFromLegacySettings({});
    expect(upgradedModule.connection).toEqual({ source: 'active', profileId: '' });
  });

  test('settings migration is idempotent once real modules already exist on the current format', () => {
    // Fresh installs have zero modules by design (see defaultSettings), so this uses a settings
    // object shaped like an already-migrated (or already-seeded) install instead.
    const settings: any = {
      ...structuredClone(defaultSettings),
      modules: [createDefaultTrackerModule({ id: 'scene-tracker', name: 'Scene Tracker', order: 0 })],
    };

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

describe('migrateTrackerModuleAutoSettings', () => {
  test('migrates a disabled legacy mode to enabled: false with a default direction', () => {
    const module = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    (module.auto as any) = { enabled: false, mode: 'none' };
    const settings: any = { ...structuredClone(defaultSettings), modules: [module] };

    expect(migrateTrackerModuleAutoSettings(settings)).toBe(true);
    expect(settings.modules[0].auto).toEqual({ enabled: false, direction: 'both' });
  });

  test('migrates an enabled legacy mode to enabled: true with that mode as the direction', () => {
    const module = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    (module.auto as any) = { enabled: true, mode: 'responses' };
    const settings: any = { ...structuredClone(defaultSettings), modules: [module] };

    expect(migrateTrackerModuleAutoSettings(settings)).toBe(true);
    expect(settings.modules[0].auto).toEqual({ enabled: true, direction: 'responses' });
  });

  test('does not re-run for a module that already stores enabled/direction', () => {
    const module = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    module.auto = { enabled: true, direction: 'inputs' as any };
    const settings: any = { ...structuredClone(defaultSettings), modules: [module] };

    expect(migrateTrackerModuleAutoSettings(settings)).toBe(false);
    expect(settings.modules[0].auto).toEqual({ enabled: true, direction: 'inputs' });
  });
});

describe('migrateTrackerModuleSystemPromptContent', () => {
  test('backfills a missing content field to an empty string', () => {
    const module = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    delete (module.systemPrompt as any).content;
    const settings: any = { ...structuredClone(defaultSettings), modules: [module] };

    expect(migrateTrackerModuleSystemPromptContent(settings)).toBe(true);
    expect(settings.modules[0].systemPrompt.content).toBe('');
  });

  test('is idempotent and never overwrites an existing content string, including an empty one', () => {
    const module = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    module.systemPrompt.content = 'shipped prompt text';
    const settings: any = { ...structuredClone(defaultSettings), modules: [module] };

    expect(migrateTrackerModuleSystemPromptContent(settings)).toBe(false);
    expect(settings.modules[0].systemPrompt.content).toBe('shipped prompt text');
  });

  test('defends against a missing systemPrompt object entirely', () => {
    const module = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    delete (module as any).systemPrompt;
    const settings: any = { ...structuredClone(defaultSettings), modules: [module] };

    expect(() => migrateTrackerModuleSystemPromptContent(settings)).not.toThrow();
    expect(migrateTrackerModuleSystemPromptContent(settings)).toBe(false);
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

describe('normalizeWorldInfoAllowlist', () => {
  test('converts legacy book names to always rows and ignores legacy entry UIDs', () => {
    expect(
      normalizeWorldInfoAllowlist({ worldInfoAllowlistBookNames: ['Lore A', 'Lore B'], worldInfoAllowlistEntryIds: [1] } as any),
    ).toEqual([
      { book: 'Lore A', activeVia: [], entryIds: [], trigger: 'always' },
      { book: 'Lore B', activeVia: [], entryIds: [], trigger: 'always' },
    ]);
  });

  test('keeps a valid engine trigger and reads missing or invalid values as always, idempotently', () => {
    const once = normalizeWorldInfoAllowlist({
      worldInfoAllowlist: [{ book: 'A', trigger: 'engine' }, { book: 'B' }, { book: 'C', trigger: 'bogus' }],
    });
    expect(once.map((r) => r.trigger)).toEqual(['engine', 'always', 'always']);
    expect(normalizeWorldInfoAllowlist({ worldInfoAllowlist: once })).toEqual(once);
  });

  test('sanitizes rows: blank/non-string/duplicate books, bad activeVia and entryIds', () => {
    expect(
      normalizeWorldInfoAllowlist({
        worldInfoAllowlist: [
          { book: ' Lore A ', activeVia: ['card', 'card', 'bogus', 'global'], entryIds: [3, 3, -1, 1.5, 'x', 0] },
          { book: 'lore a', activeVia: ['global'], entryIds: [] },
          { book: '   ' },
          { book: 7 },
          null,
          'Plain',
        ],
      }),
    ).toEqual([
      { book: 'Lore A', activeVia: ['card', 'global'], entryIds: [3, 0], trigger: 'always' },
      { book: 'Plain', activeVia: [], entryIds: [], trigger: 'always' },
    ]);
  });

  test('tolerates missing or malformed input', () => {
    expect(normalizeWorldInfoAllowlist(undefined)).toEqual([]);
    expect(normalizeWorldInfoAllowlist({ worldInfoAllowlist: 'nope', worldInfoAllowlistBookNames: 5 })).toEqual([]);
  });
});

describe('getSettingsForTrackerModule World Info rows', () => {
  test('fills a missing trigger with always so the UI and generation read the same value', () => {
    const settings = { modules: [createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 })] } as any;
    settings.modules[0].generation.worldInfoAllowlist = [{ book: 'Stored', activeVia: [], entryIds: [] }];
    const flat = getSettingsForTrackerModule(settings, 'scene');
    expect(flat.trackerWorldInfoAllowlist).toEqual([{ book: 'Stored', activeVia: [], entryIds: [], trigger: 'always' }]);
  });
});

describe('migrateTrackerModuleWorldInfoAllowlists', () => {
  test('migrates legacy fields to rows, removes them, and is a no-op on the second run', () => {
    const module = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    const generation = module.generation as any;
    delete generation.worldInfoAllowlist;
    generation.worldInfoAllowlistBookNames = ['Lore A', '', 7];
    generation.worldInfoAllowlistEntryIds = [42];
    const settings: any = { ...structuredClone(defaultSettings), modules: [module] };

    expect(migrateTrackerModuleWorldInfoAllowlists(settings)).toBe(true);
    expect(settings.modules[0].generation.worldInfoAllowlist).toEqual([{ book: 'Lore A', activeVia: [], entryIds: [], trigger: 'always' }]);
    expect(settings.modules[0].generation).not.toHaveProperty('worldInfoAllowlistBookNames');
    expect(settings.modules[0].generation).not.toHaveProperty('worldInfoAllowlistEntryIds');
    expect(migrateTrackerModuleWorldInfoAllowlists(settings)).toBe(false);
  });

  test('repairs a Module with a missing or malformed allowlist and skips a Module without generation', () => {
    const missing = createDefaultTrackerModule({ id: 'a', name: 'A', order: 0 });
    (missing.generation as any).worldInfoAllowlist = 'oops';
    const noGeneration: any = { id: 'b', name: 'B' };
    const settings: any = { ...structuredClone(defaultSettings), modules: [missing, noGeneration] };

    expect(migrateTrackerModuleWorldInfoAllowlists(settings)).toBe(true);
    expect(settings.modules[0].generation.worldInfoAllowlist).toEqual([]);
  });
});

describe('global transform presets', () => {
  const builtIn = () => structuredClone(defaultSettings.transformPresets);
  const edited = (name = 'Edited') => ({ ...builtIn().minimal, name, replacement: '$1 = $2' });

  /** Settings in the pre-global shape: every Module carries its own list and selected key. */
  function legacySettings(modules: Array<{ id: string; selected: string; list: Record<string, unknown> }>): any {
    return {
      ...structuredClone(defaultSettings),
      transformPresets: builtIn(),
      modules: modules.map((m, order) => {
        const module: any = createDefaultTrackerModule({ id: m.id, order });
        module.injection.transformPreset = m.selected;
        module.injection.transformPresets = structuredClone(m.list);
        return module;
      }),
    };
  }

  test('fresh defaults already contain every built-in', () => {
    expect(Object.keys(defaultSettings.transformPresets).sort()).toEqual(['default', 'flat', 'minimal', 'toon']);
  });

  test('an existing Module keeps its selection yet gains flat', () => {
    const settings: any = { transformPresets: { default: builtIn().default }, modules: [createDefaultTrackerModule({ id: 'a' })] };
    settings.modules[0].injection.transformPreset = 'default';

    expect(seedBuiltInTransformPresets(settings)).toBe(true);

    expect(settings.transformPresets.flat).toEqual(builtIn().flat);
    expect(settings.modules[0].injection.transformPreset).toBe('default');
  });

  test('a pre-existing flat key is not overwritten', () => {
    const mine = { ...builtIn().flat, name: 'Mine' };
    const settings: any = { transformPresets: { flat: mine } };

    seedBuiltInTransformPresets(settings);

    expect(settings.transformPresets.flat).toEqual(mine);
  });

  test('identical copies collapse to the built-in key', () => {
    const settings = legacySettings([
      { id: 'a', selected: 'minimal', list: builtIn() },
      { id: 'b', selected: 'minimal', list: builtIn() },
      { id: 'c', selected: 'toon', list: builtIn() },
    ]);

    expect(migrateTransformPresetsToGlobal(settings)).toBe(true);

    expect(Object.keys(settings.transformPresets).sort()).toEqual(['default', 'flat', 'minimal', 'toon']);
    expect(settings.modules.map((m: any) => m.injection.transformPreset)).toEqual(['minimal', 'minimal', 'toon']);
    expect(settings.modules.every((m: any) => m.injection.transformPresets === undefined)).toBe(true);
  });

  test('a conflicting edit keeps the built-in and is stored under a new key the Module is repointed to', () => {
    const list = { ...builtIn(), minimal: edited() };
    const settings = legacySettings([{ id: 'a', selected: 'minimal', list }]);

    migrateTransformPresetsToGlobal(settings);

    expect(settings.transformPresets.minimal).toEqual(builtIn().minimal);
    expect(settings.transformPresets['minimal-2']).toEqual(edited());
    expect(settings.modules[0].injection.transformPreset).toBe('minimal-2');
  });

  test('Modules sharing one edited copy share one new key', () => {
    const list = { ...builtIn(), minimal: edited() };
    const settings = legacySettings([
      { id: 'a', selected: 'minimal', list },
      { id: 'b', selected: 'minimal', list },
      { id: 'c', selected: 'minimal', list },
    ]);

    migrateTransformPresetsToGlobal(settings);

    expect(Object.keys(settings.transformPresets).sort()).toEqual(['default', 'flat', 'minimal', 'minimal-2', 'toon']);
    expect(settings.modules.map((m: any) => m.injection.transformPreset)).toEqual(['minimal-2', 'minimal-2', 'minimal-2']);
  });

  test('different edits of one key each get their own key', () => {
    const settings = legacySettings([
      { id: 'a', selected: 'minimal', list: { ...builtIn(), minimal: edited('One') } },
      { id: 'b', selected: 'minimal', list: { ...builtIn(), minimal: edited('Two') } },
    ]);

    migrateTransformPresetsToGlobal(settings);

    expect(settings.modules.map((m: any) => m.injection.transformPreset)).toEqual(['minimal-2', 'minimal-3']);
    expect(settings.transformPresets['minimal-3'].name).toBe('Two');
  });

  test('unselected user presets are still merged', () => {
    const custom = { ...builtIn().default, name: 'Mine' };
    const settings = legacySettings([{ id: 'a', selected: 'default', list: { ...builtIn(), mine: custom } }]);

    migrateTransformPresetsToGlobal(settings);

    expect(settings.transformPresets.mine).toEqual(custom);
    expect(settings.modules[0].injection.transformPreset).toBe('default');
  });

  test('legacy flat settings merge through the first Module', () => {
    const flat: any = {
      ...structuredClone(defaultSettings),
      formatVersion: 'F_1.0',
      modules: [],
      embedZTrackerSnapshotTransformPreset: 'plain',
      embedZTrackerSnapshotTransformPresets: {
        plain: { name: 'Plain', input: 'top_level_lines', pattern: '', flags: 'g', replacement: '', codeFenceLang: 'text' },
      },
    };

    migrateLegacySettingsToModules(flat);
    migrateTransformPresetsToGlobal(flat);

    expect(flat.transformPresets.plain.name).toBe('Plain');
    expect(flat.modules[0].injection.transformPreset).toBe('plain');
    expect(flat.modules[0].injection.transformPresets).toBeUndefined();
  });

  test('migration is idempotent', () => {
    const settings = legacySettings([{ id: 'a', selected: 'minimal', list: { ...builtIn(), minimal: edited() } }]);
    migrateTransformPresetsToGlobal(settings);
    const after = structuredClone(settings);

    expect(migrateTransformPresetsToGlobal(settings)).toBe(false);
    expect(settings).toEqual(after);
  });

  test('seeding re-adds a missing built-in but never overwrites an edited one', () => {
    const settings: any = { ...structuredClone(defaultSettings), transformPresets: { minimal: edited() } };

    expect(seedBuiltInTransformPresets(settings)).toBe(true);
    expect(settings.transformPresets.default).toEqual(builtIn().default);
    expect(settings.transformPresets.minimal).toEqual(edited());
    expect(seedBuiltInTransformPresets(settings)).toBe(false);
  });

  test('mergeTransformPresets ignores property order when comparing', () => {
    const global = builtIn();
    const reordered = Object.fromEntries(Object.entries(global.toon).reverse()) as any;

    expect(mergeTransformPresets(global, 'copy', reordered)).toBe('toon');
  });

  test('a Module resolves its preset from the global list and falls back to default for a missing key', () => {
    const settings: any = { ...structuredClone(defaultSettings), modules: [createDefaultTrackerModule()] };
    settings.transformPresets.minimal = edited();
    settings.modules[0].injection.transformPreset = 'minimal';

    const flat = getSettingsForTrackerModule(settings, settings.modules[0].id);
    expect(flat.embedZTrackerSnapshotTransformPresets.minimal.name).toBe('Edited');

    applySettingsToTrackerModule(settings.modules[0], flat);
    expect(settings.modules[0].injection.transformPresets).toBeUndefined();
  });
});
