import { jest } from '@jest/globals';
import { TrackerWorldInfoPolicyMode } from '../config.js';
import { buildAllowlistedWorldInfoText, buildTrackerWorldInfoText } from '../world-info-allowlist.js';

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
      rows: [{ book: 'The Bar', activeVia: [], entryIds: [], trigger: 'always' }],
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
        { book: 'The Bar', activeVia: ['card'], entryIds: [], trigger: 'always' },
        { book: 'Other', activeVia: ['global'], entryIds: [], trigger: 'always' },
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
      rows: [{ book: 'The Bar', activeVia: ['card'], entryIds: [12], trigger: 'always' }],
      sources: sources(['the bar']),
      loadBookByName,
    });

    expect(text).toBe('Bar-second');
  });

  test('returns empty text when every row is skipped or the book cannot be loaded', async () => {
    expect(
      await buildAllowlistedWorldInfoText({
        rows: [{ book: 'The Bar', activeVia: ['card'], entryIds: [], trigger: 'always' }],
        sources: sources(),
        loadBookByName,
      }),
    ).toBe('');
    expect(
      await buildAllowlistedWorldInfoText({
        rows: [{ book: 'Missing', activeVia: [], entryIds: [], trigger: 'always' }],
        sources: sources(),
        loadBookByName,
      }),
    ).toBe('');
  });
});

describe('buildTrackerWorldInfoText', () => {
  const row = (book: string, trigger: 'engine' | 'always', extra: Record<string, unknown> = {}) => ({
    book,
    activeVia: [] as any[],
    entryIds: [] as number[],
    trigger,
    ...extra,
  });
  const make = (mode: TrackerWorldInfoPolicyMode, rows: any[], scanText = 'scanned') => {
    const scan = jest.fn(async (_restrictTo?: unknown) => scanText);
    const resolveSources = jest.fn(async () => sources());
    return {
      scan,
      resolveSources,
      run: () =>
        buildTrackerWorldInfoText({
          mode,
          rows,
          resolveSources,
          loadBookByName,
          loadFullEntries: async (name) => [{ uid: 1, content: name }],
          scan,
          wrapIncludeAll: (text) => `<wi>${text}</wi>`,
        }),
    };
  };

  test('exclude-all does nothing', async () => {
    const t = make(TrackerWorldInfoPolicyMode.EXCLUDE_ALL, [row('The Bar', 'always')]);
    expect(await t.run()).toBe('');
    expect(t.scan).not.toHaveBeenCalled();
    expect(t.resolveSources).not.toHaveBeenCalled();
  });

  test('include-all scans unfiltered and wraps the result; empty scan stays empty (not wrapped)', async () => {
    const t = make(TrackerWorldInfoPolicyMode.INCLUDE_ALL, []);
    expect(await t.run()).toBe('<wi>scanned</wi>');
    expect(t.scan).toHaveBeenCalledWith();
    expect(await make(TrackerWorldInfoPolicyMode.INCLUDE_ALL, [], '').run()).toBe('');
  });

  test('allowlist with no rows returns empty without scanning', async () => {
    const t = make(TrackerWorldInfoPolicyMode.ALLOWLIST, []);
    expect(await t.run()).toBe('');
    expect(t.scan).not.toHaveBeenCalled();
  });

  test('engine rows are scanned (raw, restricted to their books); always rows come first', async () => {
    const t = make(TrackerWorldInfoPolicyMode.ALLOWLIST, [row('Other', 'engine', { entryIds: [1] }), row('The Bar', 'always', { entryIds: [10] })]);
    expect(await t.run()).toBe('Bar-content\n\nscanned');
    expect(t.scan).toHaveBeenCalledWith([{ book: 'Other', entries: [{ uid: 1, content: 'Other' }], entryIds: [1] }]);
  });

  test('scope-skipped engine rows are not loaded or scanned', async () => {
    const t = make(TrackerWorldInfoPolicyMode.ALLOWLIST, [row('Other', 'engine', { activeVia: ['card'] })]);
    expect(await t.run()).toBe('');
    expect(t.scan).not.toHaveBeenCalled();
  });
});
