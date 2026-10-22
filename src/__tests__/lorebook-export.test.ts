import { describe, it, expect, jest } from '@jest/globals';
import {
  exportTrackerToLorebook,
  getLorebookLink,
  replaceLinkedLorebookEntry,
  LOREBOOK_KEYS_ACTION,
  LOREBOOK_TITLE_ACTION,
  parseKeys,
  parseTitle,
  type LorebookHost,
} from '../lorebook-export.js';
import { runLlmAction } from '../llm-actions.js';
import { applyTrackerUpdateAndRender, getTrackerModuleRecord } from '../tracker.js';
import { createDefaultEmbedSnapshotTransformPresets } from '../config.js';

const settings = {
  embedZTrackerSnapshotTransformPreset: 'flat',
  embedZTrackerSnapshotTransformPresets: createDefaultEmbedSnapshotTransformPresets(),
};
const trackerValue = { species: 'Elf', notes: '' };
const FLAT_BOB = '[Topic: Bob\nspecies: Elf\n]';

// Every field the stub "host" defines for a new entry, so completeness is checkable.
const hostEntry = (uid: number) => ({
  uid, key: [], keysecondary: [], comment: '', content: '', constant: false, vectorized: false, selective: true,
  selectiveLogic: 0, addMemo: true, order: 100, position: 0, disable: false, probability: 100, useProbability: true,
  depth: 4, group: '', scanDepth: null, caseSensitive: null, role: null,
});

function makeHost(overrides: Partial<LorebookHost> & { books?: Record<string, any>; persist?: boolean } = {}) {
  const { books: seededBooks, persist, ...hostOverrides } = overrides;
  const books: Record<string, any> = seededBooks ?? { Characters: { entries: {} } };
  const persisted: Record<string, any> = JSON.parse(JSON.stringify(books));
  const host: LorebookHost & { saves: number } = {
    saves: 0,
    getWorldInfoNames: () => Object.keys(books),
    loadWorldInfo: async (name) => books[name] ?? null,
    saveWorldInfo: async (name, data) => {
      host.saves += 1;
      if (persist !== false) persisted[name] = JSON.parse(JSON.stringify(data));
    },
    readBook: async (name) => (persisted[name] ? { entries: Object.values(persisted[name].entries) as any } : null),
    reloadWorldInfoEditor: jest.fn(),
    createWorldInfoEntry: (_name, data) => {
      const uid = Object.keys(data.entries).length;
      return (data.entries[uid] = hostEntry(uid));
    },
    ...hostOverrides,
  };
  return { host, books, persisted };
}

