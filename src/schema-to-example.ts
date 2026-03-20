import { encode } from '@toon-format/toon';

export type StructuredFormat = 'json' | 'xml' | 'toon';

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

function normalizeSchemaForPrompt(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const normalized: Record<string, any> = {};
  for (const key of ['title', 'description', 'type', '$schema', 'format']) {
    if (schema[key] !== undefined) {
      normalized[key] = schema[key];
    }
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

  if (schema.default !== undefined) {
    normalized.default = schema.default;
  }

  if (schema.items !== undefined) {
    normalized.items = normalizeSchemaForPrompt(schema.items);
  }

  if (schema.properties && typeof schema.properties === 'object') {
    normalized.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, normalizeSchemaForPrompt(value)]),
    );
  }

  for (const key of ['x-ztracker-dependsOn', 'x-ztracker-idKey']) {
    if (schema[key] !== undefined) {
      normalized[key] = schema[key];
    }
  }

  return normalized;
}

export function schemaToPromptSchema(schema: any, format: StructuredFormat): string {
  const promptSchema = normalizeSchemaForPrompt(schema);

  if (format === 'xml') {
    return `<schema>\n${objectToXml(promptSchema, 1)}</schema>`;
  }

  if (format === 'toon') {
    return encode(promptSchema, { delimiter: '\t' });
  }

  return JSON.stringify(schema, null, 2);
}

export function schemaToExample(schema: any, format: StructuredFormat): string {
  const example = generateExample(schema);
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
