/**
 * Evaluates a tracker schema against the narrow JSON Schema dialect zTracker's prompt
 * composition, reply parsing, HTML derivation, grammar/schema enforcement, and rendering actually
 * honor, and reports findings an author can act on: a severity, an author-facing field path, and
 * a message stating the runtime consequence and the fix. See
 * openspec/changes/add-schema-dialect-lint/design.md for the consumer table and every decision
 * (D1-D14) this module implements.
 *
 * Kept pure and framework-free (no model call, no connection) so both the Schema editor and the
 * Diagnostics sweep can call it directly, and so `generateHtmlFromSchema()` can share its
 * unsupported-construct detection (`isUnsupportedSchema`/`hasCompositionKeywords`) without a
 * second, drifting definition.
 */

import { PromptEngineeringMode } from './config.js';
import { PROMPT_SCHEMA_KEYWORD_ALLOWLIST } from './schema-to-example.js';
import { repairCorruptedRequiredMetadata } from './schema-repair.js';
import { findTopLevelDependsOnIssues } from './tracker-parts.js';

export type SchemaDialectFindingSeverity = 'error' | 'warning' | 'info';

export interface SchemaDialectFinding {
  severity: SchemaDialectFindingSeverity;
  /** Author-facing field path (e.g. `characters[].name`), or `(root)` for a schema-wide finding. */
  path: string;
  message: string;
}

/**
 * Keys outside `PROMPT_SCHEMA_KEYWORD_ALLOWLIST` that the generic dropped-keyword rule must NOT
 * report: composition/reference keys (own warning, `pushCompositionWarnings`),
 * `additionalProperties` (own conditional rule, D12), `example` (honored by example generation),
 * and pure annotations with no instruction value.
 */
export const DROPPED_KEYWORD_RULE_EXEMPTIONS = [
  '$ref',
  '$defs',
  'definitions',
  'oneOf',
  'anyOf',
  'allOf',
  'patternProperties',
  'additionalProperties',
  'example',
  '$id',
  '$comment',
] as const;

/** Consequence clause shared by every "dropped before the model" finding. Native mode sends the raw schema as a structured-output constraint, so the drop only applies to the prompt-engineering modes; severity stays mode-independent (D2). */
const PROMPT_MODES_CLAUSE = 'in JSON/XML/TOON prompt modes';

const ROOT_PATH = '(root)';

