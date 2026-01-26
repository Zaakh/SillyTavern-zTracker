import { buildTopLevelPartSchema, getTopLevelSchemaKeys, mergeTrackerPart } from '../tracker-parts.js';

describe('tracker parts helpers', () => {
  const schema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'SceneTracker',
    type: 'object',
    properties: {
      time: { type: 'string' },
      topics: {
        type: 'object',
        properties: {
          primaryTopic: { type: 'string' },
        },
        required: ['primaryTopic'],
      },
    },
    required: ['time', 'topics'],
  };

  it('derives top-level keys from schema.properties in order', () => {
    expect(getTopLevelSchemaKeys(schema)).toEqual(['time', 'topics']);
  });

  it('builds a reduced schema that requires only the requested part', () => {
    const part = buildTopLevelPartSchema(schema, 'topics');
    expect(part.type).toBe('object');
    expect(Object.keys(part.properties)).toEqual(['topics']);
    expect(part.required).toEqual(['topics']);
  });

  it('merges a part object by replacing the subtree for that key', () => {
    const current = { time: 'old', topics: { primaryTopic: 'A' } };
    const next = mergeTrackerPart(current, 'topics', { topics: { primaryTopic: 'B' } });
    expect(next).toEqual({ time: 'old', topics: { primaryTopic: 'B' } });
  });
});
