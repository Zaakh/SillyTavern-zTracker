import { describe, expect, jest, test, beforeEach } from '@jest/globals';
import {
  buildWorldInfoScanChat,
  buildWorldInfoScanData,
  inferWorldInfoReason,
  scanWorldInfo,
  type ScannedWorldInfoEntry,
  type WorldInfoScanHost,
} from '../world-info-scan.js';

const EVENT = 'worldinfo_entries_loaded';
const DONE_EVENT = 'worldinfo_scan_done';

/** Fake host: emits the entries-loaded payload to listeners, then returns `result` for the scan. */
function createHost(overrides: Partial<WorldInfoScanHost> & { result?: any; onScan?: (args: any[]) => void; doneEvents?: any[] } = {}) {
  const listeners = new Set<(payload: any) => void>();
  const payload = { globalLore: [{ uid: 1, world: 'Host' }], characterLore: [{ uid: 2 }], chatLore: [], personaLore: [] };
  const calls: any[][] = [];
  const doneListeners = new Set<(payload: any) => void>();
  const host: WorldInfoScanHost = {
    getWorldInfoPrompt: jest.fn(async (...args: any[]) => {
      calls.push(args);
      overrides.onScan?.(args);
      listeners.forEach((l) => l(payload));
      overrides.doneEvents?.forEach((e) => doneListeners.forEach((l) => l(e)));
      return overrides.result ?? { worldInfoBefore: 'before', worldInfoAfter: 'after' };
    }) as any,
    eventSource: {
      on: (e, cb) => (e === DONE_EVENT ? doneListeners : listeners).add(cb),
      removeListener: (e, cb) => (e === DONE_EVENT ? doneListeners : listeners).delete(cb),
    },
    eventTypes: { WORLDINFO_ENTRIES_LOADED: EVENT, WORLDINFO_SCAN_DONE: DONE_EVENT },
    isGenerating: overrides.isGenerating,
  };
  return { host, listeners, doneListeners, payload, calls };
}

