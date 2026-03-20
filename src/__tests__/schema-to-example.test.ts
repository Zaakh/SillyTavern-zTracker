import { schemaToExample } from '../schema-to-example.js';

describe('schemaToExample', () => {
  const schema = {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Title text' },
      tags: {
        type: 'array',
        items: { type: 'string' },
      },
      meta: {
        type: 'object',
        properties: {
          count: { type: 'number' },
        },
      },
    },
  };

  it('produces formatted JSON samples', () => {
    const result = schemaToExample(schema, 'json');
    expect(JSON.parse(result)).toEqual({
      title: 'Title text',
      tags: ['string'],
      meta: { count: 0 },
    });
  });

  it('produces XML samples that mirror the schema', () => {
    const result = schemaToExample(schema, 'xml');
    expect(result).toContain('<title>Title text</title>');
    expect(result).toContain('<tags>string</tags>');
    expect(result).toContain('<count>0</count>');
  });

  it('produces TOON samples that mirror the schema', () => {
    const result = schemaToExample(schema, 'toon');
    expect(result).toContain('title: Title text');
    expect(result).toContain('tags[1');
    expect(result).toContain('meta:');
    expect(result).toContain('count: 0');
  });

  it('produces TOON samples for deeply nested schemas', () => {
    const nestedSchema = {
      type: 'object',
      properties: {
        scene: {
          type: 'object',
          properties: {
            cast: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  stats: {
                    type: 'object',
                    properties: {
                      mood: { type: 'string' },
                    },
                  },
                  traits: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = schemaToExample(nestedSchema, 'toon');

    expect(result).toContain('scene:');
    expect(result).toContain('cast[1');
    expect(result).toContain('mood: string');
    expect(result).toContain('traits[1');
  });
});
