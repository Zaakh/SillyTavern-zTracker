import { encode } from '@toon-format/toon';
import { repairCorruptedRequiredMetadata } from './schema-repair.js';

export type StructuredFormat = 'json' | 'xml' | 'toon';

type PromptSchemaNormalizationOptions = {
  includeDescriptions?: boolean;
  includeDocumentMetadata?: boolean;
  includeFormat?: boolean;
  includeDefaults?: boolean;
  includeZTrackerMetadata?: boolean;
};

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Identifies whether a field already carries a stronger semantic hint than format/default metadata. */
function hasPromptSemanticHint(schema: any): boolean {
  return hasNonEmptyString(schema?.description) || schema?.example !== undefined;
}

function escapeXmlText(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function objectToXml(value: unknown, indent = 0): string {
  if (!value || typeof value !== 'object') return '';

  let xml = '';
  const indentation = '  '.repeat(indent);
  for (const [key, childValue] of Object.entries(value)) {
    if (Array.isArray(childValue)) {
      childValue.forEach((item) => {
        if (typeof item === 'object' && item !== null) {
          xml += `${indentation}<${key}>\n`;
          xml += objectToXml(item, indent + 1);
          xml += `${indentation}</${key}>\n`;
        } else {
          xml += `${indentation}<${key}>${escapeXmlText(item)}</${key}>\n`;
        }
      });
      continue;
    }

    if (typeof childValue === 'object' && childValue !== null) {
      xml += `${indentation}<${key}>\n`;
      xml += objectToXml(childValue, indent + 1);
      xml += `${indentation}</${key}>\n`;
      continue;
    }

    xml += `${indentation}<${key}>${escapeXmlText(childValue)}</${key}>\n`;
  }

  return xml;
}

/** Normalizes a JSON schema into the smaller prompt-facing shape needed for model instructions. */
function normalizeSchemaForPrompt(schema: any, options: PromptSchemaNormalizationOptions = {}): any {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const {
    includeDescriptions = true,
    includeDocumentMetadata = true,
    includeFormat = true,
    includeDefaults = true,
    includeZTrackerMetadata = true,
  } = options;

  const normalized: Record<string, any> = {};
  if (includeDocumentMetadata) {
    for (const key of ['title', '$schema']) {
      if (schema[key] !== undefined) {
        normalized[key] = schema[key];
      }
    }
  }

  if (schema.type !== undefined) {
    normalized.type = schema.type;
  }

  if (schema.format !== undefined && (includeFormat || !hasPromptSemanticHint(schema))) {
    normalized.format = schema.format;
  }

  if (includeDescriptions && schema.description !== undefined) {
    normalized.description = schema.description;
  }

  if (Array.isArray(schema.required) && schema.required.length > 0) {
    normalized.required = [...schema.required];
  }

  if (schema.enum !== undefined) {
    normalized.enum = schema.enum;
  }

  if (schema.const !== undefined) {
    normalized.const = schema.const;
  }

  if (schema.default !== undefined && (includeDefaults || !hasPromptSemanticHint(schema))) {
    normalized.default = schema.default;
  }

  if (schema.items !== undefined) {
    normalized.items = normalizeSchemaForPrompt(schema.items, options);
  }

  if (schema.properties && typeof schema.properties === 'object') {
    normalized.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, normalizeSchemaForPrompt(value, options)]),
    );
  }

  if (includeZTrackerMetadata) {
    for (const key of ['x-ztracker-dependsOn', 'x-ztracker-idKey']) {
      if (schema[key] !== undefined) {
        normalized[key] = schema[key];
      }
    }
  }

  return normalized;
}

/** Chooses how much schema metadata each prompt-engineering format needs for reliable generation. */
function getPromptSchemaNormalizationOptions(format: StructuredFormat): PromptSchemaNormalizationOptions {
  if (format === 'toon') {
    return {
      includeDescriptions: false,
      includeDocumentMetadata: false,
      includeFormat: false,
      includeDefaults: false,
      includeZTrackerMetadata: true,
    };
  }

  return {};
}

export function schemaToPromptSchema(schema: any, format: StructuredFormat): string {
  const promptSchema = normalizeSchemaForPrompt(
    repairCorruptedRequiredMetadata(schema),
    getPromptSchemaNormalizationOptions(format),
  );

  if (format === 'xml') {
    return objectToXml(promptSchema).trim();
  }

  if (format === 'toon') {
    return encode(promptSchema, { delimiter: '\t' });
  }

  return JSON.stringify(promptSchema, null, 2);
}

export function schemaToExample(schema: any, format: StructuredFormat): string {
  const example = generateExample(repairCorruptedRequiredMetadata(schema));
  if (format === 'xml') {
    return objectToXml(example).trim();
  }
  if (format === 'toon') {
    return encode(example, { delimiter: '\t' });
  }
  return JSON.stringify(example, null, 2);
}

function generateExample(schema: any): any {
  if (schema.example) {
    return schema.example;
  }

  switch (schema.type) {
    case 'object':
      const obj: { [key: string]: any } = {};
      if (schema.properties) {
        for (const key in schema.properties) {
          obj[key] = generateExample(schema.properties[key]);
        }
      }
      return obj;
    case 'array':
      if (schema.items) {
        return [generateExample(schema.items)];
      }
      return [];
    case 'string':
      return schema.description || 'string';
    case 'number':
      return 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}
