/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import { checkWorldInfoEntry, openWorldInfoEntry, type OpenEntryHost } from '../world-info-open-entry.js';

/** Fake editor: a paged entry list that is re-rendered on reload and on "next". */
function setup(options: { names?: string[]; entries?: number[]; perPage?: number; editorLoads?: boolean; drawerOpen?: boolean } = {}) {
  const { names = ['Lore'], entries = [1, 2, 3], perPage = 2, editorLoads = true, drawerOpen = false } = options;
  document.body.innerHTML = `
    <div id="WIDrawerIcon"></div>
    <div id="WorldInfo" class="${drawerOpen ? '' : 'closedDrawer'}"></div>
    <div id="world_info_pagination"><span class="J-paginationjs-next"></span></div>
    <div id="world_popup_entries_list"></div>`;
  const list = document.querySelector('#world_popup_entries_list')!;
  const next = document.querySelector('.J-paginationjs-next') as HTMLElement;
  let page = 0;
  const render = () => {
    const slice = entries.slice(page * perPage, (page + 1) * perPage);
    list.innerHTML = slice.map((uid) => `<div class="world_entry" uid="${uid}"><span class="inline-drawer-icon down"></span></div>`).join('');
    next.classList.toggle('disabled', (page + 1) * perPage >= entries.length);
  };
  next.addEventListener('click', () => {
    page++;
    render();
  });
  document.querySelector('#WIDrawerIcon')!.addEventListener('click', () => document.querySelector('#WorldInfo')!.classList.remove('closedDrawer'));
  Element.prototype.scrollIntoView = jest.fn();

  const reload = jest.fn((_file: string) => {
    if (!editorLoads) return;
    page = 0;
    render();
  });
  const host: OpenEntryHost = {
    getWorldInfoNames: () => names,
    loadWorldInfo: async () => ({ entries: Object.fromEntries(entries.map((uid) => [String(uid), {}])) }),
    reloadWorldInfoEditor: reload,
    doc: document,
    intervalMs: 5,
    timeoutMs: 40,
  };
  return { host, reload };
}

const flashed = () => document.querySelector('.ztracker-wi-entry-flash');

describe('openWorldInfoEntry', () => {
  test('opens the drawer and book, expands, scrolls to and highlights an entry on page 1', async () => {
    const { host, reload } = setup();

    const result = await openWorldInfoEntry(host, { book: 'Lore', uid: 1 });

    expect(result).toEqual({ ok: true, book: 'Lore' });
    expect(reload).toHaveBeenCalledWith('Lore', true);
    expect(document.querySelector('#WorldInfo')!.classList.contains('closedDrawer')).toBe(false);
    expect(flashed()?.getAttribute('uid')).toBe('1');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  test('does not click the drawer icon when the drawer is already open', async () => {
    const { host } = setup({ drawerOpen: true });
    const icon = document.querySelector('#WIDrawerIcon') as HTMLElement;
    const click = jest.fn();
    icon.addEventListener('click', click);

    await openWorldInfoEntry(host, { book: 'Lore', uid: 1 });

    expect(click).not.toHaveBeenCalled();
  });

  test('pages forward to an entry on a later page', async () => {
    const { host } = setup({ entries: [1, 2, 3, 4, 5], perPage: 2 });

    const result = await openWorldInfoEntry(host, { book: 'Lore', uid: 5 });

    expect(result.ok).toBe(true);
    expect(flashed()?.getAttribute('uid')).toBe('5');
  });

  test('a missing book fails before anything changes', async () => {
    const { host, reload } = setup();

    const result = await openWorldInfoEntry(host, { book: 'Gone', uid: 1 });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('"Gone" no longer exists') });
    expect(reload).not.toHaveBeenCalled();
    expect(document.querySelector('#WorldInfo')!.classList.contains('closedDrawer')).toBe(true);
  });

  test('a deleted entry fails before anything changes', async () => {
    const { host, reload } = setup();

    const result = await openWorldInfoEntry(host, { book: 'Lore', uid: 99 });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('#99 no longer exists') });
    expect(reload).not.toHaveBeenCalled();
  });

  test('an editor that never loads times out with the book left open', async () => {
    const { host, reload } = setup({ editorLoads: false });

    const result = await openWorldInfoEntry(host, { book: 'Lore', uid: 1 });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('could not be located') });
    expect(reload).toHaveBeenCalledWith('Lore', true);
  });

  test('a second click is ignored while one is running', async () => {
    const { host, reload } = setup();

    const [first, second] = await Promise.all([
      openWorldInfoEntry(host, { book: 'Lore', uid: 1 }),
      openWorldInfoEntry(host, { book: 'Lore', uid: 2 }),
    ]);

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, error: expect.stringContaining('still opening') });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('ignores an entry with the same uid left over from the previously shown book', async () => {
    const { host } = setup();
    document.querySelector('#world_popup_entries_list')!.innerHTML = '<div class="world_entry" uid="1" id="stale"></div>';

    await openWorldInfoEntry(host, { book: 'Lore', uid: 1 });

    expect(document.querySelector('#stale')).toBeNull();
    expect(flashed()?.id).toBe('');
  });
});

describe('host failures', () => {
  test('a throwing host function comes back as a failed result, never an exception', async () => {
    const { host } = setup();
    host.getWorldInfoNames = () => {
      throw new Error('boom');
    };

    await expect(openWorldInfoEntry(host, { book: 'Lore', uid: 1 })).resolves.toMatchObject({ ok: false, error: expect.stringContaining('boom') });
  });

  test('a throwing editor reload fails the open but frees the single-flight guard', async () => {
    const { host } = setup();
    const reload = host.reloadWorldInfoEditor;
    host.reloadWorldInfoEditor = () => {
      throw new Error('no editor');
    };

    await expect(openWorldInfoEntry(host, { book: 'Lore', uid: 1 })).resolves.toMatchObject({ ok: false, error: expect.stringContaining('no editor') });

    host.reloadWorldInfoEditor = reload;
    await expect(openWorldInfoEntry(host, { book: 'Lore', uid: 1 })).resolves.toMatchObject({ ok: true });
  });
});

describe('shortened book names', () => {
  const long = 'A'.repeat(100);
  const stored = `${long}…`;
  const check = (names: string[]) => checkWorldInfoEntry({ getWorldInfoNames: () => names, loadWorldInfo: async () => ({ entries: { '1': {} } }) }, { book: stored, uid: 1 });

  test('one prefix match opens that book', async () => {
    expect(await check([`${long}-full-name`, 'Other'])).toEqual({ ok: true, book: `${long}-full-name` });
  });

  test('no match warns that the name may have been shortened', async () => {
    expect(await check(['Other'])).toMatchObject({ ok: false, error: expect.stringContaining('shortened') });
  });

  test('several matches warn instead of guessing', async () => {
    expect(await check([`${long}1`, `${long}2`])).toMatchObject({ ok: false, error: expect.stringContaining('shortened') });
  });

  test('a short name that ends with an ellipsis is not treated as shortened', async () => {
    const result = await checkWorldInfoEntry(
      { getWorldInfoNames: () => ['Wait…more'], loadWorldInfo: async () => ({ entries: { '1': {} } }) },
      { book: 'Wait…', uid: 1 },
    );
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('no longer exists') });
  });
});
