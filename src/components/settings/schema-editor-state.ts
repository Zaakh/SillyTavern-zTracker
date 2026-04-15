import type { Schema } from '../../config.js';

// Keeps schema-editor state decisions import-safe so silent data-loss cases can be tested without React.
export function formatSchemaText(schema?: Schema): string {
  return schema ? JSON.stringify(schema.value, null, 2) : '';
}

// Schema edits only persist once the JSON parses successfully.
export function hasUnsavedInvalidSchemaDraft(schemaText: string): boolean {
  try {
    JSON.parse(schemaText);
    return false;
  } catch {
    return true;
  }
}

// Preserve the local draft while the user is still editing invalid JSON on the same preset.
export function shouldSyncSchemaTextFromSettings(options: { currentText: string; activePresetChanged: boolean }): boolean {
  if (options.activePresetChanged) {
    return true;
  }

  return !hasUnsavedInvalidSchemaDraft(options.currentText);
}