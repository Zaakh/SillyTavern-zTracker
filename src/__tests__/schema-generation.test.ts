/**
 * @jest-environment node
 */

// Covers src/schema-generation.ts and src/generation-examples.ts (openspec: add-llm-schema-generation 3.1-3.4, 4.3):
// cheat sheet, reply extraction, the lint-driven repair loop with a scripted fake request, and
// the all-or-nothing prompts generator.
import { jest } from '@jest/globals';
import { PromptEngineeringMode } from '../config.js';
import { getStarterGenerationExamples } from '../generation-examples.js';
import {
  buildDialectCheatSheet,
  extractSchemaFromReply,
  generatePromptsFromBrief,
  generateSchemaFromBrief,
  getGeneratedPresetName,
  type GenerationRequest,
} from '../schema-generation.js';
import { PROMPT_SCHEMA_KEYWORD_ALLOWLIST } from '../schema-to-example.js';

const CLEAN = { type: 'object', description: 'T', properties: { a: { type: 'string', description: 'A' } }, required: ['a'] };
// $ref is reported as a warning by the dialect lint.
const WARNING = { type: 'object', description: 'T', properties: { a: { $ref: '#/$defs/x' } }, required: ['a'] };
const WARNING_2 = { type: 'object', description: 'T', properties: { a: { $ref: '#/$defs/x' }, b: { $ref: '#/$defs/y' } }, required: ['a', 'b'] };

const examples = getStarterGenerationExamples();
const run = (request: GenerationRequest, signal?: AbortSignal) =>
  generateSchemaFromBrief({ brief: 'weather', mode: PromptEngineeringMode.JSON, grammarEnabled: false, examples, request, signal });

/** Replies in order; a reply that is an Error is thrown instead. */
function scripted(replies: Array<string | Error | DOMException>) {
  const request = jest.fn<GenerationRequest>(async () => {
    const next = replies.shift();
    if (typeof next !== 'string' && next !== undefined) throw next;
    return next ?? '';
  });
  return request;
}

describe('dialect cheat sheet', () => {
  test('lists every allowlisted keyword and the key instructions', () => {
    const sheet = buildDialectCheatSheet();
    for (const keyword of PROMPT_SCHEMA_KEYWORD_ALLOWLIST) expect(sheet).toContain(keyword);
    expect(sheet).toMatch(/Omit "additionalProperties"/);
    expect(sheet).toMatch(/Do not copy the example field names/);
    expect(sheet).toMatch(/Never wrap a single value/);
  });
});

describe('extractSchemaFromReply', () => {
  const json = JSON.stringify(CLEAN);
  test.each([
    ['bare', json],
    ['fenced', '```json\n' + json + '\n```'],
    ['prose-wrapped', 'Here you go:\n' + json + '\nHope it helps!'],
    ['after reasoning with braces', '<think>maybe {"x": 1} or {y}</think>' + json],
  ])('%s', (_label, reply) => {
    expect(extractSchemaFromReply(reply)).toEqual(CLEAN);
  });

  test('repairs near-miss JSON (trailing comma)', () => {
    expect(extractSchemaFromReply('{"type": "object",}')).toEqual({ type: 'object' });
  });

  test('returns undefined for unparseable text', () => {
    expect(extractSchemaFromReply('no schema here { oops')).toBeUndefined();
  });
});

