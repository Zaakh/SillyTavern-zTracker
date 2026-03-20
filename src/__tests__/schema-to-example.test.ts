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
    expect(result).toContain('description: Title text');
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
