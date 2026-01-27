import {
  buildArrayItemFieldSchema,
  buildArrayItemSchema,
  buildTopLevelPartSchema,
  findArrayItemIndexByIdentity,
  findArrayItemIndexByName,
  getArrayItemIdentityKey,
  getTopLevelSchemaKeys,
  mergeTrackerPart,
  replaceTrackerArrayItem,
  replaceTrackerArrayItemField,
  redactTrackerArrayItemFieldValue,
  resolveTopLevelPartsOrder,
} from '../tracker-parts.js';

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

  it('resolves dependency-aware top-level order using x-ztracker-dependsOn', () => {
    const s = {
      type: 'object',
      properties: {
        time: { type: 'string' },
        charactersPresent: { type: 'array', items: { type: 'string' } },
        characters: { type: 'array', 'x-ztracker-dependsOn': ['charactersPresent'], items: { type: 'object' } },
      },
    };

    expect(resolveTopLevelPartsOrder(s)).toEqual(['time', 'charactersPresent', 'characters']);
  });

  it('falls back to declared order when dependencies contain a cycle', () => {
    const s = {
      type: 'object',
      properties: {
        a: { type: 'string', 'x-ztracker-dependsOn': ['b'] },
        b: { type: 'string', 'x-ztracker-dependsOn': ['a'] },
        c: { type: 'string' },
      },
    };

    expect(resolveTopLevelPartsOrder(s)).toEqual(['a', 'b', 'c']);
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

  it('builds an array item schema using properties.item', () => {
    const s = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'SceneTracker',
      type: 'object',
      properties: {
        characters: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        },
      },
    };

    const itemSchema = buildArrayItemSchema(s, 'characters');
    expect(itemSchema.type).toBe('object');
    expect(itemSchema.required).toEqual(['item']);
    expect(itemSchema.properties.item.type).toBe('object');
  });

  it('builds an array item field schema using properties.value', () => {
    const s = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'SceneTracker',
      type: 'object',
      properties: {
        characters: {
          type: 'array',
          items: {
            type: 'object',
            properties: { outfit: { type: 'string' } },
            required: ['outfit'],
          },
        },
      },
    };

    const fieldSchema = buildArrayItemFieldSchema(s, 'characters', 'outfit');
    expect(fieldSchema.type).toBe('object');
    expect(fieldSchema.required).toEqual(['value']);
    expect(fieldSchema.properties.value.type).toBe('string');
  });

  it('replaces a single array item without changing other items', () => {
    const current = { characters: [{ name: 'A' }, { name: 'B' }], time: 't' };
    const next = replaceTrackerArrayItem(current, 'characters', 1, { name: 'C' });
    expect(next).toEqual({ characters: [{ name: 'A' }, { name: 'C' }], time: 't' });
  });

  it('replaces a single array item field without changing other fields', () => {
    const current = { characters: [{ name: 'A', outfit: 'o1' }, { name: 'B', outfit: 'o2' }], time: 't' };
    const next = replaceTrackerArrayItemField(current, 'characters', 1, 'outfit', 'o3');
    expect(next).toEqual({ characters: [{ name: 'A', outfit: 'o1' }, { name: 'B', outfit: 'o3' }], time: 't' });
  });

  it('redacts a single array item field value for prompt context', () => {
    const current = {
      characters: [
        { name: 'A', makeup: 'old', outfit: 'o1' },
        { name: 'B', makeup: 'old2', outfit: 'o2' },
      ],
      time: 't',
    };

    const redacted = redactTrackerArrayItemFieldValue(current, 'characters', 0, 'makeup');
    expect((redacted as any).time).toBe('t');
    expect((redacted as any).characters[0].name).toBe('A');
    expect((redacted as any).characters[0].makeup).toBeUndefined();
    expect((redacted as any).characters[0].outfit).toBe('o1');
    expect((redacted as any).characters[1].makeup).toBe('old2');
  });

  it('finds array item index by name (exact, then unique case-insensitive)', () => {
    const arr = [{ name: 'Alice' }, { name: 'Bob' }];
    expect(findArrayItemIndexByName(arr as any, 'Bob')).toBe(1);
    expect(findArrayItemIndexByName(arr as any, 'alice')).toBe(0);
    expect(findArrayItemIndexByName(arr as any, 'Missing')).toBe(-1);
  });

  it('derives array identity key from schema (x-ztracker-idKey, default name)', () => {
    const s = {
      type: 'object',
      properties: {
        characters: { type: 'array', 'x-ztracker-idKey': 'name', items: { type: 'object' } },
        items: { type: 'array', 'x-ztracker-idKey': 'id', items: { type: 'object' } },
      },
    };

    expect(getArrayItemIdentityKey(s, 'characters')).toBe('name');
    expect(getArrayItemIdentityKey(s, 'items')).toBe('id');
    expect(getArrayItemIdentityKey(s, 'missing')).toBe('name');
  });

  it('finds array item index by identity (exact, then unique case-insensitive)', () => {
    const arr = [{ id: 'A1' }, { id: 'B2' }];
    expect(findArrayItemIndexByIdentity(arr as any, 'id', 'B2')).toBe(1);
    expect(findArrayItemIndexByIdentity(arr as any, 'id', 'a1')).toBe(0);
    expect(findArrayItemIndexByIdentity(arr as any, 'id', 'Missing')).toBe(-1);
  });
});
