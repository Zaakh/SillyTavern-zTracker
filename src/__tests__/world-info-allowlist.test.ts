import { jest } from '@jest/globals';
import { TrackerWorldInfoPolicyMode } from '../config.js';
import { buildAllowlistedWorldInfoText, buildTrackerWorldInfo } from '../world-info-allowlist.js';
import { scanWorldInfo, type WorldInfoScanResult } from '../world-info-scan.js';

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
    const { text } = await buildAllowlistedWorldInfoText({
      rows: [{ book: 'The Bar', activeVia: [], entryIds: [], trigger: 'always' }],
      sources: sources(),
      loadBookByName,
    });

    expect(text).toContain('Bar-content');
    expect(text).not.toContain('Disabled');
    expect(text).not.toContain('# The Bar');
  });

  test('an unsatisfied scoped row is skipped without loading its book and reported; a satisfied one is injected', async () => {
    const { text, groups } = await buildAllowlistedWorldInfoText({
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
    expect(groups).toContainEqual({ book: 'The Bar', applied: [], skipped: [{ cause: 'scope' }] });
  });

  test('applies the per-row entry subset', async () => {
    const { text } = await buildAllowlistedWorldInfoText({
      rows: [{ book: 'The Bar', activeVia: ['card'], entryIds: [12], trigger: 'always' }],
      sources: sources(['the bar']),
      loadBookByName,
    });

    expect(text).toBe('Bar-second');
  });

  test('a book that loads with no entries (the host answers 200 for unknown names) is reported as missing', async () => {
    const empty = jest.fn(async (name: string) => ({ name, entries: [] }));
    const { text, groups } = await buildAllowlistedWorldInfoText({
      rows: [{ book: 'Ghost Book', activeVia: [], entryIds: [], trigger: 'always' }],
      sources: sources(),
      loadBookByName: empty,
    });
    expect(text).toBe('');
    expect(groups).toEqual([{ book: 'Ghost Book', applied: [], skipped: [{ cause: 'book-missing' }] }]);
  });

  test('returns empty text when every row is skipped or the book cannot be loaded, reporting why', async () => {
    const scoped = await buildAllowlistedWorldInfoText({
      rows: [{ book: 'The Bar', activeVia: ['card'], entryIds: [], trigger: 'always' }],
      sources: sources(),
      loadBookByName,
    });
    expect(scoped.text).toBe('');
    expect(scoped.groups).toEqual([{ book: 'The Bar', applied: [], skipped: [{ cause: 'scope' }] }]);

    const missing = await buildAllowlistedWorldInfoText({
      rows: [{ book: 'Missing', activeVia: [], entryIds: [], trigger: 'always' }],
      sources: sources(),
      loadBookByName,
    });
    expect(missing.text).toBe('');
    expect(missing.groups).toEqual([{ book: 'Missing', applied: [], skipped: [{ cause: 'book-missing' }] }]);
  });
});

