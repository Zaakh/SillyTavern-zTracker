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
});
