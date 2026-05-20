import { schemaToExample, schemaToPromptSchema } from '../schema-to-example.js';

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

  it('renders XML prompt schema from the canonical JSON schema', () => {
    const result = schemaToPromptSchema(schema, 'xml');

    expect(result).not.toContain('<schema>\n<schema>');
    expect(result).toContain('<type>object</type>');
    expect(result).toContain('<properties>');
    expect(result).toContain('<description>Title text</description>');
  });

  it('produces TOON samples that mirror the schema', () => {
    const result = schemaToExample(schema, 'toon');
    expect(result).toContain('title: Title text');
    expect(result).toContain('tags[1');
    expect(result).toContain('meta:');
    expect(result).toContain('count: 0');
  });

  it('renders TOON prompt schema from the canonical JSON schema', () => {
    const result = schemaToPromptSchema(schema, 'toon');

    expect(result).toContain('type: object');
    expect(result).toContain('properties:');
    expect(result).toContain('title:');
    expect(result).not.toContain('description: Title text');
  });

  it('keeps TOON prompt schemas lean by dropping duplicated document metadata and descriptions', () => {
    const result = schemaToPromptSchema(
      {
        title: 'SceneTracker',
        description: 'Schema for tracking roleplay scene details',
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title text' },
        },
      },
      'toon',
    );

    expect(result).toContain('type: object');
    expect(result).toContain('properties:');
    expect(result).not.toContain('SceneTracker');
    expect(result).not.toContain('Schema for tracking roleplay scene details');
    expect(result).not.toContain('http://json-schema.org/draft-07/schema#');
    expect(result).not.toContain('description: Title text');
  });

  it('drops low-value TOON prompt-schema fields that do not affect generation shape', () => {
    const result = schemaToPromptSchema(
      {
        type: 'object',
        properties: {
          timestamp: { type: 'string', format: 'date-time', default: '2026-05-18T12:00:00Z' },
          describedTimestamp: {
            type: 'string',
            format: 'date-time',
            default: '2026-05-18T12:00:00Z',
            description: 'ISO 8601 timestamp',
          },
          items: {
            type: 'array',
            'x-ztracker-idKey': 'id',
            'x-ztracker-dependsOn': ['timestamp'],
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', default: 'item-1' },
              },
            },
          },
        },
      },
      'toon',
    );

    expect(result).toContain('timestamp:');
    expect(result).toContain('format: date-time');
    expect(result).toContain('default: "2026-05-18T12:00:00Z"');
    expect(result).toContain('items:');
    expect(result).toContain('"x-ztracker-idKey": id');
    expect(result).toContain('"x-ztracker-dependsOn"[1');
    expect(result).not.toContain('describedTimestamp:\n    format: date-time');
    expect(result).not.toContain('describedTimestamp:\n    default: 2026-05-18T12:00:00Z');
  });

  it('keeps JSON prompt schemas explicit about format, defaults, and zTracker metadata', () => {
    const result = JSON.parse(
      schemaToPromptSchema(
        {
          type: 'object',
          properties: {
            timestamp: { type: 'string', format: 'date-time', default: '2026-05-18T12:00:00Z' },
            items: {
              type: 'array',
              'x-ztracker-idKey': 'id',
              'x-ztracker-dependsOn': ['timestamp'],
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', default: 'item-1' },
                },
              },
            },
          },
        },
        'json',
      ),
    );

    expect(result.properties.timestamp.format).toBe('date-time');
    expect(result.properties.timestamp.default).toBe('2026-05-18T12:00:00Z');
    expect(result.properties.items['x-ztracker-idKey']).toBe('id');
    expect(result.properties.items['x-ztracker-dependsOn']).toEqual(['timestamp']);
    expect(result.properties.items.items.properties.id.default).toBe('item-1');
  });

  it('renders JSON prompt schema from the normalized schema shape while preserving required fields', () => {
    const result = JSON.parse(
      schemaToPromptSchema(
        {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Title text' },
          },
          required: ['title'],
          additionalProperties: false,
          example: { title: 'ignored example' },
        },
        'json',
      ),
    );

    expect(result).toEqual({
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title text' },
      },
      required: ['title'],
    });
    expect(result).not.toHaveProperty('additionalProperties');
    expect(result).not.toHaveProperty('example');
  });

  it('does not leak schema required metadata into JSON example output', () => {
    const result = JSON.parse(
      schemaToExample(
        {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Title text' },
            meta: {
              type: 'object',
              properties: {
                count: { type: 'number' },
              },
              required: ['count'],
            },
          },
          required: ['title', 'meta'],
        },
        'json',
      ),
    );

    expect(result).toEqual({
      title: 'Title text',
      meta: {
        count: 0,
      },
    });
    expect(result).not.toHaveProperty('required');
    expect(result.meta).not.toHaveProperty('required');
  });

  it('repairs misplaced properties.required arrays before rendering schema and example blocks', () => {
    const corruptedSchema = {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title text' },
        required: ['title', 'meta'],
        meta: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            required: { 0: 'count' },
          },
          required: [],
        },
      },
      required: [],
    };

    const promptSchema = JSON.parse(schemaToPromptSchema(corruptedSchema, 'json'));
    const example = JSON.parse(schemaToExample(corruptedSchema, 'json'));

    expect(promptSchema.required).toEqual(['title', 'meta']);
    expect(promptSchema.properties).not.toHaveProperty('required');
    expect(promptSchema.properties.meta.required).toEqual(['count']);
    expect(promptSchema.properties.meta.properties).not.toHaveProperty('required');

    expect(example).toEqual({
      title: 'Title text',
      meta: {
        count: 0,
      },
    });
    expect(example).not.toHaveProperty('required');
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

  it('produces examples for distinct tracker scenarios beyond chat scenes', () => {
    const scenarioSchemas = [
      {
        type: 'object',
        properties: {
          questName: { type: 'string', description: 'Active quest title' },
          partyMembers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Party member name' },
                hp: { type: 'number' },
                statusEffects: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          encounterState: {
            type: 'object',
            properties: {
              round: { type: 'number' },
              initiativeLeader: { type: 'string', description: 'Current turn leader' },
            },
          },
        },
      },
      {
        type: 'object',
        properties: {
          caseId: { type: 'string', description: 'Investigation case identifier' },
          suspects: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Suspect name' },
                motive: { type: 'string', description: 'Primary motive' },
                alibiVerified: { type: 'boolean' },
              },
            },
          },
          evidenceBoard: {
            type: 'object',
            properties: {
              leadSummary: { type: 'string', description: 'Current lead summary' },
              openQuestions: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      {
        type: 'object',
        properties: {
          locationSeed: { type: 'string', description: 'Current biome or region' },
          resources: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', description: 'Resource type' },
                quantity: { type: 'number' },
                spoilageRisk: { type: 'string', description: 'Spoilage or loss risk' },
              },
            },
          },
          shelter: {
            type: 'object',
            properties: {
              integrity: { type: 'number' },
              hazards: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    ];

    for (const scenarioSchema of scenarioSchemas) {
      const jsonExample = JSON.parse(schemaToExample(scenarioSchema, 'json'));
      const xmlExample = schemaToExample(scenarioSchema, 'xml');
      const toonExample = schemaToExample(scenarioSchema, 'toon');

      expect(Object.keys(jsonExample)).toEqual(Object.keys(scenarioSchema.properties));
      expect(xmlExample.length).toBeGreaterThan(0);
      expect(toonExample.length).toBeGreaterThan(0);
    }
  });
});
