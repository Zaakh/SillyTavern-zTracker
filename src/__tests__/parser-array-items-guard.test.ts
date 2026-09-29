/**
 * Reproduces and pins the fix for a schema-authoring bug that used to crash reply parsing:
 * `coerceParsedArraysBySchema()` (src/parser/shared.ts) dereferenced `items.type` unconditionally,
 * throwing a TypeError for any array property with a missing or tuple-form `items` definition.
 * `parseResponse()` caught that TypeError and rethrew it as the disguised "Model response is not
 * valid XML/TOON." - blaming the model for a schema bug. See
 * openspec/changes/add-schema-dialect-lint/design.md D5.
 */
import { parseResponse } from '../parser.js';

describe('parseResponse tolerates arrays with no item definition', () => {
  it('does not throw for XML when an array property has no items', () => {
    const schema = {
      properties: {
        openThreads: { type: 'array' },
      },
    };
    const xml = '<root><openThreads>Alice</openThreads></root>';

    expect(() => parseResponse(xml, 'xml', { schema })).not.toThrow();
    expect(parseResponse(xml, 'xml', { schema })).toEqual({ openThreads: ['Alice'] });
  });

  it('does not throw for TOON when an array property has no items', () => {
    const schema = {
      properties: {
        openThreads: { type: 'array' },
      },
    };
    const toon = 'openThreads: Alice';

    expect(() => parseResponse(toon, 'toon', { schema })).not.toThrow();
    expect(parseResponse(toon, 'toon', { schema })).toEqual({ openThreads: ['Alice'] });
  });

  it('does not throw for a tuple-form (array) items definition', () => {
    const schema = {
      properties: {
        openThreads: { type: 'array', items: [{ type: 'string' }, { type: 'number' }] },
      },
    };
    const xml = '<root><openThreads>Alice</openThreads></root>';

    expect(() => parseResponse(xml, 'xml', { schema })).not.toThrow();
  });

  it('does not throw for a null property schema', () => {
    const schema = { properties: { broken: null, name: { type: 'string' } } };
    expect(parseResponse('<root><name>Alice</name></root>', 'xml', { schema })).toEqual({ name: 'Alice' });
  });

  it('still normalizes arrays whose items ARE fully defined (regression guard)', () => {
    const schema = {
      properties: {
        characters: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'array' } },
          },
        },
      },
    };
    // A single non-array <characters> element must still be wrapped into an array, and its nested
    // object item must still be recursed into (its own `name` scalar wrapped into an array too).
    const xml = '<root><characters><name>Alice</name></characters></root>';

    expect(parseResponse(xml, 'xml', { schema })).toEqual({ characters: [{ name: ['Alice'] }] });
  });
});
