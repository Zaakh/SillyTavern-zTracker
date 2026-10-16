import { formatAllowlistedWorldInfo, normalizeWorldInfoName } from '../world-info-policy.js';

describe('world info policy', () => {
  test('normalizeWorldInfoName is case-insensitive', () => {
    expect(normalizeWorldInfoName('  My Book  ')).toBe('my book');
  });


  const entry = (uid: number, content: string, disable = false) => ({ uid, key: ['k'], content, comment: '', disable });

  test('formatAllowlistedWorldInfo includes enabled entries only, as bare content sorted by book', () => {
    const text = formatAllowlistedWorldInfo([
      { name: 'Book B', entries: [entry(3, 'B-content')], entryIds: [] },
      { name: 'Book A', entries: [entry(1, 'A-content'), entry(2, 'disabled', true)], entryIds: [] },
    ]);

    expect(text).toBe('A-content\n\nB-content');
  });

  test('formatAllowlistedWorldInfo limits a book to its entry subset', () => {
    const text = formatAllowlistedWorldInfo([
      { name: 'Book A', entries: [entry(12, 'twelve'), entry(13, 'thirteen'), entry(42, 'forty-two')], entryIds: [12, 42] },
    ]);

    expect(text).toContain('twelve');
    expect(text).toContain('forty-two');
    expect(text).not.toContain('thirteen');
  });

  test('formatAllowlistedWorldInfo returns empty string when nothing matches', () => {
    expect(formatAllowlistedWorldInfo([])).toBe('');
    expect(formatAllowlistedWorldInfo([{ name: 'A', entries: [entry(1, 'x', true), entry(2, '  ')], entryIds: [] }])).toBe('');
  });
});
