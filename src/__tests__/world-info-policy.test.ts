import {
  capReportText,
  finalizeReportBooks,
  formatAllowlistedWorldInfo,
  normalizeWorldInfoName,
  WORLD_INFO_REPORT_BOOK_CAP,
  WORLD_INFO_REPORT_LIST_CAP,
  WORLD_INFO_REPORT_TEXT_CAP,
  worldInfoEntryTitle,
} from '../world-info-policy.js';

describe('world info policy', () => {
  test('normalizeWorldInfoName is case-insensitive', () => {
    expect(normalizeWorldInfoName('  My Book  ')).toBe('my book');
  });

  const entry = (uid: number, content: string, disable = false, comment = '') => ({ uid, key: ['k'], content, comment, disable });

  test('formatAllowlistedWorldInfo includes enabled entries only, as bare content sorted by book', () => {
    const { text } = formatAllowlistedWorldInfo([
      { name: 'Book B', entries: [entry(3, 'B-content')], entryIds: [] },
      { name: 'Book A', entries: [entry(1, 'A-content'), entry(2, 'disabled', true)], entryIds: [] },
    ]);

    expect(text).toBe('A-content\n\nB-content');
  });

  test('formatAllowlistedWorldInfo limits a book to its entry subset', () => {
    const { text } = formatAllowlistedWorldInfo([
      { name: 'Book A', entries: [entry(12, 'twelve'), entry(13, 'thirteen'), entry(42, 'forty-two')], entryIds: [12, 42] },
    ]);

    expect(text).toContain('twelve');
    expect(text).toContain('forty-two');
    expect(text).not.toContain('thirteen');
  });

  test('formatAllowlistedWorldInfo returns empty text when nothing matches', () => {
    expect(formatAllowlistedWorldInfo([]).text).toBe('');
    expect(formatAllowlistedWorldInfo([{ name: 'A', entries: [entry(1, 'x', true), entry(2, '  ')], entryIds: [] }]).text).toBe('');
  });

  test('formatAllowlistedWorldInfo reports applied entries and every skip cause', () => {
    const { groups } = formatAllowlistedWorldInfo([
      {
        name: 'Book',
        entries: [entry(1, 'ok', false, 'Applied'), entry(2, 'off', true, 'Off'), entry(3, '  ', false, 'Blank'), entry(4, 'out', false, 'Out')],
        entryIds: [1, 2, 3],
      },
    ]);

    expect(groups).toEqual([
      {
        book: 'Book',
        applied: [{ uid: 1, title: 'Applied', via: 'allowlist' }],
        skipped: [
          { uid: 2, title: 'Off', cause: 'disabled' },
          { uid: 3, title: 'Blank', cause: 'empty' },
          { uid: 4, title: 'Out', cause: 'not-in-subset' },
        ],
      },
    ]);
  });

  test('entries never carry content', () => {
    const { groups } = formatAllowlistedWorldInfo([{ name: 'Book', entries: [entry(1, 'secret-content')], entryIds: [] }]);
    expect(JSON.stringify(groups)).not.toContain('secret-content');
  });

  test('title falls back to the first key, then the uid', () => {
    expect(worldInfoEntryTitle({ uid: 7, comment: ' Name ', key: ['a'] })).toBe('Name');
    expect(worldInfoEntryTitle({ uid: 7, comment: '', key: ['', ' dragon '] })).toBe('dragon');
    expect(worldInfoEntryTitle({ uid: 7, comment: '', key: [] })).toBe('7');
  });

  test('finalizeReportBooks caps each list, counts the rest, merges books and drops empty ones', () => {
    const many = Array.from({ length: WORLD_INFO_REPORT_LIST_CAP + 3 }, (_, i) => ({ uid: i, title: `t${i}`, via: 'allowlist' as const }));
    const { books } = finalizeReportBooks([
      { book: 'Big', applied: many, skipped: [] },
      { book: 'Big', applied: [], skipped: [{ cause: 'scope' }] },
      { book: 'Empty', applied: [], skipped: [] },
    ]);

    expect(books).toHaveLength(1);
    expect(books[0].applied).toHaveLength(WORLD_INFO_REPORT_LIST_CAP);
    expect(books[0].moreApplied).toBe(3);
    expect(books[0].skipped).toEqual([{ cause: 'scope' }]);
    expect(books[0].moreSkipped).toBeUndefined();
  });

  test('long titles and book names are truncated, and the number of books is capped', () => {
    const long = 'x'.repeat(WORLD_INFO_REPORT_TEXT_CAP + 50);
    expect(capReportText(long)).toHaveLength(WORLD_INFO_REPORT_TEXT_CAP + 1);
    expect(worldInfoEntryTitle({ uid: 1, comment: long })).toBe(capReportText(long));

    const groups = Array.from({ length: WORLD_INFO_REPORT_BOOK_CAP + 4 }, (_, i) => ({
      book: `Book ${i}`,
      applied: [{ uid: i, title: 't', via: 'allowlist' as const }],
      skipped: [],
    }));
    const result = finalizeReportBooks(groups);
    expect(result.books).toHaveLength(WORLD_INFO_REPORT_BOOK_CAP);
    expect(result.moreBooks).toBe(4);
    expect(finalizeReportBooks(groups.slice(0, 2)).moreBooks).toBeUndefined();
  });
});
