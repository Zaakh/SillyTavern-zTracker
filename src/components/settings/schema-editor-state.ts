import type { Schema } from '../../config.js';
import Handlebars from 'handlebars';

// Keeps schema-editor state decisions import-safe so silent data-loss cases can be tested without React.
export function formatSchemaText(schema?: Schema): string {
  return schema ? JSON.stringify(schema.value, null, 2) : '';
}

// Keeps the HTML template draft local until the template parses successfully.
export function formatSchemaHtml(schema?: Schema): string {
  return schema?.html ?? '';
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

// Template edits only persist once Handlebars can parse the draft successfully.
export function hasUnsavedInvalidSchemaHtmlDraft(schemaHtmlText: string): boolean {
  try {
    Handlebars.precompile(schemaHtmlText);
    return false;
  } catch {
    return true;
  }
}

// Preserve the local HTML draft while the user is still editing an invalid template on the same preset.
export function shouldSyncSchemaHtmlFromSettings(options: { currentText: string; activePresetChanged: boolean }): boolean {
  if (options.activePresetChanged) {
    return true;
  }

  return !hasUnsavedInvalidSchemaHtmlDraft(options.currentText);
}