const base = { chat: ['m1'], chatLength: 1, maxContext: 4096 };

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('scanWorldInfo', () => {
  test('always runs the host scan as a dry run and joins every result part in order', async () => {
    const { host, calls } = createHost({
      result: {
        worldInfoBefore: 'before',
        worldInfoAfter: ' after ',
        worldInfoDepth: [{ depth: 4, role: 0, entries: ['depth'] }],
        outletEntries: { a: ['outlet'] },
        anBefore: ['an-top'],
        anAfter: ['', 'an-bottom'],
      },
    });
    const { text } = await scanWorldInfo({ host, ...base });
    expect(calls[0][2]).toBe(true);
    expect(text).toBe('before\nafter\ndepth\noutlet\nan-top\nan-bottom');
  });

  test('unfiltered scan does not hook the entries-loaded event', async () => {
    const { host } = createHost({ onScan: () => undefined });
    const spy = jest.spyOn(host.eventSource!, 'on');
    await scanWorldInfo({ host, ...base });
    expect(spy).not.toHaveBeenCalledWith(EVENT, expect.anything());
  });

  test('restricted scan mutates the host arrays in place, applies the UID subset and tags the book', async () => {
    const { host, payload } = createHost();
    const globalLoreRef = payload.globalLore;
    await scanWorldInfo({
      host,
      ...base,
      restrictTo: [{ book: 'Lore', entries: [{ uid: 12, group: 'g', probability: 50 }, { uid: 13 }, { uid: 42 }], entryIds: [12, 42] }],
    });
    expect(payload.globalLore).toBe(globalLoreRef);
    expect(payload.globalLore).toEqual([
      { uid: 12, group: 'g', probability: 50, world: 'Lore' },
      { uid: 42, world: 'Lore' },
    ]);
    expect(payload.characterLore).toEqual([]);
  });

  test('removes the listener after success and after a throwing scan, returning empty text', async () => {
    const ok = createHost();
    await scanWorldInfo({ host: ok.host, ...base, restrictTo: [] });
    expect(ok.listeners.size).toBe(0);

    const boom = createHost({
      onScan: () => {
        throw new Error('boom');
      },
    });
    expect(await scanWorldInfo({ host: boom.host, ...base, restrictTo: [] })).toEqual({ text: '', entries: null, unavailable: true });
    expect(boom.listeners.size).toBe(0);
    expect(console.warn).toHaveBeenCalled();
  });

  test('serializes concurrent scans so they never overlap', async () => {
    let active = 0;
    let maxActive = 0;
    const { host } = createHost();
    host.getWorldInfoPrompt = jest.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { worldInfoBefore: 'x' };
    }) as any;
    await Promise.all([scanWorldInfo({ host, ...base }), scanWorldInfo({ host, ...base })]);
    expect(maxActive).toBe(1);
  });

  test('a failed scan does not block later scans', async () => {
    const bad = createHost({ onScan: () => { throw new Error('x'); } });
    await scanWorldInfo({ host: bad.host, ...base });
    const good = createHost();
    expect((await scanWorldInfo({ host: good.host, ...base })).text).toBe('before\nafter');
  });

  test('missing scan API or event warns once per host and returns empty', async () => {
    const host: WorldInfoScanHost = {};
    expect((await scanWorldInfo({ host, ...base })).text).toBe('');
    expect((await scanWorldInfo({ host, ...base })).text).toBe('');
    expect(console.warn).toHaveBeenCalledTimes(1);

    const noEvent = createHost().host;
    noEvent.eventTypes = {};
    const getWorldInfoPrompt = noEvent.getWorldInfoPrompt as jest.Mock;
    expect((await scanWorldInfo({ host: noEvent, ...base, restrictTo: [] })).text).toBe('');
    expect(getWorldInfoPrompt).not.toHaveBeenCalled();
  });

  test('pads the window to the real chat length with empty strings and passes scan data through', async () => {
    const { host, calls } = createHost();
    const scanData = { trigger: 'normal' } as any;
    await scanWorldInfo({ host, chat: ['newest', 'older'], chatLength: 40, maxContext: 100, scanData });
    const [chat, maxContext, , data] = calls[0];
    expect(chat).toHaveLength(40);
    expect(chat.slice(0, 2)).toEqual(['newest', 'older']);
    expect(chat.slice(2).every((m: string) => m === '')).toBe(true);
    expect(maxContext).toBe(100);
    expect(data).toBe(scanData);
  });

  test('a window longer than the chat length is not truncated', async () => {
    const { host, calls } = createHost();
    await scanWorldInfo({ host, chat: ['a', 'b', 'c'], chatLength: 1, maxContext: 1 });
    expect(calls[0][0]).toEqual(['a', 'b', 'c']);
  });

  test('restricted scan waits for the host to stop generating', async () => {
    let generating = true;
    const { host, calls } = createHost({ isGenerating: () => generating });
    setTimeout(() => (generating = false), 30);
    await scanWorldInfo({ host, ...base, restrictTo: [], idlePollMs: 5, idleTimeoutMs: 1000 });
    expect(calls).toHaveLength(1);
    expect(generating).toBe(false);
    expect(console.warn).not.toHaveBeenCalled();
  });

  test('restricted scan proceeds with a warning when the host never goes idle', async () => {
    const { host, calls } = createHost({ isGenerating: () => true });
    await scanWorldInfo({ host, ...base, restrictTo: [], idlePollMs: 5, idleTimeoutMs: 20 });
    expect(calls).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('still generating'));
  });

  test('include-all scan waits for the host to stop generating', async () => {
    let generating = true;
    const { host, calls } = createHost({ isGenerating: () => generating });
    setTimeout(() => (generating = false), 30);
    await scanWorldInfo({ host, ...base, idlePollMs: 5, idleTimeoutMs: 1000 });
    expect(calls).toHaveLength(1);
    expect(generating).toBe(false);
    expect(console.warn).not.toHaveBeenCalled();
  });

  test('include-all scan proceeds with a warning when the host never goes idle', async () => {
    const { host, calls } = createHost({ isGenerating: () => true });
    await scanWorldInfo({ host, ...base, idlePollMs: 5, idleTimeoutMs: 20 });
    expect(calls).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('still generating'));
  });
});

