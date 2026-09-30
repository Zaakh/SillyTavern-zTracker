/**
 * @jest-environment node
 */

/**
 * Covers `lintSchemaDialect()` (src/schema-dialect-lint.ts): the pure JSON-Schema-dialect
 * evaluator backing the Schema editor's findings, the Diagnostics sweep, and the shipped-schema
 * regression guard. See openspec/changes/add-schema-dialect-lint/design.md and
 * openspec/changes/add-schema-dialect-lint/specs/schema-dialect-safety/spec.md for the rule set
 * and decisions (D1-D14) being tested.
 */
import { PromptEngineeringMode } from '../config.js';
import { hasCompositionKeywords, isUnsupportedSchema, lintSchemaDialect, SchemaDialectFinding } from '../schema-dialect-lint.js';
import { PROMPT_SCHEMA_KEYWORD_ALLOWLIST } from '../schema-to-example.js';

function lint(schema: unknown, mode: PromptEngineeringMode = PromptEngineeringMode.JSON, grammarEnforcementEnabled = false): SchemaDialectFinding[] {
  return lintSchemaDialect(schema, mode, grammarEnforcementEnabled);
}

function errorsAndWarnings(findings: SchemaDialectFinding[]): SchemaDialectFinding[] {
  return findings.filter((finding) => finding.severity !== 'info');
}

