import { buildCleanupPopupRows } from '../ui/tracker-cleanup-ui.js';

describe('tracker cleanup UI', () => {
  it('does not surface schema required metadata as a cleanup target', () => {
    const rows = buildCleanupPopupRows({
      trackerData: {
        characters: [{ name: 'Alice', outfit: 'dress', required: ['outfit'] }],
      },
      schema: {
        type: 'object',
        properties: {
          characters: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                outfit: { type: 'string' },
              },
              required: ['name', 'outfit'],
            },
          },
        },
        required: ['characters'],
      },
      partsOrder: ['characters'],
      partsMeta: {
        characters: {
          fields: ['required', 'outfit'],
        },
      },
      pendingTargets: [],
    });

    expect(rows.map((row) => row.label)).toEqual(['characters', 'Alice', 'Alice.outfit']);
    expect(rows.some((row) => row.label.toLowerCase().includes('required'))).toBe(false);
  });

  it('matches pending array rows by stable identity when saved indexes drift', () => {
    const rows = buildCleanupPopupRows({
      trackerData: {
        characters: [{ name: 'Bob', outfit: 'coat' }, { name: 'Alice', outfit: '' }],
      },
      schema: {
        type: 'object',
        properties: {
          characters: {
            type: 'array',
            'x-ztracker-idKey': 'name',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                outfit: { type: 'string' },
              },
            },
          },
        },
      },
      partsOrder: ['characters'],
      partsMeta: {
        characters: { idKey: 'name', fields: ['outfit'] },
      },
      pendingTargets: [
        { kind: 'array-item', partKey: 'characters', index: 0, idKey: 'name', idValue: 'Alice', displayLabel: 'Alice' },
      ],
    });

    expect(rows.find((row) => row.label === 'Alice')?.pending).toBe(true);
    expect(rows.find((row) => row.label === 'Bob')?.pending).toBe(false);
  });
});