describe('exportTrackerToLorebook', () => {
  it('creates, saves and confirms a complete entry, stores the link and refreshes the editor', async () => {
    const { host, persisted } = makeHost();
    const record: Record<string, any> = {};

    const result = await exportTrackerToLorebook(host, { book: 'Characters', title: 'Bob', keys: ['Bob'], trackerValue, settings, record });

    expect(result).toEqual({ ok: true, link: { book: 'Characters', uid: 0, title: 'Bob' }, warnings: [] });
    const entry = persisted.Characters.entries[0];
    expect(entry).toMatchObject({ comment: 'Bob', key: ['Bob'], content: FLAT_BOB });
    expect(Object.keys(entry).sort()).toEqual(Object.keys(hostEntry(0)).sort());
    expect(record.lorebookLink).toEqual({ book: 'Characters', uid: 0, title: 'Bob' });
    expect(host.reloadWorldInfoEditor).toHaveBeenCalledWith('Characters');
  });

  it('exporting again adds a second entry and repoints the link without touching the first', async () => {
    const { host, persisted } = makeHost();
    const record: Record<string, any> = {};
    const args = { book: 'Characters', keys: ['Bob'], trackerValue, settings, record };
    await exportTrackerToLorebook(host, { ...args, title: 'Bob' });
    await exportTrackerToLorebook(host, { ...args, title: 'Bob 2' });

    expect(persisted.Characters.entries[0].comment).toBe('Bob');
    expect(persisted.Characters.entries[1].comment).toBe('Bob 2');
    expect(record.lorebookLink.uid).toBe(1);
  });

  it('warns about empty keys but still exports', async () => {
    const { host } = makeHost();
    const result = await exportTrackerToLorebook(host, { book: 'Characters', title: 'Bob', keys: [], trackerValue, settings, record: {} });
    expect(result).toMatchObject({ ok: true, warnings: ['no-keys'] });
  });

  it('clones a sibling entry when the host factory is unavailable', async () => {
    const books = { Characters: { entries: { 5: { ...hostEntry(5), order: 7, content: 'old' } } } };
    const { host, persisted } = makeHost({ books, createWorldInfoEntry: undefined });
    const result = await exportTrackerToLorebook(host, { book: 'Characters', title: 'Bob', keys: ['Bob'], trackerValue, settings, record: {} });

    expect(result).toMatchObject({ ok: true, link: { uid: 6 } });
    expect(persisted.Characters.entries[6]).toMatchObject({ order: 7, content: FLAT_BOB, comment: 'Bob' });
    expect(persisted.Characters.entries[5].content).toBe('old');
  });

  it('does not copy a disabled or constant neighbor behavior onto a cloned entry', async () => {
    const books = { Characters: { entries: { 0: { ...hostEntry(0), disable: true, constant: true, group: 'g', keysecondary: ['x'] } } } };
    const { host, persisted } = makeHost({ books, createWorldInfoEntry: undefined });
    await exportTrackerToLorebook(host, { book: 'Characters', title: 'Bob', keys: ['Bob'], trackerValue, settings, record: {} });
    expect(persisted.Characters.entries[1]).toMatchObject({ disable: false, constant: false, group: '', keysecondary: [] });
  });

  it('gives a cloned entry a valid uid even when a stored key is not numeric', async () => {
    const books = { Characters: { entries: { odd: { ...hostEntry(0) }, 3: hostEntry(3) } } };
    const { host } = makeHost({ books, createWorldInfoEntry: undefined });
    const result = await exportTrackerToLorebook(host, { book: 'Characters', title: 'Bob', keys: [], trackerValue, settings, record: {} });
    expect(result).toMatchObject({ ok: true, link: { uid: 4 } });
  });

  it('refuses when there is neither a factory nor a sibling to clone', async () => {
    const { host } = makeHost({ createWorldInfoEntry: undefined });
    const result = await exportTrackerToLorebook(host, { book: 'Characters', title: 'Bob', keys: [], trackerValue, settings, record: {} });
    expect(result.ok).toBe(false);
    expect(host.saves).toBe(0);
  });

  it('reports an error and stores no link when the save does not persist', async () => {
    const { host } = makeHost({ persist: false });
    const record: Record<string, any> = {};
    const result = await exportTrackerToLorebook(host, { book: 'Characters', title: 'Bob', keys: ['Bob'], trackerValue, settings, record });
    expect(result.ok).toBe(false);
    expect(record.lorebookLink).toBeUndefined();
    expect(host.reloadWorldInfoEditor).not.toHaveBeenCalled();
  });

  it('reports an error and stores no link when saving throws', async () => {
    const { host } = makeHost({ saveWorldInfo: async () => { throw new Error('disk'); } });
    const record: Record<string, any> = {};
    expect((await exportTrackerToLorebook(host, { book: 'Characters', title: 'Bob', keys: [], trackerValue, settings, record })).ok).toBe(false);
    expect(record.lorebookLink).toBeUndefined();
  });

  it('tells the user to create a lorebook first when none exist', async () => {
    const { host } = makeHost({ books: {} });
    const result = await exportTrackerToLorebook(host, { book: 'x', title: 'Bob', keys: [], trackerValue, settings, record: {} });
    expect(result).toEqual({ ok: false, error: 'Create a lorebook first.' });
    expect(host.saves).toBe(0);
  });
});

describe('replaceLinkedLorebookEntry', () => {
  const link = { book: 'Characters', uid: 0, title: 'Bob' };

  it('overwrites only content and keeps edited keys and order', async () => {
    const { host, persisted } = makeHost({
      books: { Characters: { entries: { 0: { ...hostEntry(0), comment: 'Bob', key: ['edited'], order: 9, content: 'old' } } } },
    });
    const result = await replaceLinkedLorebookEntry(host, { link, trackerValue, settings });

    expect(result.ok).toBe(true);
    expect(persisted.Characters.entries[0]).toMatchObject({ content: FLAT_BOB, key: ['edited'], order: 9, comment: 'Bob' });
  });

  it('keeps a comment the user renamed in the lorebook', async () => {
    const { host, persisted } = makeHost({
      books: { Characters: { entries: { 0: { ...hostEntry(0), comment: 'Renamed', content: 'old' } } } },
    });
    await replaceLinkedLorebookEntry(host, { link, trackerValue, settings });
    expect(persisted.Characters.entries[0].comment).toBe('Renamed');
  });

  it('never creates when the entry is gone', async () => {
    const { host } = makeHost();
    const result = await replaceLinkedLorebookEntry(host, { link, trackerValue, settings });
    expect(result).toMatchObject({ ok: false, missing: 'entry' });
    expect(host.saves).toBe(0);
  });

  it('never creates when the book is gone', async () => {
    const { host } = makeHost({ books: {} });
    const result = await replaceLinkedLorebookEntry(host, { link, trackerValue, settings });
    expect(result).toMatchObject({ ok: false, missing: 'book' });
    expect(host.saves).toBe(0);
  });

  it('reports an error when the save does not persist', async () => {
    const { host } = makeHost({ persist: false, books: { Characters: { entries: { 0: hostEntry(0) } } } });
    expect((await replaceLinkedLorebookEntry(host, { link, trackerValue, settings })).ok).toBe(false);
    expect(host.reloadWorldInfoEditor).not.toHaveBeenCalled();
  });

  it('does not send any request', async () => {
    const { host } = makeHost({ books: { Characters: { entries: { 0: hostEntry(0) } } } });
    expect(Object.keys(host)).not.toContain('generateRaw');
    await expect(replaceLinkedLorebookEntry(host, { link, trackerValue, settings })).resolves.toMatchObject({ ok: true });
  });
});

