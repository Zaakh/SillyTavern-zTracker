import { jest } from '@jest/globals';
import { buildAllowlistedWorldInfoText } from '../world-info-allowlist.js';

const sources = (card: string[] = [], global: string[] = []) => ({
  cardBooks: new Set(card),
  globalBooks: new Set(global),
  chatOpen: true,
  cardLookupComplete: true,
});

const books: Record<string, any[]> = {
  'The Bar': [
    { uid: 10, key: ['bar'], content: 'Bar-content', comment: '', disable: false },
    { uid: 11, key: ['bar'], content: 'Disabled', comment: '', disable: true },
    { uid: 12, key: ['bar'], content: 'Bar-second', comment: '', disable: false },
  ],
  'Other': [{ uid: 1, key: ['o'], content: 'Other-content', comment: '', disable: false }],
};
const loadBookByName = jest.fn(async (name: string) => (books[name] ? { name, entries: books[name] } : null));

describe('world info allowlist builder', () => {
  beforeEach(() => loadBookByName.mockClear());

  test('an always row is loaded and injected; disabled entries and book headers are omitted', async () => {
    const text = await buildAllowlistedWorldInfoText({
      rows: [{ book: 'The Bar', activeVia: [], entryIds: [] }],
      sources: sources(),
      loadBookByName,
    });

    expect(text).toContain('Bar-content');
    expect(text).not.toContain('Disabled');
    expect(text).not.toContain('# The Bar');
  });

  test('an unsatisfied scoped row is skipped without loading its book; a satisfied one is injected', async () => {
    const text = await buildAllowlistedWorldInfoText({
      rows: [
        { book: 'The Bar', activeVia: ['card'], entryIds: [] },
        { book: 'Other', activeVia: ['global'], entryIds: [] },
      ],
      sources: sources([], ['other']),
      loadBookByName,
    });

    expect(text).toBe('Other-content');
    expect(loadBookByName).toHaveBeenCalledTimes(1);
    expect(loadBookByName).toHaveBeenCalledWith('Other');
  });

  test('applies the per-row entry subset', async () => {
    const text = await buildAllowlistedWorldInfoText({
      rows: [{ book: 'The Bar', activeVia: ['card'], entryIds: [12] }],
      sources: sources(['the bar']),
      loadBookByName,
    });

    expect(text).toBe('Bar-second');
  });

  test('returns empty text when every row is skipped or the book cannot be loaded', async () => {
    expect(
      await buildAllowlistedWorldInfoText({
        rows: [{ book: 'The Bar', activeVia: ['card'], entryIds: [] }],
        sources: sources(),
        loadBookByName,
      }),
    ).toBe('');
    expect(
      await buildAllowlistedWorldInfoText({
        rows: [{ book: 'Missing', activeVia: [], entryIds: [] }],
        sources: sources(),
        loadBookByName,
      }),
    ).toBe('');
  });
});
