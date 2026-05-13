import type { Schema } from '../../config.js';
import Handlebars from 'handlebars';

export interface DraftValidationState {
  isValid: boolean;
  errorMessage?: string;
}

export interface EditorDraftState extends DraftValidationState {
  isDirty: boolean;
  canSave: boolean;
}

// Keeps schema-editor state decisions import-safe so silent data-loss cases can be tested without React.
export function formatSchemaText(schema?: Schema): string {
  return schema ? JSON.stringify(schema.value, null, 2) : '';
}

// Keeps the HTML template draft local until the template parses successfully.
export function formatSchemaHtml(schema?: Schema): string {
  return schema?.html ?? '';
}

// Keeps error reporting stable so the UI can explain why a draft cannot be saved.
function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

function isTopLevelSchemaObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Schema edits only persist once the JSON parses successfully.
export function validateSchemaDraft(schemaText: string): DraftValidationState {
  try {
    const parsedValue = JSON.parse(schemaText);
    if (!isTopLevelSchemaObject(parsedValue)) {
      return {
        isValid: false,
        errorMessage: 'Schema JSON must be a top-level object.',
      };
    }

    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      errorMessage: getErrorMessage(error, 'Invalid JSON.'),
    };
  }
}

// Exposes whether the current JSON draft is valid and still differs from the persisted preset.
export function getSchemaDraftState(options: { currentText: string; persistedText: string }): EditorDraftState {
  const validation = validateSchemaDraft(options.currentText);
  const isDirty = options.currentText !== options.persistedText;
  return {
    ...validation,
    isDirty,
    canSave: isDirty && validation.isValid,
  };
}

// Preserve any unsaved JSON draft while staying on the same preset.
export function shouldSyncSchemaTextFromSettings(options: {
  currentText: string;
  persistedText: string;
  activePresetChanged: boolean;
}): boolean {
  if (options.activePresetChanged) {
    return true;
  }

  return options.currentText === options.persistedText;
}

// Template edits only persist once Handlebars can parse the draft successfully.
export function validateSchemaHtmlDraft(schemaHtmlText: string): DraftValidationState {
  try {
    Handlebars.precompile(schemaHtmlText);
    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      errorMessage: getErrorMessage(error, 'Invalid Handlebars template.'),
    };
  }
}

// Exposes whether the current HTML draft is valid and still differs from the persisted preset.
export function getSchemaHtmlDraftState(options: { currentText: string; persistedText: string }): EditorDraftState {
  const validation = validateSchemaHtmlDraft(options.currentText);
  const isDirty = options.currentText !== options.persistedText;
  return {
    ...validation,
    isDirty,
    canSave: isDirty && validation.isValid,
  };
}

// Preserve any unsaved HTML draft while staying on the same preset.
export function shouldSyncSchemaHtmlFromSettings(options: {
  currentText: string;
  persistedText: string;
  activePresetChanged: boolean;
}): boolean {
  if (options.activePresetChanged) {
    return true;
  }

  return options.currentText === options.persistedText;
}