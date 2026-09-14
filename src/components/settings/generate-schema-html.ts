/**
 * Mechanically derives a Handlebars HTML template from a JSON Schema object, backing the
 * "Generate HTML from schema" Settings UI action. Kept pure and framework-free so the
 * derivation can be unit tested directly, separate from `schema-editor-state.ts`'s
 * draft/validation state concern. See design.md at
 * openspec/changes/generate-html-from-schema/design.md for the render-safety rules this
 * follows (required/optional guarding of leaves and nested objects, array handling,
 * unsupported-construct placeholders, bracket path syntax for non-identifier keys).
 */

type JsonSchemaNode = {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, unknown>;
  required?: unknown;
  items?: unknown;
  enum?: unknown;
  const?: unknown;
  oneOf?: unknown;
  anyOf?: unknown;
  allOf?: unknown;
  patternProperties?: unknown;
  $ref?: unknown;
  $defs?: unknown;
};

const PLAIN_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isSchemaObject(value: unknown): value is JsonSchemaNode {
  return typeof value === 'object' && value !== null;
}

/** A key is safe for bracket segment-literal syntax (`data.[key]`) as long as it doesn't itself contain `]`, which would break out of the segment. */
function isBracketSafeKey(key: string): boolean {
  return !key.includes(']');
}

/** Renders one more Handlebars path segment, using bracket segment-literal syntax for keys that aren't plain identifiers. Caller must first verify the key is renderable via `isBracketSafeKey` when it isn't a plain identifier. */
function appendPathSegment(basePath: string, key: string): string {
  return PLAIN_IDENTIFIER_PATTERN.test(key) ? `${basePath}.${key}` : `${basePath}.[${key}]`;
}

/** Matches a schema's `type` (string or JSON-Schema union array, e.g. for nullable fields) against one expected value. */
function typeIncludes(type: string | string[] | undefined, value: string): boolean {
  return typeof type === 'string' ? type === value : Array.isArray(type) && type.includes(value);
}

/** Escapes text placed inside generated HTML attribute values or element text content. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Escapes text placed inside a generated HTML comment; also neutralizes `--` sequences, which are otherwise unsafe inside HTML comments. */
function escapeHtmlComment(value: string): string {
  return escapeHtml(value).replace(/--/g, '- -');
}

/** Splits camelCase and non-alphanumeric separators, then title-cases each word (e.g. `stateOfDress` -> "State Of Dress"). */
function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0);
  return words.length > 0 ? words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : key;
}

function getFieldLabel(key: string, schema: JsonSchemaNode): string {
  const title = typeof schema.title === 'string' ? schema.title.trim() : '';
  return escapeHtml(title || humanizeKey(key));
}

function getRequiredKeys(schema: JsonSchemaNode): Set<string> {
  return new Set(Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === 'string') : []);
}

/** Detects composition/reference keywords this generator cannot mechanically flatten: `oneOf`/`anyOf`/`allOf`, `patternProperties`, `$ref`/`$defs`. */
function hasCompositionKeywords(schema: JsonSchemaNode): boolean {
  if (schema.oneOf !== undefined || schema.anyOf !== undefined || schema.allOf !== undefined) {
    return true;
  }
  return schema.patternProperties !== undefined || schema.$ref !== undefined || schema.$defs !== undefined;
}

/** Detects schema shapes this generator cannot mechanically flatten: composition keywords (see `hasCompositionKeywords`), or no usable `type`/`properties`/`items`/`enum`/`const`. */
function isUnsupportedSchema(schema: unknown): boolean {
  if (!isSchemaObject(schema)) {
    return true;
  }
  if (hasCompositionKeywords(schema)) {
    return true;
  }
  const hasUsableShape =
    schema.type !== undefined ||
    schema.properties !== undefined ||
    schema.items !== undefined ||
    schema.enum !== undefined ||
    schema.const !== undefined;
  return !hasUsableShape;
}

function isObjectSchema(schema: JsonSchemaNode): boolean {
  return typeIncludes(schema.type, 'object') || (schema.type === undefined && isSchemaObject(schema.properties));
}

function isArraySchema(schema: JsonSchemaNode): boolean {
  return typeIncludes(schema.type, 'array') || (schema.type === undefined && schema.items !== undefined);
}

/** Builds one leaf `<tr>` row, guarding it in `{{#if}}` when the key is not required by its parent. */
function buildLeafRows(path: string, label: string, titleAttribute: string, isRequired: boolean): string[] {
  const row = ['<tr>', `  <td${titleAttribute}>${label}:</td>`, `  <td>{{${path}}}</td>`, '</tr>'];
  return isRequired ? row : [`{{#if ${path}}}`, ...row, '{{/if}}'];
}

