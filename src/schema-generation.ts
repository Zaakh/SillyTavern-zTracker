/**
 * Pure logic for LLM-assisted Module authoring (openspec: add-llm-schema-generation): prompt
 * builders, reply extraction, the lint-driven schema repair loop, and the two-request prompts
 * generator. Import-safe: the model call is injected as `request`, so Jest needs no host and the
 * UI layer owns connection, reasoning stripping and persistence.
 */
import type { PromptEngineeringMode } from './config.js';
import { tryParseJsonWithRepair } from './parser/json.js';
import { lintSchemaDialect, type SchemaDialectFinding } from './schema-dialect-lint.js';
import { PROMPT_SCHEMA_KEYWORD_ALLOWLIST } from './schema-to-example.js';

export interface GenerationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Sends one request through the active connection and resolves to the reply text (reasoning already stripped). */
export type GenerationRequest = (messages: GenerationMessage[], overridePayload?: Record<string, unknown>) => Promise<string>;

/** A few-shot example: a short authored brief paired with the artifacts that satisfy it. */
export interface GenerationExample {
  brief: string;
  schema: unknown;
  systemPrompt: string;
  prompt: string;
}

export const MAX_SCHEMA_ATTEMPTS = 3;

/** Deliberately loose: strict structured output cannot express arbitrary property names, so this only nudges the model toward a schema-shaped object. */
const LOOSE_SCHEMA_META = {
  name: 'TrackerSchema',
  strict: false,
  value: {
    type: 'object',
    properties: {
      type: { type: 'string' },
      properties: { type: 'object' },
      required: { type: 'array', items: { type: 'string' } },
      items: { type: 'object' },
    },
    required: ['type'],
  },
};

/** Id-derived (never name-derived) so it cannot collide with another Module's or a starter's preset. */
export function getGeneratedPresetName(moduleId: string): string {
  return `zTracker-${moduleId}-generated`;
}

function isAbortError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'AbortError';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError');
}

/** Teaches the model the dialect the extension honors, derived from the same allowlist the lint reports against. */
export function buildDialectCheatSheet(): string {
  return [
    'The schema must be a single JSON Schema object (draft-07 style) using ONLY these keywords; every other keyword is silently dropped before the tracker model sees it:',
    PROMPT_SCHEMA_KEYWORD_ALLOWLIST.join(', '),
    '',
    'Rules:',
    '- Use "properties" and "required" on objects, "items" on arrays. List every field in "required".',
    '- Give every field a "description" saying what to put in it.',
    '- Do NOT use $ref, $defs, oneOf, anyOf, allOf or patternProperties; inline every shape instead.',
    '- Omit "additionalProperties".',
    '- An array of objects needs a unique string field (named "name", or declare it with "x-ztracker-idKey") so single items can be regenerated.',
    '- "x-ztracker-dependsOn" (top-level fields only) lists other top-level fields that must be generated first.',
    '- Do not copy the example field names unless the brief calls for them; design fields for the brief.',
  ].join('\n');
}

function formatExamples(examples: GenerationExample[], pick: (example: GenerationExample) => string): string {
  return examples
    .filter((example) => pick(example).trim())
    .map((example, index) => `### Example ${index + 1}\nBrief: ${example.brief}\n${pick(example)}`)
    .join('\n\n');
}

export function buildSchemaMessages(brief: string, examples: GenerationExample[]): GenerationMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You design JSON Schemas for a roleplay tracker. Reply with ONLY the JSON Schema object: no prose, no code fence, no reasoning.',
        '',
        buildDialectCheatSheet(),
        '',
        formatExamples(examples, (example) => `Schema:\n${JSON.stringify(example.schema)}`),
      ].join('\n'),
    },
    { role: 'user', content: `Brief: ${brief.trim()}\n\nWrite the schema for this tracker.` },
  ];
}

function formatFindings(findings: SchemaDialectFinding[]): string {
  return findings.map((finding) => `- [${finding.severity}] ${finding.path}: ${finding.message}`).join('\n');
}

/** Continues the conversation: the previous reply, then the failure or findings to fix. */
export function buildRepairMessages(
  previous: GenerationMessage[],
  reply: string,
  problem: { unparseable: true } | { findings: SchemaDialectFinding[] },
): GenerationMessage[] {
  const feedback =
    'findings' in problem
      ? `That schema has problems:\n${formatFindings(problem.findings)}\n\nFix them and reply with ONLY the corrected JSON Schema object.`
      : 'That reply was not valid JSON. Reply with ONLY the complete JSON Schema object, no prose and no code fence.';
  return [...previous, { role: 'assistant', content: reply }, { role: 'user', content: feedback }];
}

const SELF_SUFFICIENT_RULE =
  'The text must be self-sufficient: do not refer to rules, formats or examples "later in the conversation" or elsewhere, because nothing else describes this tracker. Reply with ONLY the text.';

export function buildPromptsMessages(
  kind: 'system' | 'base',
  brief: string,
  schema: unknown,
  examples: GenerationExample[],
): GenerationMessage[] {
  const what =
    kind === 'system'
      ? 'a system prompt for the model that fills in this tracker (its role, how to treat the transcript as data, how to carry forward previous values)'
      : 'the base task prompt for this tracker (the instruction sent with the schema each time the tracker is updated)';
  return [
    {
      role: 'system',
      content: [`You write ${what}.`, SELF_SUFFICIENT_RULE, '', formatExamples(examples, (example) => `Text:\n${kind === 'system' ? example.systemPrompt : example.prompt}`)].join('\n'),
    },
    { role: 'user', content: `Brief: ${brief.trim()}\n\nSchema:\n${JSON.stringify(schema)}\n\nWrite the ${kind === 'system' ? 'system prompt' : 'base prompt'}.` },
  ];
}