describe('parseTitle', () => {
  it('reduces a quoted multi-line reply to one unquoted line', () => {
    expect(parseTitle('\n"Bob the Elf."\nBecause he is an elf.')).toBe('Bob the Elf');
  });

  it('rejects an empty reply', () => {
    expect(() => parseTitle('  \n ')).toThrow();
  });
});

describe('parseKeys', () => {
  it('cleans a bulleted, quoted, repeated list', () => {
    expect(parseKeys('- "Bob"\n* bob\n1. The Builder\n• \'Bobby\', Bob')).toEqual(['Bob', 'The Builder', 'Bobby']);
  });

  it('strips a bullet that has no space after it', () => {
    expect(parseKeys('-Bob\n*Bobby')).toEqual(['Bob', 'Bobby']);
  });

  it('splits commas and caps the count', () => {
    expect(parseKeys('a, b, c, d, e, f, g, h, i, j')).toHaveLength(8);
  });

  it('rejects a reply with no usable key', () => {
    expect(() => parseKeys(' , \n - \n"" ')).toThrow();
  });
});

describe('lorebook suggestion actions', () => {
  it('title: sends the snapshot and the instruction, then parses', async () => {
    const request = jest.fn<any>(async () => '"Bob the Elf"');
    const title = await runLlmAction(LOREBOOK_TITLE_ACTION, { instruction: 'TITLE PROMPT', input: { snapshotText: 'snapshot' }, request });
    expect(title).toBe('Bob the Elf');
    expect(request.mock.calls[0][0]).toEqual([
      { role: 'system', content: 'TITLE PROMPT' },
      { role: 'user', content: 'snapshot' },
    ]);
  });

  it('keys: the title is part of the request', async () => {
    const request = jest.fn<any>(async () => 'Bob, Bobby');
    const keys = await runLlmAction(LOREBOOK_KEYS_ACTION, { instruction: 'KEYS PROMPT', input: { snapshotText: 'snapshot', title: 'Bob the Builder' }, request });
    expect(keys).toEqual(['Bob', 'Bobby']);
    expect((request.mock.calls[0] as any)[0][1].content).toContain('Bob the Builder');
  });

  it('keys: an empty title is still sent, without a title line', async () => {
    const request = jest.fn<any>(async () => 'Bob');
    await runLlmAction(LOREBOOK_KEYS_ACTION, { instruction: 'K', input: { snapshotText: 'snapshot', title: '  ' }, request });
    expect((request.mock.calls[0] as any)[0][1].content).toBe('snapshot');
  });

  it('propagates a rejected request', async () => {
    const request = jest.fn<any>(async () => { throw new Error('offline'); });
    await expect(runLlmAction(LOREBOOK_TITLE_ACTION, { instruction: '', input: { snapshotText: 's' }, request })).rejects.toThrow('offline');
  });
});

describe('lorebookLink storage', () => {
  it('survives a regeneration merge', () => {
    const message: { extra?: Record<string, any> } = {};
    getTrackerModuleRecord(message, 'scene', true)!.lorebookLink = { book: 'Characters', uid: 3, title: 'Bob' };

    applyTrackerUpdateAndRender(message, { moduleId: 'scene', trackerData: { a: 1 }, trackerHtml: '<p/>', render: () => {} });

    expect(getLorebookLink(getTrackerModuleRecord(message, 'scene'))).toEqual({ book: 'Characters', uid: 3, title: 'Bob' });
  });

  it('is absent when the record never had a link', () => {
    expect(getLorebookLink({})).toBeUndefined();
    expect(getLorebookLink(undefined)).toBeUndefined();
  });
});
