/**
 * @jest-environment node
 */

// Covers the optional Module.designBrief field (openspec: add-llm-schema-generation 2.1): absent
// == empty, and the Settings export -> import path (JSON payload -> createImportedTrackerModule)
// carries it without any dedicated code.
import { createImportedTrackerModule, parseImportedTrackerModule } from '../components/settings/module-import.js';
import { createDefaultTrackerModule } from '../config.js';

describe('Module design brief', () => {
  test('a Module without a brief loads unchanged', () => {
    const imported = parseImportedTrackerModule(JSON.stringify({ name: 'Legacy' }));
    const module = createImportedTrackerModule(imported!, []);

    expect(module.designBrief).toBeUndefined();
    expect(createDefaultTrackerModule().designBrief).toBeUndefined();
  });

  test('export -> import round-trips a brief', () => {
    const source = { ...createDefaultTrackerModule({ id: 'a', name: 'A' }), designBrief: 'Track the weather and mood.' };
    // Same payload shape as Settings.tsx exportSelectedModule().
    const payload = JSON.stringify({ version: 1, module: source }, null, 2);

    const imported = createImportedTrackerModule(parseImportedTrackerModule(payload)!, []);

    expect(imported.designBrief).toBe('Track the weather and mood.');
  });
});
