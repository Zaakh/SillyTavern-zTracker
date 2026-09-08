/**
 * Pure Module-import parsing/construction logic used by the Settings drawer's Import button.
 * Extracted from Settings.tsx (which pulls in heavy host-coupled React/SillyTavern dependencies)
 * so this logic can be exercised directly in Jest, including regression tests for the shipped
 * Module templates under templates/modules/ (see src/__tests__/premade-module-templates.test.ts).
 */
import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import {
  TrackerModule,
  createDefaultTrackerModule,
  createTrackerModuleId,
  normalizeTrackerModuleIncludeList,
} from '../../config.js';

export type ImportedTrackerModule = Partial<Omit<TrackerModule, 'auto' | 'schema' | 'prompts' | 'systemPrompt' | 'connection' | 'generation' | 'injection'>>
  & Pick<TrackerModule, 'name'>
  & {
    auto?: Partial<TrackerModule['auto']>;
    schema?: Partial<TrackerModule['schema']>;
    prompts?: Partial<TrackerModule['prompts']>;
    systemPrompt?: Partial<TrackerModule['systemPrompt']>;
    connection?: Partial<TrackerModule['connection']>;
    generation?: Partial<TrackerModule['generation']>;
    injection?: Partial<TrackerModule['injection']>;
  };

/**
 * Normalizes an imported Module's `auto` settings into the current `{ enabled, direction }`
 * shape. A Module exported before that split shipped carries the legacy `{ enabled, mode }`
 * shape instead; without this translation, spreading it directly over the default `auto` would
 * silently discard the exported trigger direction (replacing it with the default) while leaving
 * a stray `mode` field on the Module.
 */
function normalizeImportedTrackerModuleAuto(
  importedAuto: (Partial<TrackerModule['auto']> & { mode?: AutoModeOptions }) | undefined,
  baseAuto: TrackerModule['auto'],
): TrackerModule['auto'] {
  if (!importedAuto) {
    return { ...baseAuto };
  }
  if (importedAuto.mode !== undefined && importedAuto.direction === undefined) {
    return {
      enabled: importedAuto.mode !== AutoModeOptions.NONE,
      direction: importedAuto.mode !== AutoModeOptions.NONE ? importedAuto.mode : baseAuto.direction,
    };
  }
  return {
    enabled: importedAuto.enabled ?? baseAuto.enabled,
    direction: importedAuto.direction ?? baseAuto.direction,
  };
}

/** Parses a file's text content into an importable Module shape, or null if it isn't one. */
export function parseImportedTrackerModule(text: string): ImportedTrackerModule | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const parsedRecord = parsed as Record<string, unknown>;
    const module = (parsedRecord.module && typeof parsedRecord.module === 'object'
      ? parsedRecord.module
      : parsedRecord) as Partial<ImportedTrackerModule>;
    if (!module || typeof module !== 'object' || typeof module.name !== 'string' || !module.name.trim()) {
      return null;
    }
    return module as ImportedTrackerModule;
  } catch {
    return null;
  }
}

/** Builds a full Module from an imported (possibly partial/legacy-shaped) Module, appended at the end of `modules`. */
export function createImportedTrackerModule(importedModule: ImportedTrackerModule, modules: TrackerModule[]): TrackerModule {
  const id = createTrackerModuleId(modules, importedModule.id || importedModule.name);
  const base = createDefaultTrackerModule({ id, name: importedModule.name.trim(), order: modules.length });
  const mergedGeneration = { ...base.generation, ...importedModule.generation };
  return {
    ...base,
    ...JSON.parse(JSON.stringify(importedModule)),
    id,
    name: importedModule.name.trim(),
    enabled: importedModule.enabled ?? base.enabled,
    order: modules.length,
    auto: normalizeImportedTrackerModuleAuto(importedModule.auto, base.auto),
    schema: { ...base.schema, ...importedModule.schema },
    prompts: { ...base.prompts, ...importedModule.prompts },
    systemPrompt: { ...base.systemPrompt, ...importedModule.systemPrompt },
    connection: { ...base.connection, ...importedModule.connection },
    generation: {
      ...mergedGeneration,
      // The include list is validated on its own: a missing/malformed/self-less imported value
      // must never leave the Module without its mandatory self entry (settings UI and generation
      // assembly both assume it is always present).
      includeModules: normalizeTrackerModuleIncludeList(mergedGeneration.includeModules, base.generation.includeModules[0].count),
    },
    injection: { ...base.injection, ...importedModule.injection },
  };
}
