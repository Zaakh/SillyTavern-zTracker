import { parseResponse } from '../parser.js';
import { jest } from '@jest/globals';
import { encode } from '@toon-format/toon';

describe('parseResponse', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('parses strict valid JSON without repair logging', () => {
    const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const result = parseResponse('{"foo":"bar"}', 'json');

    expect(result).toEqual({ foo: 'bar' });
    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  it('parses JSON inside fenced code blocks', () => {
    const content = 'Model said: ```json\n{"foo": "bar"}\n```';
    const result = parseResponse(content, 'json');
    expect(result).toEqual({ foo: 'bar' });
  });

  it('keeps fenced JSON values containing literal triple backticks intact', () => {
    const content = '```json\n{"foo": "literal ``` fence"}\n```';
    const result = parseResponse(content, 'json');

    expect(result).toEqual({ foo: 'literal ``` fence' });
  });

  it('repairs JSON with repeated fenced wrappers', () => {
    const content = '```json\n```JSON\n{"foo":"bar"}\n```\n```';
    const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    const result = parseResponse(content, 'json');

    expect(result).toEqual({ foo: 'bar' });
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      'zTracker: repaired JSON response',
      expect.objectContaining({
        appliedSteps: ['fence cleanup'],
      }),
    );
  });

  it('repairs JSON by extracting a balanced object from surrounding prose', () => {
    const content = 'Here is the JSON you asked for:\n\n{"foo":"bar"}\n\nUse it carefully.';
    const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    const result = parseResponse(content, 'json');

    expect(result).toEqual({ foo: 'bar' });
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      'zTracker: repaired JSON response',
      expect.objectContaining({
        appliedSteps: ['json substring extraction'],
      }),
    );
  });

  it('repairs JSON with trailing commas', () => {
    const content = '{"foo":"bar", "items":[1,2,],}';
    const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    const result = parseResponse(content, 'json');

    expect(result).toEqual({ foo: 'bar', items: [1, 2] });
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      'zTracker: repaired JSON response',
      expect.objectContaining({
        appliedSteps: ['trailing comma removal'],
      }),
    );
  });

  it('repairs JSON with smart quotes and invisible leading characters', () => {
    const content = '\uFEFF\u200B{“foo”: “bar”}';
    const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    const result = parseResponse(content, 'json');

    expect(result).toEqual({ foo: 'bar' });
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      'zTracker: repaired JSON response',
      expect.objectContaining({
        appliedSteps: ['whitespace normalization', 'smart quote normalization'],
      }),
    );
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

  it('parses XML with repeated fenced wrappers', () => {
    const content = '```xml\n```XML\n<root><foo>bar</foo></root>\n```\n```';
    const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    const result = parseResponse(content, 'xml');

    expect(result).toEqual({ foo: 'bar' });
    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  it('parses strict valid TOON without repair logging', () => {
    const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const value = {
      time: '10:00',
      topics: { primaryTopic: 'Talk' },
      characters: [{ name: 'Silvia', outfit: 'Black apron', mood: 'calm' }],
    };

    const result = parseResponse(encode(value, { delimiter: '\t' }), 'toon');

    expect(result).toEqual(value);
    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  it('repairs TOON when tabular output loses tab delimiters', () => {
    const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const value = {
      time: '10:00',
      topics: { primaryTopic: 'Talk' },
      characters: [{ name: 'Silvia', outfit: 'Black apron', mood: 'calm' }],
    };
    const damaged = encode(value, { delimiter: '\t' }).replace(/\t/g, '  ');

    const result = parseResponse(damaged, 'toon');

    expect(result).toEqual(value);
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      'zTracker: repaired TOON response',
      expect.objectContaining({
        appliedSteps: ['tabular delimiter normalization'],
      }),
    );
  });

  it('normalizes TOON arrays according to schema', () => {
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
    const toon = '```toon\ncharacters:\n  name: Alice\n```';

    const result = parseResponse(toon, 'toon', { schema });

    expect(result).toEqual({ characters: [{ name: 'Alice' }] });
  });

  it('keeps strict TOON values with repeated spaces inside scalars', () => {
    const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const value = {
      notes: {
        outfit: 'Red   dress',
      },
    };

    const result = parseResponse(encode(value, { delimiter: '\t' }), 'toon');

    expect(result).toEqual(value);
    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  it('throws a descriptive error on invalid JSON', () => {
    const bad = '```json\n{ invalid }\n```';
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => parseResponse(bad, 'json')).toThrow('Model response is not valid JSON.');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'zTracker: malformed payload',
        expect.objectContaining({
          format: 'json',
          rawContent: bad,
        }),
      );
    } finally {
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      consoleInfoSpy.mockRestore();
    }
  });

  it('logs malformed raw payloads for TOON parser failures too', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = 'characters[1\t]{name outfit mood}:\n  Silvia\tBlack apron\tcalm';

    try {
      expect(() => parseResponse(bad, 'toon')).toThrow('Model response is not valid TOON.');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'zTracker: malformed payload',
        expect.objectContaining({
          format: 'toon',
          rawContent: bad,
        }),
      );
    } finally {
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      consoleInfoSpy.mockRestore();
    }
  });

  it('keeps failing for pseudo-JSON that would require forbidden repairs', () => {
    const bad = "{'foo': 'bar'}";
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      expect(() => parseResponse(bad, 'json')).toThrow('Model response is not valid JSON.');
      expect(consoleInfoSpy).not.toHaveBeenCalled();
    } finally {
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      consoleInfoSpy.mockRestore();
    }
  });

  it('keeps failing for TOON damage that cannot be repaired safely', () => {
    const value = {
      characters: [{ name: 'Silvia', outfit: 'Black apron', mood: 'calm' }],
    };
    const bad = encode(value, { delimiter: '\t' }).replace('{name\toutfit\tmood}', '{name outfit mood}');
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      expect(() => parseResponse(bad, 'toon')).toThrow('Model response is not valid TOON.');
    } finally {
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      consoleInfoSpy.mockRestore();
    }
  });
});
