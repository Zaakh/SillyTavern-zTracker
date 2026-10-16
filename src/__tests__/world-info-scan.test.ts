import { describe, expect, jest, test, beforeEach } from '@jest/globals';
import { buildWorldInfoScanChat, buildWorldInfoScanData, scanWorldInfo, type WorldInfoScanHost } from '../world-info-scan.js';

const EVENT = 'worldinfo_entries_loaded';

/** Fake host: emits the entries-loaded payload to listeners, then returns `result` for the scan. */
function createHost(overrides: Partial<WorldInfoScanHost> & { result?: any; onScan?: (args: any[]) => void } = {}) {
  const listeners = new Set<(payload: any) => void>();
  const payload = { globalLore: [{ uid: 1, world: 'Host' }], characterLore: [{ uid: 2 }], chatLore: [], personaLore: [] };
  const calls: any[][] = [];
  const host: WorldInfoScanHost = {
    getWorldInfoPrompt: jest.fn(async (...args: any[]) => {
      calls.push(args);
      overrides.onScan?.(args);
      listeners.forEach((l) => l(payload));
      return overrides.result ?? { worldInfoBefore: 'before', worldInfoAfter: 'after' };
    }) as any,
    eventSource: { on: (_e, cb) => listeners.add(cb), removeListener: (_e, cb) => listeners.delete(cb) },
    eventTypes: { WORLDINFO_ENTRIES_LOADED: EVENT },
    isGenerating: overrides.isGenerating,
  };
  return { host, listeners, payload, calls };
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
    const text = await scanWorldInfo({ host, ...base });
    expect(calls[0][2]).toBe(true);
    expect(text).toBe('before\nafter\ndepth\noutlet\nan-top\nan-bottom');
  });

  test('unfiltered scan registers no listener', async () => {
    const { host } = createHost({ onScan: () => undefined });
    const spy = jest.spyOn(host.eventSource!, 'on');
    await scanWorldInfo({ host, ...base });
    expect(spy).not.toHaveBeenCalled();
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
    expect(await scanWorldInfo({ host: boom.host, ...base, restrictTo: [] })).toBe('');
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
    expect(await scanWorldInfo({ host: good.host, ...base })).toBe('before\nafter');
  });

  test('missing scan API or event warns once per host and returns empty', async () => {
    const host: WorldInfoScanHost = {};
    expect(await scanWorldInfo({ host, ...base })).toBe('');
    expect(await scanWorldInfo({ host, ...base })).toBe('');
    expect(console.warn).toHaveBeenCalledTimes(1);

    const noEvent = createHost().host;
    noEvent.eventTypes = {};
    const getWorldInfoPrompt = noEvent.getWorldInfoPrompt as jest.Mock;
    expect(await scanWorldInfo({ host: noEvent, ...base, restrictTo: [] })).toBe('');
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

  test('unfiltered scan does not wait for host generation', async () => {
    const { host, calls } = createHost({ isGenerating: () => true });
    await scanWorldInfo({ host, ...base, idleTimeoutMs: 20 });
    expect(calls).toHaveLength(1);
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