describe('buildTrackerWorldInfo', () => {
  const row = (book: string, trigger: 'engine' | 'always', extra: Record<string, unknown> = {}) => ({
    book,
    activeVia: [] as any[],
    entryIds: [] as number[],
    trigger,
    ...extra,
  });
  const scanned = (extra: Record<string, unknown> = {}) => ({
    book: 'Lore',
    uid: 5,
    title: 'Dragon',
    content: 'scanned',
    constant: false,
    key: ['dragon'],
    keysecondary: [],
    selectiveLogic: 0,
    loop: 'initial' as const,
    ...extra,
  });
  const hit: WorldInfoScanResult = { text: 'scanned', entries: [scanned()] };

  const make = (mode: TrackerWorldInfoPolicyMode, rows: any[], result: WorldInfoScanResult = hit) => {
    const scan = jest.fn(async (_restrictTo?: unknown) => result);
    const resolveSources = jest.fn(async () => sources());
    return {
      scan,
      resolveSources,
      run: () =>
        buildTrackerWorldInfo({
          mode,
          rows,
          resolveSources,
          loadBookByName,
          loadFullEntries: async (name) => (name === 'Gone' ? null : [{ uid: 1, content: name }, { uid: 2, content: name, comment: 'Second' }]),
          scan,
          scannedChat: ['A dragon appears'],
          wrapIncludeAll: (text) => `<wi>${text}</wi>`,
        }),
    };
  };

  test('exclude-all does nothing and reports excluded', async () => {
    const t = make(TrackerWorldInfoPolicyMode.EXCLUDE_ALL, [row('The Bar', 'always')]);
    expect(await t.run()).toEqual({ text: '', report: { outcome: 'excluded', books: [] } });
    expect(t.scan).not.toHaveBeenCalled();
    expect(t.resolveSources).not.toHaveBeenCalled();
  });

  test('include-all scans unfiltered, wraps the text and reports the entries with an inferred reason', async () => {
    const t = make(TrackerWorldInfoPolicyMode.INCLUDE_ALL, []);
    const { text, report } = await t.run();
    expect(text).toBe('<wi>scanned</wi>');
    expect(t.scan).toHaveBeenCalledWith();
    expect(report).toEqual({
      outcome: 'applied',
      books: [{ book: 'Lore', applied: [{ uid: 5, title: 'Dragon', via: 'scan', reason: 'keyword', matchedKeys: ['dragon'] }], skipped: [] }],
    });
  });

  test('include-all with no text and no event is none-matched (no active lorebook)', async () => {
    const { text, report } = await make(TrackerWorldInfoPolicyMode.INCLUDE_ALL, [], { text: '', entries: null }).run();
    expect(text).toBe('');
    expect(report).toEqual({ outcome: 'none-matched', books: [] });
  });

  test('include-all with a scan that ran and activated nothing is none-matched', async () => {
    const { report } = await make(TrackerWorldInfoPolicyMode.INCLUDE_ALL, [], { text: '', entries: [] }).run();
    expect(report.outcome).toBe('none-matched');
  });

  test('include-all with text but no usable entry data is scan-unavailable with nothing applied', async () => {
    const { text, report } = await make(TrackerWorldInfoPolicyMode.INCLUDE_ALL, [], { text: 'scanned', entries: null }).run();
    expect(text).toBe('<wi>scanned</wi>');
    expect(report).toEqual({ outcome: 'scan-unavailable', books: [] });
  });

  test('a scan that could not run is scan-unavailable', async () => {
    const { report } = await make(TrackerWorldInfoPolicyMode.INCLUDE_ALL, [], { text: '', entries: null, unavailable: true }).run();
    expect(report.outcome).toBe('scan-unavailable');
  });

  test('scan entries with empty content are not applied', async () => {
    const { report } = await make(TrackerWorldInfoPolicyMode.INCLUDE_ALL, [], { text: 'x', entries: [scanned({ content: '  ' })] }).run();
    expect(report.outcome).toBe('none-matched');
  });

  test('allowlist with no rows returns empty without scanning', async () => {
    const t = make(TrackerWorldInfoPolicyMode.ALLOWLIST, []);
    expect(await t.run()).toEqual({ text: '', report: { outcome: 'none-matched', books: [] } });
    expect(t.scan).not.toHaveBeenCalled();
  });

  test('engine rows are scanned (raw, restricted to their books); always rows come first', async () => {
    const t = make(TrackerWorldInfoPolicyMode.ALLOWLIST, [row('Other', 'engine', { entryIds: [1] }), row('The Bar', 'always', { entryIds: [10] })]);
    const { text, report } = await t.run();
    expect(text).toBe('Bar-content\n\nscanned');
    expect(t.scan).toHaveBeenCalledWith([{ book: 'Other', entries: [{ uid: 1, content: 'Other' }, { uid: 2, content: 'Other', comment: 'Second' }], entryIds: [1] }]);
    expect(report.outcome).toBe('applied');
    const byBook = Object.fromEntries(report.books.map((b) => [b.book, b]));
    expect(byBook['The Bar'].applied).toEqual([{ uid: 10, title: 'bar', via: 'allowlist' }]);
    expect(byBook['The Bar'].skipped.map((s) => s.cause)).toEqual(['not-in-subset', 'not-in-subset']);
    expect(byBook['Lore'].applied[0]).toMatchObject({ via: 'scan', reason: 'keyword' });
    // Engine row: entries outside its subset are reported, host-decided ones are not.
    expect(byBook['Other'].skipped).toEqual([{ uid: 2, title: 'Second', cause: 'not-in-subset' }]);
  });

  test('an engine row whose book has no entries is reported as missing and not scanned', async () => {
    const t = make(TrackerWorldInfoPolicyMode.ALLOWLIST, [row('Empty', 'engine')]);
    const result = await buildTrackerWorldInfo({
      mode: TrackerWorldInfoPolicyMode.ALLOWLIST,
      rows: [row('Empty', 'engine')] as any,
      resolveSources: async () => sources(),
      loadBookByName,
      loadFullEntries: async () => [],
      scan: t.scan,
      scannedChat: [],
      wrapIncludeAll: (x) => x,
    });
    expect(t.scan).not.toHaveBeenCalled();
    expect(result.report.books).toEqual([{ book: 'Empty', applied: [], skipped: [{ cause: 'book-missing' }] }]);
  });

  test('real scan events flow through the builder into a report with exact loop reasons', async () => {
    const entry = (uid: number, extra: Record<string, unknown> = {}) => ({ world: 'Lore', uid, comment: `e${uid}`, content: `c${uid}`, key: ['dragon'], ...extra });
    const a = entry(1);
    const b = entry(2, { key: [] });
    const done = (current: number, successful: any[], all: any[]) => ({
      state: { current },
      new: { successful },
      activated: { entries: new Map(all.map((e) => [`${e.world}.${e.uid}`, e])) },
    });
    const listeners = new Set<(p: any) => void>();
    const host = {
      getWorldInfoPrompt: async () => {
        listeners.forEach((l) => l(done(1, [a], [a])));
        listeners.forEach((l) => l(done(2, [b], [a, b])));
        return { worldInfoBefore: 'c1\nc2' };
      },
      eventSource: { on: (_e: string, cb: any) => listeners.add(cb), removeListener: (_e: string, cb: any) => listeners.delete(cb) },
      eventTypes: { WORLDINFO_ENTRIES_LOADED: 'loaded', WORLDINFO_SCAN_DONE: 'done' },
    };
    const { text, report } = await buildTrackerWorldInfo({
      mode: TrackerWorldInfoPolicyMode.INCLUDE_ALL,
      rows: [],
      resolveSources: async () => sources(),
      loadBookByName,
      loadFullEntries: async () => null,
      scan: () => scanWorldInfo({ host, chat: ['a Dragon'], chatLength: 1, maxContext: 100 }),
      scannedChat: ['a Dragon'],
      wrapIncludeAll: (x) => x,
    });
    expect(text).toBe('c1\nc2');
    expect(report.books[0].applied).toEqual([
      { uid: 1, title: 'e1', via: 'scan', reason: 'keyword', matchedKeys: ['dragon'] },
      { uid: 2, title: 'e2', via: 'scan', reason: 'recursion' },
    ]);
    expect(listeners.size).toBe(0);
  });

  test('scope-skipped and missing engine rows are reported but never scanned', async () => {
    const t = make(TrackerWorldInfoPolicyMode.ALLOWLIST, [row('Other', 'engine', { activeVia: ['card'] }), row('Gone', 'engine')]);
    const { text, report } = await t.run();
    expect(text).toBe('');
    expect(t.scan).not.toHaveBeenCalled();
    expect(report).toEqual({
      outcome: 'none-matched',
      books: [
        { book: 'Other', applied: [], skipped: [{ cause: 'scope' }] },
        { book: 'Gone', applied: [], skipped: [{ cause: 'book-missing' }] },
      ],
    });
  });

  test('mixed allowlist with a data-less engine scan is scan-unavailable but still lists the always row', async () => {
    const t = make(
      TrackerWorldInfoPolicyMode.ALLOWLIST,
      [row('Other', 'engine'), row('The Bar', 'always', { entryIds: [10] })],
      { text: 'scanned', entries: null },
    );
    const { text, report } = await t.run();
    expect(text).toBe('Bar-content\n\nscanned');
    expect(report.outcome).toBe('scan-unavailable');
    expect(report.books.find((b) => b.book === 'The Bar')?.applied).toEqual([{ uid: 10, title: 'bar', via: 'allowlist' }]);
  });
});