describe('generateSchemaFromBrief', () => {
  test('clean first reply: one request', async () => {
    const request = scripted([JSON.stringify(CLEAN)]);
    const result = await run(request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ parsed: true, attempts: 1, schema: CLEAN, findings: [] });
  });

  test('warning then clean: repair request carries the finding', async () => {
    const request = scripted([JSON.stringify(WARNING), JSON.stringify(CLEAN)]);
    const result = await run(request);
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(request.mock.calls[1][0])).toMatch(/\$ref|reference/i);
    expect(result.schema).toEqual(CLEAN);
  });

  test('always warning: exactly 3 attempts, best kept', async () => {
    const request = scripted([JSON.stringify(WARNING_2), JSON.stringify(WARNING), JSON.stringify(WARNING_2)]);
    const result = await run(request);
    expect(request).toHaveBeenCalledTimes(3);
    expect(result.attempts).toBe(3);
    expect(result.schema).toEqual(WARNING);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  test('a worse third attempt does not replace the second', async () => {
    const result = await run(scripted([JSON.stringify(WARNING_2), JSON.stringify(WARNING), JSON.stringify(WARNING_2)]));
    expect(result.schema).toEqual(WARNING);
  });

  test('never parseable: parsed false, 3 attempts', async () => {
    const request = scripted(['nope', 'still nope', 'cut off {']);
    const result = await run(request);
    expect(result).toMatchObject({ parsed: false, attempts: 3, schema: undefined });
    expect(request).toHaveBeenCalledTimes(3);
  });

  test('info-only findings do not trigger a repair', async () => {
    const noDescriptions = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] };
    const request = scripted([JSON.stringify(noDescriptions)]);
    const result = await run(request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.findings.every((finding) => finding.severity === 'info')).toBe(true);
  });

  test('structured output is requested first; a rejection re-sends once without it, uncounted', async () => {
    const request = scripted([new Error('json_schema unsupported'), JSON.stringify(WARNING), JSON.stringify(CLEAN)]);
    const result = await run(request);
    expect(request.mock.calls[0][1]).toBeDefined();
    expect(request.mock.calls[1][1]).toBeUndefined();
    expect(request.mock.calls[2][1]).toBeUndefined();
    expect(result.attempts).toBe(2);
  });

  test('a throw after a reply was received is not a structured-output rejection: no fallback re-send', async () => {
    const request = scripted([JSON.stringify(WARNING), new Error('context exceeded')]);
    await run(request);
    expect(request).toHaveBeenCalledTimes(2);
  });

  test('a request error after a parseable attempt keeps the best attempt and reports the error', async () => {
    const request = scripted([JSON.stringify(WARNING), new Error('context exceeded')]);
    const result = await run(request);
    expect(result).toMatchObject({ parsed: true, attempts: 1, schema: WARNING, error: 'context exceeded' });
  });

  test('a request error with nothing parseable still throws', async () => {
    await expect(run(scripted(['not json', new Error('context exceeded')]))).rejects.toThrow('context exceeded');
  });

  test('abort error stops the run without a fallback re-send', async () => {
    const abort = new DOMException('x', 'AbortError');
    const request = scripted([abort]);
    await expect(run(request)).rejects.toThrow(abort);
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('abort between rounds sends no further request', async () => {
    const controller = new AbortController();
    const request = jest.fn(async () => {
      controller.abort();
      return JSON.stringify(WARNING);
    });
    await expect(run(request, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('the shipped starter schemas are accepted as good replies', async () => {
    for (const example of examples) {
      const request = scripted([JSON.stringify(example.schema)]);
      const result = await run(request);
      expect(request).toHaveBeenCalledTimes(1);
      expect(result.findings.filter((finding) => finding.severity !== 'info')).toEqual([]);
    }
  });

  describe('wrapper findings', () => {
    const str = { type: 'string', description: 'x' };
    const WRAP = (n: number) => {
      const props: Record<string, unknown> = {};
      // One-field object items: a wrapper finding with no warning, so only the wrapper logic is exercised.
      const oneField = { type: 'object', description: 'i', properties: { v: str }, required: ['v'] };
      for (let i = 0; i < n; i += 1) props[`k${i}`] = { type: 'array', description: 'a', items: oneField };
      return { type: 'object', description: 'T', properties: props, required: Object.keys(props) };
    };
    const SIBLINGS = (() => {
      const item = { type: 'object', description: 'i', properties: { name: str, note: str }, required: ['name', 'note'] };
      return { type: 'object', description: 'T', properties: { x: { type: 'array', description: 'x', items: item }, y: { type: 'array', description: 'y', items: item } }, required: ['x', 'y'] };
    })();

    test('a wrapper-only reply retries with the finding', async () => {
      const request = scripted([JSON.stringify(WRAP(1)), JSON.stringify(CLEAN)]);
      const result = await run(request);
      expect(request).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(request.mock.calls[1][0])).toMatch(/single property/);
      expect(result.schema).toEqual(CLEAN);
    });

    test('a sibling-only reply does not retry', async () => {
      const request = scripted([JSON.stringify(SIBLINGS)]);
      await run(request);
      expect(request).toHaveBeenCalledTimes(1);
    });

    test('fewer wrappers win a tie', async () => {
      const result = await run(scripted([JSON.stringify(WRAP(2)), JSON.stringify(WRAP(1)), JSON.stringify(WRAP(2))]));
      expect(result.schema).toEqual(WRAP(1));
    });

  });
});

describe('generatePromptsFromBrief', () => {
  const options = { brief: 'weather', schema: CLEAN, examples };

  test('two requests: system prompt first, then base prompt', async () => {
    const request = scripted(['  SYSTEM  ', 'BASE']);
    await expect(generatePromptsFromBrief({ ...options, request })).resolves.toEqual({ systemPrompt: 'SYSTEM', prompt: 'BASE' });
    expect(request).toHaveBeenCalledTimes(2);
  });

  test('an empty reply fails the whole generation', async () => {
    await expect(generatePromptsFromBrief({ ...options, request: scripted(['SYSTEM', '  ']) })).rejects.toThrow(/empty base prompt/);
  });

  test('a failing request fails the whole generation', async () => {
    await expect(generatePromptsFromBrief({ ...options, request: scripted([new Error('boom')]) })).rejects.toThrow('boom');
  });
});

describe('getGeneratedPresetName', () => {
  test('is id-derived: same display name, different ids -> distinct names; never a starter name', () => {
    expect(getGeneratedPresetName('weather')).not.toBe(getGeneratedPresetName('weather-2'));
    for (const starter of ['SceneTracker', 'PlotLog', 'PlotSteer']) {
      expect(getGeneratedPresetName('scene-tracker')).not.toMatch(new RegExp(`^zTracker-${starter}-\\d`));
    }
    expect(getGeneratedPresetName('x')).toBe('zTracker-x-generated');
  });
});

describe('starter examples', () => {
  test('every starter yields a brief, schema and system prompt', () => {
    expect(examples).toHaveLength(3);
    for (const example of examples) {
      expect(example.brief).toBeTruthy();
      expect(example.schema).toEqual(expect.objectContaining({ type: 'object' }));
      expect(example.systemPrompt.length).toBeGreaterThan(0);
    }
    expect(examples.some((example) => example.prompt.length > 0)).toBe(true);
  });
});