/** Builds the rows for an array property: a joined line for primitive items, or an `{{#each}}` loop recursing into object items. */
function buildArrayRows(node: JsonSchemaNode, key: string, path: string, label: string, titleAttribute: string): string[] {
  if (isUnsupportedSchema(node.items)) {
    return [`<!-- Skipped "${escapeHtmlComment(key)}": unsupported schema shape -->`];
  }

  const itemsSchema = node.items as JsonSchemaNode;
  if (!isObjectSchema(itemsSchema)) {
    return ['<tr>', `  <td${titleAttribute}>${label}:</td>`, `  <td>{{join ${path} ', '}}</td>`, '</tr>'];
  }

  const itemProperties = isSchemaObject(itemsSchema.properties) ? itemsSchema.properties : {};
  const itemRequiredKeys = getRequiredKeys(itemsSchema);
  const itemRows = Object.entries(itemProperties).flatMap(([itemKey, itemSchema]) =>
    buildPropertyRows(itemKey, itemSchema, 'item', itemRequiredKeys.has(itemKey)),
  );

  return [
    '<tr>',
    '  <td colspan="2">',
    `    <strong${titleAttribute}>${label}</strong>`,
    `    {{#each ${path} as |item|}}`,
    '    <hr>',
    '    <table>',
    '      <tbody>',
    ...itemRows,
    '      </tbody>',
    '    </table>',
    '    {{/each}}',
    '  </td>',
    '</tr>',
  ];
}

/** Builds the HTML rows for one schema property, recursing into nested objects/arrays per the required/optional rules described in design.md. */
function buildPropertyRows(key: string, schema: unknown, basePath: string, isRequired: boolean): string[] {
  if (isUnsupportedSchema(schema)) {
    return [`<!-- Skipped "${escapeHtmlComment(key)}": unsupported schema shape -->`];
  }

  // A key that isn't a plain identifier renders via bracket segment-literal syntax (data.[key]), which
  // itself breaks if the key contains ']' - skip such keys the same way as an unsupported schema shape.
  if (!PLAIN_IDENTIFIER_PATTERN.test(key) && !isBracketSafeKey(key)) {
    return [`<!-- Skipped "${escapeHtmlComment(key)}": key cannot be safely referenced in a Handlebars path -->`];
  }

  const node = schema as JsonSchemaNode;
  const path = appendPathSegment(basePath, key);
  const label = getFieldLabel(key, node);
  const description = typeof node.description === 'string' ? node.description.trim() : '';
  const titleAttribute = description ? ` title="${escapeHtml(description)}"` : '';

  if (isObjectSchema(node)) {
    const properties = isSchemaObject(node.properties) ? node.properties : {};
    const requiredKeys = getRequiredKeys(node);
    const rows = Object.entries(properties).flatMap(([childKey, childSchema]) =>
      buildPropertyRows(childKey, childSchema, path, requiredKeys.has(childKey)),
    );
    // An optional nested object must guard its ENTIRE recursed block, not just its leaves - Handlebars
    // strict mode throws on an undefined intermediate path segment even inside a leaf-level {{#if}}.
    return isRequired ? rows : [`{{#if ${path}}}`, ...rows, '{{/if}}'];
  }

  if (isArraySchema(node)) {
    return buildArrayRows(node, key, path, label, titleAttribute);
  }

  // Leaf field: string/number/integer/boolean/enum/unrecognized type.
  return buildLeafRows(path, label, titleAttribute, isRequired);
}

/** Derives a single flat `<details>`-wrapped Handlebars HTML template covering every renderable field in `schema`. */
export function generateHtmlFromSchema(schema: unknown): string {
  const isRootObject = isSchemaObject(schema);
  const rootSchema = isRootObject ? schema : {};
  const rootTitle = typeof rootSchema.title === 'string' ? rootSchema.title.trim() : '';
  const summary = escapeHtml(rootTitle || 'Tracker Details');

  let body: string[];
  if (isRootObject && hasCompositionKeywords(rootSchema)) {
    // The schema root itself relies on oneOf/anyOf/allOf/patternProperties/$ref/$defs - there is no
    // properties map to recurse into at all, so this is distinct from (and more specific than) the
    // generic "no renderable fields found" case below.
    body = [
      '<tr><td colspan="2"><!-- Schema root uses an unsupported construct (oneOf/anyOf/allOf/patternProperties/$ref/$defs); no template could be generated --></td></tr>',
    ];
  } else {
    const properties = isSchemaObject(rootSchema.properties) ? rootSchema.properties : {};
    const requiredKeys = getRequiredKeys(rootSchema);
    const rows = Object.entries(properties).flatMap(([key, propSchema]) =>
      buildPropertyRows(key, propSchema, 'data', requiredKeys.has(key)),
    );
    body = rows.length > 0 ? rows : ['<tr><td colspan="2"><!-- No renderable fields found in schema --></td></tr>'];
  }

  // Reuses the existing `.ztracker_default_mes_template` styling hook (table alignment, details/summary
  // indentation, smaller font) - without it, generated output renders with no styling at all.
  return [
    '<div class="ztracker_default_mes_template">',
    '<details>',
    `  <summary>${summary}</summary>`,
    '  <table>',
    '    <tbody>',
    ...body,
    '    </tbody>',
    '  </table>',
    '</details>',
    '</div>',
  ].join('\n');
}
