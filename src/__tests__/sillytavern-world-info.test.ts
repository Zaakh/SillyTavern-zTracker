import { describe, expect, jest, test } from '@jest/globals';
import { loadFullWorldInfoEntries } from '../sillytavern-world-info.js';

describe('loadFullWorldInfoEntries', () => {
  test('returns the host entry objects with group and probability intact', async () => {
    const loadWorldInfo = jest.fn(async () => ({
      entries: { 1: { uid: 1, group: 'g', probability: 40, content: 'a' }, 2: { uid: 2, content: 'b' } },
    }));
    expect(await loadFullWorldInfoEntries('Lore', loadWorldInfo)).toEqual([
      { uid: 1, group: 'g', probability: 40, content: 'a' },
      { uid: 2, content: 'b' },
    ]);
    expect(loadWorldInfo).toHaveBeenCalledWith('Lore');
  });

  test('returns null for a missing book or malformed data', async () => {
    expect(await loadFullWorldInfoEntries('X', async () => null)).toBeNull();
    expect(await loadFullWorldInfoEntries('X', async () => ({}))).toBeNull();
  });
});
