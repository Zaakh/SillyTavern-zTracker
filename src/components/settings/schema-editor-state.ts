import type { Schema } from '../../config.js';
import Handlebars from 'handlebars';
import { schemaToExample } from '../../schema-to-example.js';

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

function buildSchemaLeafExample(schema: any): unknown {
  if (schema?.const !== undefined) {
    return schema.const;
  }

  if (Array.isArray(schema?.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }

  if (schema?.default !== undefined) {
    return schema.default;
  }

  switch (schema?.type) {
    case 'string':
      return schema.description || 'string';
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

function buildMinimalSchemaExample(schema: any): unknown {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  if (schema.type === 'object' || (schema.type === undefined && schema.properties && typeof schema.properties === 'object')) {
    const requiredKeys = Array.isArray(schema.required) ? new Set(schema.required) : new Set<string>();
    const minimalObject: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(schema.properties ?? {})) {
      if (!requiredKeys.has(key)) {
        continue;
      }

      minimalObject[key] = buildMinimalSchemaExample(value);
    }

    return minimalObject;
  }

  if (schema.type === 'array' || (schema.type === undefined && schema.items !== undefined)) {
    const minItems = Number.isInteger(schema.minItems) && schema.minItems > 0 ? schema.minItems : 0;
    if (minItems === 0) {
      return [];
    }

    return Array.from({ length: minItems }, () => buildMinimalSchemaExample(schema.items));
  }

  return buildSchemaLeafExample(schema);
}

function validateRenderedTemplate(template: Handlebars.TemplateDelegate, trackerData: unknown): void {
  template({ data: trackerData });
}

// Validates one preset as a coupled JSON-and-HTML pair so broken templates fail before runtime generation.
export function validateSchemaPresetDraftPair(options: {
  schemaText: string;
  schemaHtmlText: string;
}): DraftValidationState {
  const schemaValidation = validateSchemaDraft(options.schemaText);
  if (!schemaValidation.isValid) {
    return schemaValidation;
  }

  const htmlValidation = validateSchemaHtmlDraft(options.schemaHtmlText);
  if (!htmlValidation.isValid) {
    return htmlValidation;
  }

  try {
    const parsedSchema = JSON.parse(options.schemaText);
    const template = Handlebars.compile(options.schemaHtmlText, { strict: true });
    const maximalExampleData = JSON.parse(schemaToExample(parsedSchema, 'json'));
    const minimalExampleData = buildMinimalSchemaExample(parsedSchema);

    validateRenderedTemplate(template, maximalExampleData);
    validateRenderedTemplate(template, minimalExampleData);

    return { isValid: true };
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Schema HTML does not match the current schema JSON.');
    return {
      isValid: false,
      errorMessage: `Schema JSON and HTML must stay coupled for both full and minimal tracker data: ${errorMessage}`,
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