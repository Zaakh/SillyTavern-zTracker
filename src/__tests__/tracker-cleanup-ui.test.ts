import { buildCleanupPopupRows } from '../ui/tracker-cleanup.js';

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
      partsMeta: {},
      pendingTargets: [],
    });

    expect(rows.map((row) => row.label)).toEqual(['characters', 'Alice', 'Alice.outfit']);
    expect(rows.some((row) => row.label.toLowerCase().includes('required'))).toBe(false);
  });
});