/**
 * Pulls the schema object out of a reply: every balanced `{...}` that parses as an object is a
 * candidate and the longest wins, so braces in leftover reasoning or prose never beat the real
 * (outermost) schema. Falls back to the shared JSON repair pipeline for near-miss JSON.
 */
export function extractSchemaFromReply(reply: string): Record<string, unknown> | undefined {
  let best: { text: string; value: Record<string, unknown> } | undefined;
  for (let start = reply.indexOf('{'); start !== -1; start = reply.indexOf('{', start + 1)) {
    const end = findBalancedEnd(reply, start);
    if (end === undefined) continue;
    const text = reply.slice(start, end + 1);
    try {
      const value = JSON.parse(text);
      if (value && typeof value === 'object' && !Array.isArray(value) && (!best || text.length > best.text.length)) {
        best = { text, value };
      }
    } catch {
      // not valid on its own; try the next opening brace
    }
  }
  if (best) return best.value;

  try {
    const repaired = tryParseJsonWithRepair(reply);
    return repaired && typeof repaired === 'object' && !Array.isArray(repaired) ? (repaired as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function findBalancedEnd(text: string, start: number): number | undefined {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === '\\') index += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return index;
  }
  return undefined;
}

export interface SchemaGenerationResult {
  /** The best parseable attempt, absent when nothing parsed. */
  schema?: Record<string, unknown>;
  /** Findings of the kept attempt (empty when clean). */
  findings: SchemaDialectFinding[];
  /** Replies received from the model; the structured-output fallback re-send is not counted. */
  attempts: number;
  parsed: boolean;
  /** A request failed after at least one parseable attempt; the best attempt above is still returned. */
  error?: string;
}

function countSeverity(findings: SchemaDialectFinding[], severity: SchemaDialectFinding['severity']): number {
  return findings.filter((finding) => finding.severity === severity).length;
}

/** Brief -> lint-checked schema, repairing from findings for at most MAX_SCHEMA_ATTEMPTS replies. */
export async function generateSchemaFromBrief(options: {
  brief: string;
  mode: PromptEngineeringMode;
  grammarEnabled: boolean;
  examples: GenerationExample[];
  request: GenerationRequest;
  signal?: AbortSignal;
}): Promise<SchemaGenerationResult> {
  const { brief, mode, grammarEnabled, examples, request, signal } = options;
  let messages = buildSchemaMessages(brief, examples);
  let override: Record<string, unknown> | undefined = { json_schema: LOOSE_SCHEMA_META };
  let best: { schema: Record<string, unknown>; findings: SchemaDialectFinding[] } | undefined;
  let attempts = 0;

  while (attempts < MAX_SCHEMA_ATTEMPTS) {
    throwIfAborted(signal);

    let reply: string;
    try {
      reply = await request(messages, override);
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (override && attempts === 0) {
        // Backend rejected structured output: drop it for the rest of the run and re-send once, uncounted.
        override = undefined;
        throwIfAborted(signal);
        reply = await request(messages);
      } else if (best) {
        // E.g. a repair that no longer fits the context window: keep what we already have.
        return { schema: best.schema, findings: best.findings, attempts, parsed: true, error: error instanceof Error ? error.message : String(error) };
      } else {
        throw error;
      }
    }
    attempts += 1;

    const schema = extractSchemaFromReply(reply);
    if (!schema) {
      messages = buildRepairMessages(messages, reply, { unparseable: true });
      continue;
    }

    const findings = lintSchemaDialect(schema, mode, grammarEnabled);
    const errors = countSeverity(findings, 'error');
    const warnings = countSeverity(findings, 'warning');
    const bestErrors = best ? countSeverity(best.findings, 'error') : Infinity;
    const bestWarnings = best ? countSeverity(best.findings, 'warning') : Infinity;
    if (errors < bestErrors || (errors === bestErrors && warnings <= bestWarnings)) {
      best = { schema, findings };
    }

    if (errors + warnings === 0) break;
    messages = buildRepairMessages(messages, reply, { findings: findings.filter((finding) => finding.severity !== 'info') });
  }

  return { schema: best?.schema, findings: best?.findings ?? [], attempts, parsed: !!best };
}

/** Brief + schema -> system prompt and base prompt. All-or-nothing: any failure or empty text throws. */
export async function generatePromptsFromBrief(options: {
  brief: string;
  schema: unknown;
  examples: GenerationExample[];
  request: GenerationRequest;
  signal?: AbortSignal;
}): Promise<{ systemPrompt: string; prompt: string }> {
  const { brief, schema, examples, request, signal } = options;
  const results: Record<'system' | 'base', string> = { system: '', base: '' };
  for (const kind of ['system', 'base'] as const) {
    throwIfAborted(signal);
    results[kind] = (await request(buildPromptsMessages(kind, brief, schema, examples))).trim();
    if (!results[kind]) {
      throw new Error(`The model returned an empty ${kind === 'system' ? 'system prompt' : 'base prompt'}.`);
    }
  }
  return { systemPrompt: results.system, prompt: results.base };
}
