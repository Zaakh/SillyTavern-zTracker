/**
 * @jest-environment node
 */

import {
  buildExportedTrackerModule,
  createImportedTrackerModule,
  parseImportedTrackerModule,
} from '../components/settings/module-import.js';
import { createDefaultTrackerModule, defaultSettings } from '../config.js';

describe('createImportedTrackerModule World Info allowlist', () => {
  test('converts an old-shape export (name list + UID list) to rows and drops the legacy keys', () => {
    const imported: any = {
      name: 'Old Export',
      generation: { worldInfoAllowlistBookNames: ['Lore A'], worldInfoAllowlistEntryIds: [42] },
    };

    const module = createImportedTrackerModule(imported, []);

    expect(module.generation.worldInfoAllowlist).toEqual([{ book: 'Lore A', activeVia: [], entryIds: [], trigger: 'always' }]);
    expect(module.generation).not.toHaveProperty('worldInfoAllowlistBookNames');
    expect(module.generation).not.toHaveProperty('worldInfoAllowlistEntryIds');
  });

  test('keeps a new-shape allowlist and defaults to an empty one when absent', () => {
    const withRows: any = { name: 'New', generation: { worldInfoAllowlist: [{ book: 'B', activeVia: ['card'], entryIds: [1] }] } };
    expect(createImportedTrackerModule(withRows, []).generation.worldInfoAllowlist).toEqual([
      { book: 'B', activeVia: ['card'], entryIds: [1], trigger: 'always' },
    ]);
    expect(createImportedTrackerModule({ name: 'Bare' } as any, []).generation.worldInfoAllowlist).toEqual([]);
  });
});

describe('transform preset export and import', () => {
  const shipped = () => structuredClone(defaultSettings.transformPresets);
  const edited = () => ({ ...shipped().minimal, name: 'Mine', replacement: '$1 = $2' });
  const moduleSelecting = (key: string) => {
    const module = createDefaultTrackerModule({ id: 'm', name: 'M' });
    module.injection.transformPreset = key;
    return module;
  };

  test('an unmodified built-in embeds nothing', () => {
    const exported = buildExportedTrackerModule(moduleSelecting('minimal'), shipped());

    expect(exported.transformPresetDefinition).toBeUndefined();
    expect(exported.injection?.transformPreset).toBe('minimal');
  });

  test('a custom preset round-trips to another installation with identical formatting', () => {
    const source = { ...shipped(), mine: edited() };
    const payload = JSON.stringify({ version: 1, module: buildExportedTrackerModule(moduleSelecting('mine'), source) });

    const target = shipped();
    const imported = createImportedTrackerModule(parseImportedTrackerModule(payload)!, [], target);

    expect(imported.injection.transformPreset).toBe('mine');
    expect(target.mine).toEqual(edited());
    expect((imported as any).transformPresetDefinition).toBeUndefined();
  });

  test('an edited built-in is embedded and a clash is stored under a new key, leaving the existing preset alone', () => {
    const source = { ...shipped(), minimal: edited() };
    const exported = buildExportedTrackerModule(moduleSelecting('minimal'), source);
    expect(exported.transformPresetDefinition).toEqual(edited());

    const target = shipped();
    const imported = createImportedTrackerModule(JSON.parse(JSON.stringify(exported)), [], target);

    expect(target.minimal).toEqual(shipped().minimal);
    expect(target['minimal-2']).toEqual(edited());
    expect(imported.injection.transformPreset).toBe('minimal-2');
  });

  test('importing the same custom preset twice does not duplicate it', () => {
    const payload = JSON.stringify(buildExportedTrackerModule(moduleSelecting('mine'), { ...shipped(), mine: edited() }));
    const target = shipped();

    createImportedTrackerModule(parseImportedTrackerModule(payload)!, [], target);
    const second = createImportedTrackerModule(parseImportedTrackerModule(payload)!, [], target);

    expect(Object.keys(target).filter((key) => key.startsWith('mine'))).toEqual(['mine']);
    expect(second.injection.transformPreset).toBe('mine');
  });

  test('an old export with a per-Module list merges only the selected preset and drops the list', () => {
    const old: any = { name: 'Old', injection: { transformPreset: 'mine', transformPresets: { ...shipped(), mine: edited(), unused: edited() } } };
    const target = shipped();

    const imported = createImportedTrackerModule(old, [], target);

    expect(target.mine).toEqual(edited());
    expect(target.unused).toBeUndefined();
    expect((imported.injection as any).transformPresets).toBeUndefined();
    expect(imported.injection.transformPreset).toBe('mine');
  });
});
