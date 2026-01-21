import { parseResponse } from '../parser.js';

describe('parseResponse', () => {
  it('parses JSON inside fenced code blocks', () => {
    const content = 'Model said: ```json\n{"foo": "bar"}\n```';
    const result = parseResponse(content, 'json');
    expect(result).toEqual({ foo: 'bar' });
  });

  it('normalizes XML arrays according to schema', () => {
    const schema = {
      properties: {
        characters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
          },
        },
      },
    };
    const xml = '```xml\n<root><characters><name>Alice</name></characters></root>\n```';
    const result = parseResponse(xml, 'xml', { schema });
    expect(result).toEqual({ characters: [{ name: 'Alice' }] });
  });

  it('throws a descriptive error on invalid JSON', () => {
    const bad = '```json\n{ invalid }\n```';
    expect(() => parseResponse(bad, 'json')).toThrow('Model response is not valid JSON.');
  });
});