/** Renders a path for use inside a finding message. */
function describePath(path: string): string {
  return path === ROOT_PATH ? 'The schema root' : `"${path}"`;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Matches a schema's `type` (string or JSON-Schema union array, e.g. for nullable fields) against one expected value. */
function typeIncludes(type: unknown, value: string): boolean {
  return typeof type === 'string' ? type === value : Array.isArray(type) && type.includes(value);
}

function isObjectSchema(schema: Record<string, any>): boolean {
  return typeIncludes(schema.type, 'object') || (schema.type === undefined && isPlainObject(schema.properties));
}

function isArraySchema(schema: Record<string, any>): boolean {
  return typeIncludes(schema.type, 'array') || (schema.type === undefined && schema.items !== undefined);
}

/** Detects composition/reference keywords no consumer inlines: `oneOf`/`anyOf`/`allOf`, `patternProperties`, `$ref`/`$defs`. Moved here from `generate-schema-html.ts` (openspec: add-schema-dialect-lint 3.1) so the HTML generator and this lint share one definition. */
export function hasCompositionKeywords(schema: Record<string, any>): boolean {
  if (schema.oneOf !== undefined || schema.anyOf !== undefined || schema.allOf !== undefined) {
    return true;
  }
  return schema.patternProperties !== undefined || schema.$ref !== undefined || schema.$defs !== undefined;
}

/** Detects schema shapes `generateHtmlFromSchema()` cannot mechanically flatten: composition keywords (see `hasCompositionKeywords`), or no usable `type`/`properties`/`items`/`enum`/`const`. Moved here from `generate-schema-html.ts` (openspec: add-schema-dialect-lint 3.1). */
export function isUnsupportedSchema(schema: unknown): boolean {
  if (!isPlainObject(schema)) {
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

interface LintContext {
  grammarEnforcementEnabled: boolean;
  discardsDescriptions: boolean;
  findings: SchemaDialectFinding[];
  missingDescriptionPaths: string[];
  hasAnyDescription: boolean;
}

function appendFieldPath(basePath: string, key: string): string {
  return basePath === ROOT_PATH ? key : `${basePath}.${key}`;
}

function appendArrayItemPath(basePath: string): string {
  return `${basePath}[]`;
}

function pushError(ctx: LintContext, path: string, message: string): void {
  ctx.findings.push({ severity: 'error', path, message });
}

function pushWarning(ctx: LintContext, path: string, message: string): void {
  ctx.findings.push({ severity: 'warning', path, message });
}

function trackDescription(node: Record<string, any>, path: string, ctx: LintContext): void {
  const hasDescription = typeof node.description === 'string' && node.description.trim().length > 0;
  if (hasDescription) {
    ctx.hasAnyDescription = true;
  } else {
    ctx.missingDescriptionPaths.push(path);
  }
}

/** Reports composition/reference keywords that are legal JSON Schema but that consumer 1 silently drops (D4). Linting continues into the node's own `properties`/`items` afterwards, so a composition keyword never hides an error elsewhere in the same node. */
function pushCompositionWarnings(node: Record<string, any>, path: string, ctx: LintContext): void {
  const target = describePath(path);
  if (node.$ref !== undefined || node.$defs !== undefined || node.definitions !== undefined) {
    pushWarning(ctx, path, `${target} uses "$ref"/"$defs"/"definitions": referenced definitions are not conveyed ${PROMPT_MODES_CLAUSE}; inline the definition into the field directly.`);
  }
  if (node.oneOf !== undefined || node.anyOf !== undefined || node.allOf !== undefined) {
    pushWarning(ctx, path, `${target} uses "oneOf"/"anyOf"/"allOf": alternative or combined subschemas are not conveyed ${PROMPT_MODES_CLAUSE}.`);
  }
  if (node.patternProperties !== undefined) {
    pushWarning(ctx, path, `${target} uses "patternProperties": pattern-based property definitions are not conveyed ${PROMPT_MODES_CLAUSE}.`);
  }
}

/** Reports every key `normalizeSchemaForPrompt()` drops, derived directly from `PROMPT_SCHEMA_KEYWORD_ALLOWLIST` (minus `DROPPED_KEYWORD_RULE_EXEMPTIONS`), so the lint cannot drift from what prompt composition actually honors. */
function checkDroppedKeywords(node: Record<string, any>, path: string, ctx: LintContext): void {
  const honored = new Set<string>([...PROMPT_SCHEMA_KEYWORD_ALLOWLIST, ...DROPPED_KEYWORD_RULE_EXEMPTIONS]);
  const dropped = Object.keys(node).filter((key) => !honored.has(key));
  if (dropped.length > 0) {
    pushWarning(
      ctx,
      path,
      `${describePath(path)} declares keyword(s) (${dropped.join(', ')}) that are not conveyed ${PROMPT_MODES_CLAUSE}, so the model is not told about them and they are not enforced.`,
    );
  }
}

/** `additionalProperties: false` is dropped by consumer 1 (prompt composition) but is meaningful input to consumer 5 (grammar/schema enforcement) when that Module setting is on - the opposite of every other dropped keyword (D12). */
function checkAdditionalProperties(node: Record<string, any>, path: string, ctx: LintContext): void {
  if (node.additionalProperties === false && !ctx.grammarEnforcementEnabled) {
    pushWarning(
      ctx,
      path,
      `${describePath(path)} declares "additionalProperties: false", which is not conveyed ${PROMPT_MODES_CLAUSE} while grammar/schema enforcement is off, so it is not enforced there.`,
    );
  }
}

/** An array of objects with no explicit identity annotation and no `name` property leaves per-item regeneration/cleanup unable to target items in it. */
function checkArrayItemIdentity(itemsSchema: Record<string, any>, arrayPath: string, ctx: LintContext): void {
  const idKey = itemsSchema['x-ztracker-idKey'];
  const hasIdKey = typeof idKey === 'string' && idKey.trim().length > 0;
  const hasNameProperty = isPlainObject(itemsSchema.properties) && Object.prototype.hasOwnProperty.call(itemsSchema.properties, 'name');
  if (!hasIdKey && !hasNameProperty) {
    pushWarning(
      ctx,
      arrayPath,
      `Array ${describePath(arrayPath)} has no way to identify its items (no "x-ztracker-idKey" annotation and no "name" property), so per-item regeneration and cleanup cannot target items in it.`,
    );
  }
}

function pushNoPropertiesError(ctx: LintContext, path: string): void {
  pushError(ctx, path, `${describePath(path)} is an object with no properties, so it conveys nothing to the model about what to produce and nothing to the renderer about what to display.`);
}

function lintObjectNode(node: Record<string, any>, path: string, ctx: LintContext): void {
  checkAdditionalProperties(node, path, ctx);
  const properties = isPlainObject(node.properties) ? node.properties : undefined;
  const propertyKeys = properties ? Object.keys(properties) : [];
  if (propertyKeys.length === 0) {
    pushNoPropertiesError(ctx, path);
    return;
  }
  for (const key of propertyKeys) {
    const childSchema = properties![key];
    const childPath = appendFieldPath(path, key);
    if (isPlainObject(childSchema)) {
      trackDescription(childSchema, childPath, ctx);
    }
    lintNode(childSchema, childPath, ctx);
  }
}

function lintArrayNode(node: Record<string, any>, path: string, ctx: LintContext): void {
  if (node.items === undefined) {
    pushError(ctx, path, `${describePath(path)} is an array with no item definition, so nothing describes its contents to the model, and XML/TOON reply parsing cannot normalize it.`);
    return;
  }
  if (Array.isArray(node.items)) {
    pushWarning(ctx, path, `${describePath(path)} uses a tuple-style "items" definition (an ordered list of differing schemas); zTracker only understands a single item schema for an array.`);
    return;
  }

  const itemsSchema = node.items;
  if (isPlainObject(itemsSchema) && isObjectSchema(itemsSchema)) {
    checkArrayItemIdentity(itemsSchema, path, ctx);
  }
  lintNode(itemsSchema, appendArrayItemPath(path), ctx);
}

function lintNode(node: unknown, path: string, ctx: LintContext, isRoot = false): void {
  if (!isPlainObject(node)) {
    if (isRoot) {
      pushNoPropertiesError(ctx, path);
    }
    return;
  }

  pushCompositionWarnings(node, path, ctx);
  checkDroppedKeywords(node, path, ctx);

  if (isRoot && node.type !== undefined && !typeIncludes(node.type, 'object')) {
    pushError(ctx, path, `The schema root must be an object (it declares type ${JSON.stringify(node.type)}), because a tracker is always a set of named fields.`);
    return;
  }
  if (isRoot || isObjectSchema(node)) {
    lintObjectNode(node, path, ctx);
    return;
  }
  if (isArraySchema(node)) {
    lintArrayNode(node, path, ctx);
    return;
  }
  // Leaf field (string/number/integer/boolean/enum/const/unrecognized type) - nothing more to check structurally.
}

/** Reports `x-ztracker-dependsOn` problems among TOP-LEVEL fields only, matching `resolveTopLevelPartsOrder()`'s scope (it never looks at nested fields). Reuses that module's dependency-normalization semantics via `findTopLevelDependsOnIssues()` rather than reimplementing it. */
function checkDependsOnFindings(schema: Record<string, any>, ctx: LintContext): void {
  const { unknownReferences, cycleFields } = findTopLevelDependsOnIssues(schema);
  for (const { key, unknownTargets } of unknownReferences) {
    pushWarning(
      ctx,
      key,
      `"x-ztracker-dependsOn" on "${key}" references unknown top-level field(s) (${unknownTargets.join(', ')}). Sequential generation cannot honor this and falls back to schema property order.`,
    );
  }
  if (cycleFields.length > 0) {
    pushWarning(
      ctx,
      ROOT_PATH,
      `"x-ztracker-dependsOn" forms a cycle among top-level fields (${cycleFields.join(', ')}). Sequential generation cannot honor this and falls back to schema property order.`,
    );
  }
}

function finalizeDescriptionFindings(ctx: LintContext): void {
  if (ctx.missingDescriptionPaths.length > 0) {
    ctx.findings.push({
      severity: 'info',
      path: ROOT_PATH,
      message: `The following fields have no description, the only free-text channel that tells the model what a field means: ${ctx.missingDescriptionPaths.join(', ')}.`,
    });
  }
  if (ctx.discardsDescriptions && ctx.hasAnyDescription) {
    ctx.findings.push({
      severity: 'info',
      path: ROOT_PATH,
      message: 'This Module\'s prompt engineering mode discards field descriptions before the tracker-generation request is sent, so the descriptions in this schema will not reach the model.',
    });
  }
}

/**
 * Evaluates `schemaInput` against the zTracker dialect for a Module in `promptEngineeringMode`
 * with `grammarEnforcementEnabled`, and returns every finding synchronously (no model call, no
 * connection). Applies `repairCorruptedRequiredMetadata()` first, matching consumer 1's own
 * normalization, so a finding never fires for a corruption the extension already repairs
 * silently at runtime (D10). Severity never depends on `promptEngineeringMode` except for the one
 * TOON-specific info finding (D2) - `grammarEnforcementEnabled` is the only non-schema input this
 * lint reads, and only for the `additionalProperties` rule (D14).
 */
export function lintSchemaDialect(
  schemaInput: unknown,
  promptEngineeringMode: PromptEngineeringMode,
  grammarEnforcementEnabled: boolean,
): SchemaDialectFinding[] {
  const repairedSchema = repairCorruptedRequiredMetadata(schemaInput);
  const ctx: LintContext = {
    grammarEnforcementEnabled,
    discardsDescriptions: promptEngineeringMode === PromptEngineeringMode.TOON,
    findings: [],
    missingDescriptionPaths: [],
    hasAnyDescription: false,
  };

  lintNode(repairedSchema, ROOT_PATH, ctx, /* isRoot */ true);
  finalizeDescriptionFindings(ctx);
  if (isPlainObject(repairedSchema)) {
    checkDependsOnFindings(repairedSchema, ctx);
  }

  return ctx.findings;
}