describe('scanWorldInfo entry capture', () => {
  const entry = (uid: number, extra: Record<string, any> = {}) => ({ world: 'Lore', uid, comment: ` t${uid} `, key: ['k'], ...extra });
  const doneEvent = (current: number, successful: any[], all: any[]) => ({
    state: { current },
    new: { successful },
    activated: { entries: new Map(all.map((e) => [`${e.world}.${e.uid}`, e])) },
  });

  test('returns the last cumulative entries with their first-activation loop', async () => {
    const a = entry(1);
    const b = entry(2, { constant: true });
    const { host } = createHost({ doneEvents: [doneEvent(1, [a], [a]), doneEvent(2, [b], [a, b])] });
    const result = await scanWorldInfo({ host, ...base });
    expect(result.text).toBe('before\nafter');
    expect(result.entries).toEqual([
      expect.objectContaining({ book: 'Lore', uid: 1, title: 't1', constant: false, loop: 'initial' }),
      expect.objectContaining({ book: 'Lore', uid: 2, constant: true, loop: 'recursion' }),
    ]);
  });

  test('removes the scan-done listener after success and after a throw', async () => {
    const ok = createHost();
    await scanWorldInfo({ host: ok.host, ...base });
    expect(ok.doneListeners.size).toBe(0);

    const boom = createHost({ onScan: () => { throw new Error('boom'); } });
    await scanWorldInfo({ host: boom.host, ...base });
    expect(boom.doneListeners.size).toBe(0);
  });

  test('malformed or missing payload gives entries null with the text still returned', async () => {
    const malformed = createHost({ doneEvents: [{ activated: { entries: [] } }, undefined] });
    expect(await scanWorldInfo({ host: malformed.host, ...base })).toEqual({ text: 'before\nafter', entries: null });

    const none = createHost();
    expect((await scanWorldInfo({ host: none.host, ...base })).entries).toBeNull();
  });

  test('no event and no text is an empty result, not a failure', async () => {
    const { host } = createHost({ result: {} });
    expect(await scanWorldInfo({ host, ...base })).toEqual({ text: '', entries: null });
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('inferWorldInfoReason', () => {
  const scanned = (extra: Partial<ScannedWorldInfoEntry> = {}): ScannedWorldInfoEntry => ({
    book: 'Lore', uid: 1, title: '', content: 'c', constant: false, key: [], keysecondary: [], selectiveLogic: 0, loop: 'initial', ...extra,
  });
  const chat = ['The Dragon sleeps', 'a wyrm appears'];

  test('lists every matched primary key, case-insensitively', () => {
    expect(inferWorldInfoReason(scanned({ key: ['dragon', 'WYRM', 'absent'] }), chat)).toEqual({ reason: 'keyword', matchedKeys: ['dragon', 'WYRM'] });
  });

  test('constant entries carry no keys', () => {
    expect(inferWorldInfoReason(scanned({ constant: true, key: ['dragon'] }), chat)).toEqual({ reason: 'constant' });
  });

  test('regex keys match', () => {
    expect(inferWorldInfoReason(scanned({ key: ['/dra.on/i'] }), chat)).toEqual({ reason: 'keyword', matchedKeys: ['/dra.on/i'] });
  });

  test('secondary keys count under AND logic but not under NOT logic', () => {
    const keys = { key: ['dragon'], keysecondary: ['wyrm'] };
    expect(inferWorldInfoReason(scanned({ ...keys, selectiveLogic: 0 }), chat).matchedKeys).toEqual(['dragon', 'wyrm']);
    expect(inferWorldInfoReason(scanned({ ...keys, selectiveLogic: 1 }), chat).matchedKeys).toEqual(['dragon']);
  });

  test('recursion and min-activations come from the first-activation loop', () => {
    expect(inferWorldInfoReason(scanned({ key: ['dragon'], loop: 'recursion' }), chat)).toEqual({ reason: 'recursion' });
    expect(inferWorldInfoReason(scanned({ loop: 'min-activations' }), chat)).toEqual({ reason: 'min-activations' });
  });

  test('an initial-loop entry with no key in the window is other', () => {
    expect(inferWorldInfoReason(scanned({ key: ['castle'] }), chat)).toEqual({ reason: 'other' });
  });
});

describe('scan input builders', () => {
  const chat = [
    { name: 'A', mes: 'm0' },
    { name: 'B', mes: 'm1', is_system: true },
    { name: 'A', mes: 'm2' },
    { name: 'B', mes: 'm3' },
    { name: 'A', mes: 'm4' },
  ];

  test('window is newest first, bounded by includeLastX, without system messages or later messages', () => {
    expect(buildWorldInfoScanChat(chat, 3, 2, false)).toEqual(['m3', 'm2']);
    expect(buildWorldInfoScanChat(chat, 3, 0, false)).toEqual(['m3', 'm2', 'm0']);
  });

  test('prefixes speaker names when the host setting is on', () => {
    expect(buildWorldInfoScanChat(chat, 2, 1, true)).toEqual(['A: m2']);
  });

  test('scan data carries persona and card fields with the normal trigger, empty when no card', () => {
    const data = buildWorldInfoScanData(
      { getCharacterCardFields: () => ({ persona: 'p', description: 'd', personality: 'x', charDepthPrompt: 'c', scenario: 's', creatorNotes: 'n' }) },
      3,
    );
    expect(data).toEqual({
      personaDescription: 'p',
      characterDescription: 'd',
      characterPersonality: 'x',
      characterDepthPrompt: 'c',
      scenario: 's',
      creatorNotes: 'n',
      trigger: 'normal',
    });
    expect(buildWorldInfoScanData({}, undefined).characterDescription).toBe('');
  });
});
