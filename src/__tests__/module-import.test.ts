/**
 * @jest-environment node
 */

import { createImportedTrackerModule } from '../components/settings/module-import.js';

describe('createImportedTrackerModule World Info allowlist', () => {
  test('converts an old-shape export (name list + UID list) to rows and drops the legacy keys', () => {
    const imported: any = {
      name: 'Old Export',
      generation: { worldInfoAllowlistBookNames: ['Lore A'], worldInfoAllowlistEntryIds: [42] },
    };

    const module = createImportedTrackerModule(imported, []);

    expect(module.generation.worldInfoAllowlist).toEqual([{ book: 'Lore A', activeVia: [], entryIds: [] }]);
    expect(module.generation).not.toHaveProperty('worldInfoAllowlistBookNames');
    expect(module.generation).not.toHaveProperty('worldInfoAllowlistEntryIds');
  });

  test('keeps a new-shape allowlist and defaults to an empty one when absent', () => {
    const withRows: any = { name: 'New', generation: { worldInfoAllowlist: [{ book: 'B', activeVia: ['card'], entryIds: [1] }] } };
    expect(createImportedTrackerModule(withRows, []).generation.worldInfoAllowlist).toEqual([
      { book: 'B', activeVia: ['card'], entryIds: [1] },
    ]);
    expect(createImportedTrackerModule({ name: 'Bare' } as any, []).generation.worldInfoAllowlist).toEqual([]);
  });
});