describe('lintSchemaDialect', () => {
  it('returns no findings for a fully conforming schema', () => {
    const schema = {
      type: 'object',
      description: 'A tracker',
      properties: {
        name: { type: 'string', description: 'A name' },
        tags: { type: 'array', items: { type: 'string', description: 'A tag' }, description: 'Tags' },
      },
      required: ['name', 'tags'],
    };

    expect(lint(schema)).toEqual([]);
  });

  it('produces no finding for the known misplaced required-in-properties corruption', () => {
    const corruptedSchema = {
      type: 'object',
      description: 'A tracker',
      properties: {
        name: { type: 'string', description: 'A name' },
        required: ['name'],
      },
    };

    expect(errorsAndWarnings(lint(corruptedSchema))).toEqual([]);
  });

  describe('author-facing path construction', () => {
    it('reports a top-level field by its own key', () => {
      const findings = lint({ type: 'object', properties: { location: { type: 'array' } } });
      expect(findings.find((f) => f.severity === 'error')?.path).toBe('location');
    });

    it('reports a nested object field with a dotted path', () => {
      const findings = lint({
        type: 'object',
        description: 'x',
        properties: {
          topics: {
            type: 'object',
            description: 'x',
            properties: { mood: { type: 'array' } },
          },
        },
      });
      expect(findings.find((f) => f.severity === 'error')?.path).toBe('topics.mood');
    });

    it('reports an array-of-objects item field with a [] segment', () => {
      const findings = lint({
        type: 'object',
        description: 'x',
        properties: {
          characters: {
            type: 'array',
            description: 'x',
            items: { type: 'object', description: 'x', properties: { tags: { type: 'array' } } },
          },
        },
      });
      expect(findings.find((f) => f.severity === 'error')?.path).toBe('characters[].tags');
    });

    it('reports a property key that is not a plain identifier verbatim', () => {
      const findings = lint({ type: 'object', properties: { 'weird-key': { type: 'array' } } });
      expect(findings.find((f) => f.severity === 'error')?.path).toBe('weird-key');
    });
  });

  describe('error-level rules', () => {
    it('reports a top-level array with no item definition', () => {
      const findings = lint({ type: 'object', properties: { openThreads: { type: 'array' } } });
      expect(findings).toContainEqual(expect.objectContaining({ severity: 'error', path: 'openThreads' }));
    });

    it('reports an array with no item definition nested inside another array item', () => {
      const findings = lint({
        type: 'object',
        description: 'x',
        properties: {
          characters: {
            type: 'array',
            description: 'x',
            items: { type: 'object', description: 'x', properties: { tags: { type: 'array' } } },
          },
        },
      });
      expect(findings).toContainEqual(expect.objectContaining({ severity: 'error', path: 'characters[].tags' }));
    });

    it('reports an object with no properties at the schema root', () => {
      const findings = lint({ type: 'object', properties: {} });
      expect(findings).toContainEqual(expect.objectContaining({ severity: 'error', path: '(root)' }));
    });

    it('still reports errors inside a schema whose root uses $defs (composition never hides nested findings)', () => {
      const findings = lint({ type: 'object', $defs: { x: { type: 'string' } }, properties: { tags: { type: 'array' } } });
      expect(findings).toContainEqual(expect.objectContaining({ severity: 'warning', path: '(root)' }));
      expect(findings).toContainEqual(expect.objectContaining({ severity: 'error', path: 'tags' }));
    });

    it('reports a non-object schema root as an error', () => {
      const findings = lint({ type: 'array', items: { type: 'string' } });
      expect(findings).toContainEqual(expect.objectContaining({ severity: 'error', path: '(root)', message: expect.stringContaining('must be an object') }));
    });

    it('does not report an error for a fully defined array', () => {
      const findings = lint({
        type: 'object',
        description: 'x',
        properties: { openThreads: { type: 'array', items: { type: 'string', description: 'x' }, description: 'x' } },
      });
      expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
    });
  });

  describe('dropped-construct warning rules', () => {
    it('reports $ref/$defs and mentions inlining as the fix', () => {
      const findings = lint({ type: 'object', properties: { value: { $ref: '#/$defs/thing' } } });
      const warning = findings.find((f) => f.severity === 'warning' && f.path === 'value');
      expect(warning?.message).toMatch(/inline/i);
    });

    it('reports oneOf/anyOf/allOf', () => {
      const findings = lint({ type: 'object', properties: { value: { oneOf: [{ type: 'string' }, { type: 'number' }] } } });
      expect(findings).toContainEqual(expect.objectContaining({ severity: 'warning', path: 'value' }));
    });

    it('reports patternProperties', () => {
      const findings = lint({ type: 'object', properties: { value: { type: 'object', patternProperties: { '^x-': { type: 'string' } } } } });
      expect(findings).toContainEqual(expect.objectContaining({ severity: 'warning', path: 'value' }));
    });

    it('reports tuple-style items definitions', () => {
      const findings = lint({ type: 'object', properties: { value: { type: 'array', items: [{ type: 'string' }, { type: 'number' }] } } });
      expect(findings).toContainEqual(expect.objectContaining({ severity: 'warning', path: 'value' }));
    });
  });

  describe('dropped-validation-keyword warning rule', () => {
    it('reports minimum, pattern, minLength, and minItems together', () => {
      const findings = lint({
        type: 'object',
        properties: {
          value: { type: 'string', description: 'x', minimum: 0, pattern: '^a', minLength: 1, minItems: 2 },
        },
      });
      const warning = findings.find((f) => f.severity === 'warning' && f.path === 'value');
      expect(warning?.message).toContain('minimum');
      expect(warning?.message).toContain('pattern');
      expect(warning?.message).toContain('minLength');
      expect(warning?.message).toContain('minItems');
    });

    it('reports keywords missing from any hardcoded list (e.g. not, examples, minProperties)', () => {
      const findings = lint({
        type: 'object',
        description: 'x',
        properties: { value: { type: 'string', description: 'x', not: { const: 'y' }, examples: ['q'], minProperties: 1 } },
      });
      const warning = findings.find((f) => f.severity === 'warning' && f.path === 'value');
      expect(warning?.message).toContain('not, examples, minProperties');
    });

    it('never reports a keyword that PROMPT_SCHEMA_KEYWORD_ALLOWLIST honors', () => {
      // Derivation check (design.md "dialect drifts"): any keyword added to the allowlist is
      // automatically treated as honored by the lint, with no second list to update.
      const node: Record<string, unknown> = { type: 'string', description: 'x' };
      for (const keyword of PROMPT_SCHEMA_KEYWORD_ALLOWLIST) {
        if (!(keyword in node) && keyword !== 'properties' && keyword !== 'items') node[keyword] = keyword === 'required' ? [] : 'v';
      }
      const findings = lint({ type: 'object', description: 'x', properties: { value: node } });
      expect(findings.filter((f) => f.path === 'value' && f.message.includes('keyword(s)'))).toEqual([]);
    });

    it('treats draft-07 "definitions" like "$defs"', () => {
      const findings = lint({ type: 'object', description: 'x', definitions: { d: { type: 'string' } }, properties: { a: { type: 'string', description: 'x' } } });
      expect(findings).toContainEqual(expect.objectContaining({ severity: 'warning', path: '(root)', message: expect.stringMatching(/inline/i) }));
    });
  });

  describe('additionalProperties conditional warning rule', () => {
    const schema = { type: 'object', properties: { value: { type: 'object', description: 'x', properties: { a: { type: 'string', description: 'x' } }, additionalProperties: false } } };

    it('warns when grammar enforcement is off', () => {
      const findings = lint(schema, PromptEngineeringMode.JSON, false);
      expect(findings).toContainEqual(expect.objectContaining({ severity: 'warning', path: 'value' }));
    });

    it('does not warn when grammar enforcement is on', () => {
      const findings = lint(schema, PromptEngineeringMode.JSON, true);
      expect(findings.filter((f) => f.path === 'value' && f.severity === 'warning')).toEqual([]);
    });
  });

  describe('array-item-identity warning rule', () => {
    function arraySchema(itemsExtra: Record<string, unknown>) {
      return {
        type: 'object',
        description: 'x',
        properties: {
          characters: {
            type: 'array',
            description: 'x',
            items: { type: 'object', description: 'x', properties: { hair: { type: 'string', description: 'x' } }, ...itemsExtra },
          },
        },
      };
    }

    it('warns for an array of objects with no identity', () => {
      const findings = lint(arraySchema({}));
      expect(findings).toContainEqual(expect.objectContaining({ severity: 'warning', path: 'characters' }));
    });

    it('does not warn when x-ztracker-idKey is set', () => {
      const findings = lint(arraySchema({ 'x-ztracker-idKey': 'hair' }));
      expect(findings.filter((f) => f.path === 'characters' && f.severity === 'warning')).toEqual([]);
    });

    it('does not warn when items include a name property', () => {
      const findings = lint(arraySchema({ properties: { hair: { type: 'string', description: 'x' }, name: { type: 'string', description: 'x' } } }));
      expect(findings.filter((f) => f.path === 'characters' && f.severity === 'warning')).toEqual([]);
    });
  });

  describe('part-ordering warning rules', () => {
    it('warns when x-ztracker-dependsOn references an unknown top-level field', () => {
      const findings = lint({
        type: 'object',
        description: 'x',
        properties: {
          a: { type: 'string', description: 'x', 'x-ztracker-dependsOn': ['doesNotExist'] },
        },
      });
      expect(findings).toContainEqual(expect.objectContaining({ severity: 'warning', path: 'a' }));
    });

    it('warns when top-level fields form a dependsOn cycle', () => {
      const findings = lint({
        type: 'object',
        description: 'x',
        properties: {
          a: { type: 'string', description: 'x', 'x-ztracker-dependsOn': ['b'] },
          b: { type: 'string', description: 'x', 'x-ztracker-dependsOn': ['a'] },
        },
      });
      const cycleWarning = findings.find((f) => f.severity === 'warning' && /cycle/.test(f.message));
      expect(cycleWarning?.path).toBe('(root)');
      expect(cycleWarning?.message).toContain('a, b');
    });
  });

  describe('info-level rules', () => {
    it('aggregates several missing descriptions into exactly one finding naming them', () => {
      const findings = lint({
        type: 'object',
        description: 'x',
        properties: {
          a: { type: 'string' },
          b: { type: 'string' },
          c: { type: 'string', description: 'has one' },
        },
      });
      const descriptionFindings = findings.filter((f) => f.severity === 'info' && f.message.includes('no description'));
      expect(descriptionFindings).toHaveLength(1);
      expect(descriptionFindings[0].message).toContain('a');
      expect(descriptionFindings[0].message).toContain('b');
      expect(descriptionFindings[0].message).not.toContain(', c');
    });

    it('reports no missing-description finding when every field is described', () => {
      const findings = lint({
        type: 'object',
        description: 'x',
        properties: { a: { type: 'string', description: 'x' } },
      });
      expect(findings.filter((f) => f.message.includes('no description'))).toEqual([]);
    });

    it('reports a TOON-specific finding when descriptions are present but discarded', () => {
      const schema = { type: 'object', description: 'x', properties: { a: { type: 'string', description: 'x' } } };
      const toonFindings = lint(schema, PromptEngineeringMode.TOON);
      const jsonFindings = lint(schema, PromptEngineeringMode.JSON);

      expect(toonFindings.some((f) => f.severity === 'info' && /descript/i.test(f.message) && /TOON|discard/i.test(f.message))).toBe(true);
      expect(jsonFindings.some((f) => f.severity === 'info' && /discard/i.test(f.message))).toBe(false);
    });
  });

  describe('severity is mode-independent', () => {
    it('produces identical error and warning findings across every prompt engineering mode, differing only in the TOON description finding', () => {
      const schema = {
        type: 'object',
        description: 'x',
        properties: {
          openThreads: { type: 'array' }, // error
          value: { $ref: '#/$defs/thing' }, // warning
          described: { type: 'string', description: 'x' },
        },
      };

      const modes = [PromptEngineeringMode.NATIVE, PromptEngineeringMode.JSON, PromptEngineeringMode.XML, PromptEngineeringMode.TOON];
      const byMode = modes.map((mode) => lint(schema, mode));
      const nonInfoByMode = byMode.map((findings) => errorsAndWarnings(findings));

      for (const findings of nonInfoByMode) {
        expect(findings).toEqual(nonInfoByMode[0]);
      }

      const infoByMode = byMode.map((findings) => findings.filter((f) => f.severity === 'info'));
      const toonIndex = modes.indexOf(PromptEngineeringMode.TOON);
      infoByMode.forEach((infoFindings, index) => {
        if (index === toonIndex) {
          expect(infoFindings.some((f) => /discard/i.test(f.message))).toBe(true);
        } else {
          expect(infoFindings.some((f) => /discard/i.test(f.message))).toBe(false);
        }
      });
    });
  });

  describe('re-exported HTML-generator dialect helpers (openspec 3.1 move)', () => {
    it('hasCompositionKeywords detects oneOf/anyOf/allOf/patternProperties/$ref/$defs', () => {
      expect(hasCompositionKeywords({ oneOf: [] })).toBe(true);
      expect(hasCompositionKeywords({ $ref: '#/x' })).toBe(true);
      expect(hasCompositionKeywords({ type: 'string' })).toBe(false);
    });

    it('isUnsupportedSchema detects composition keywords and unusable shapes', () => {
      expect(isUnsupportedSchema({ oneOf: [] })).toBe(true);
      expect(isUnsupportedSchema({})).toBe(true);
      expect(isUnsupportedSchema({ type: 'string' })).toBe(false);
    });
  });
});
