import { describe, it, expect } from '@jest/globals';
import { listStoredSnapshots, resolvePreviewSnapshot } from '../snapshot-preview-source.js';
import { EXTENSION_KEY } from '../extension-metadata.js';

const msg = (mes: string, value?: unknown, extraZ: Record<string, unknown> = {}) => ({
  name: 'Ann',
  mes,
  extra: { [EXTENSION_KEY]: { ...(value ? { byId: { default: { value } } } : {}), ...extraZ } },
});

describe('snapshot preview source', () => {
  const schema = { type: 'object', properties: { mood: { type: 'string' } } };

  it('defaults to the newest stored snapshot and lists all of them', () => {
    const chat = [msg('one', { a: 1 }), msg('plain'), msg('three', { a: 3 })];
    const entries = listStoredSnapshots(chat, 'default');
    expect(entries.map((e) => e.index)).toEqual([0, 2]);
    expect(resolvePreviewSnapshot(entries, undefined, schema)).toEqual({ kind: 'stored', index: 2, value: { a: 3 } });
  });

  it('uses the picked message, falling back to newest when the pick is gone', () => {
    const entries = listStoredSnapshots([msg('one', { a: 1 }), msg('two', { a: 2 })], 'default');
    expect(resolvePreviewSnapshot(entries, 0, schema)).toMatchObject({ index: 0, value: { a: 1 } });
    expect(resolvePreviewSnapshot(entries, 9, schema)).toMatchObject({ index: 1 });
  });

  it('truncates the snippet and ignores other Modules', () => {
    const [entry] = listStoredSnapshots([msg('x'.repeat(100), { a: 1 })], 'default');
    expect(entry.snippet.length).toBeLessThan(100);
    expect(listStoredSnapshots([msg('one', { a: 1 })], 'other')).toEqual([]);
  });

  it('falls back to a schema example with no snapshot or no chat', () => {
    expect(resolvePreviewSnapshot(listStoredSnapshots([msg('plain')], 'default'), undefined, schema)).toEqual({
      kind: 'example',
      value: { mood: 'string' },
    });
    expect(listStoredSnapshots(undefined, 'default')).toEqual([]);
    expect(resolvePreviewSnapshot([], undefined, schema)).toMatchObject({ kind: 'example' });
  });

  it('leaves a legacy-format message unmodified and unlisted', () => {
    const legacy = msg('old', undefined, { value: { a: 1 }, html: '<p/>' });
    const before = JSON.stringify(legacy);
    expect(listStoredSnapshots([legacy], 'default')).toEqual([]);
    expect(JSON.stringify(legacy)).toBe(before);
  });

  it('reports none when the schema cannot produce an example', () => {
    expect(resolvePreviewSnapshot([], undefined, undefined)).toEqual({ kind: 'none' });
  });
});
