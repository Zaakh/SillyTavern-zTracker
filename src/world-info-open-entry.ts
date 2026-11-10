/**
 * Opens one World Info entry in SillyTavern's lorebook editor: `checkWorldInfoEntry` verifies book
 * and entry exist (nothing changes on failure), then `openWorldInfoEntry` opens the drawer, selects
 * the book, pages to the entry, expands, scrolls to and highlights it. The host exposes no "open
 * entry" API through `getContext()`, so the last steps use the editor DOM; every wait is bounded and
 * failures come back as `{ ok: false, error }`, never as exceptions. Host functions are injected so
 * Jest can fake them.
 */
import { WORLD_INFO_REPORT_TEXT_CAP } from './world-info-policy.js';

export interface OpenEntryHost {
  getWorldInfoNames(): string[];
  loadWorldInfo(name: string): Promise<{ entries: Record<string, unknown> } | null>;
  reloadWorldInfoEditor(file: string, loadIfNotSelected?: boolean): void;
  doc: Document;
  /** Polling delay and overall wait, overridable by tests. */
  intervalMs?: number;
  timeoutMs?: number;
}

export type OpenEntryResult = { ok: true; book: string } | { ok: false; error: string };

const FLASH_CLASS = 'ztracker-wi-entry-flash';
const FLASH_FALLBACK_MS = 3000;
const MAX_PAGES = 200;
let navigating = false;

/** Exact book match first; a stored name cut at the storage cap ("…") may match one book by prefix. */
function resolveBookName(names: string[], stored: string): string | { error: string } {
  if (names.includes(stored)) return stored;
  const wasCut = stored.length > WORLD_INFO_REPORT_TEXT_CAP && stored.endsWith('…');
  if (!wasCut) return { error: `World Info book "${stored}" no longer exists.` };
  const prefix = stored.slice(0, -1);
  const matches = names.filter((n) => n.startsWith(prefix));
  return matches.length === 1 ? matches[0] : { error: `World Info book "${stored}" was not found (its name may have been shortened).` };
}

/** Checks that the book and entry still exist; changes nothing. */
export async function checkWorldInfoEntry(
  host: Pick<OpenEntryHost, 'getWorldInfoNames' | 'loadWorldInfo'>,
  target: { book: string; uid: number },
): Promise<OpenEntryResult> {
  try {
    const book = resolveBookName(host.getWorldInfoNames(), target.book);
    if (typeof book !== 'string') return { ok: false, error: book.error };
    const data = await host.loadWorldInfo(book).catch(() => null);
    if (!data?.entries || !(String(target.uid) in data.entries)) {
      return { ok: false, error: `World Info entry #${target.uid} no longer exists in "${book}".` };
    }
    return { ok: true, book };
  } catch (error) {
    return { ok: false, error: `World Info could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(find: () => T | null | undefined, host: OpenEntryHost): Promise<T | null> {
  const interval = host.intervalMs ?? 100;
  for (let waited = 0; waited <= (host.timeoutMs ?? 3000); waited += interval) {
    const found = find();
    if (found) return found;
    await sleep(interval);
  }
  return null;
}

function isShown(node: Element | null): boolean {
  return !!node && (node as HTMLElement).style.display !== 'none' && !node.classList.contains('closedDrawer');
}

function highlight(entry: HTMLElement): void {
  entry.classList.add(FLASH_CLASS);
  const clear = () => entry.classList.remove(FLASH_CLASS);
  entry.addEventListener('animationend', clear, { once: true });
  setTimeout(clear, FLASH_FALLBACK_MS);
}

/** Pre-check, then drawer, book, page, expand, scroll, highlight. Never throws; a failure after the pre-check leaves the book open. */
export async function openWorldInfoEntry(host: OpenEntryHost, target: { book: string; uid: number }): Promise<OpenEntryResult> {
  if (navigating) return { ok: false, error: 'Another World Info entry is still opening.' };
  navigating = true;
  try {
    const checked = await checkWorldInfoEntry(host, target);
    if (!checked.ok) return checked;

    const { doc } = host;
    if (!isShown(doc.querySelector('#WorldInfo'))) (doc.querySelector('#WIDrawerIcon') as HTMLElement | null)?.click();
    // A reload or page change re-creates the entry elements, so only elements not seen before count as loaded.
    const rows = () => Array.from(doc.querySelectorAll<HTMLElement>('#world_popup_entries_list .world_entry'));
    let seen = new Set(rows());
    const loaded = () => {
      const fresh = rows().filter((e) => !seen.has(e));
      return fresh.length > 0 ? fresh : null;
    };
    host.reloadWorldInfoEditor(checked.book, true);

    let current = await waitFor(loaded, host);
    let entry = current?.find((e) => e.getAttribute('uid') === String(target.uid));
    for (let page = 0; current && !entry && page < MAX_PAGES; page++) {
      const next = doc.querySelector<HTMLElement>('#world_info_pagination .J-paginationjs-next:not(.disabled)');
      if (!next) break;
      seen = new Set(rows());
      next.click();
      current = await waitFor(loaded, host);
      entry = current?.find((e) => e.getAttribute('uid') === String(target.uid));
    }
    if (!entry) return { ok: false, error: `World Info entry #${target.uid} could not be located in the editor; "${checked.book}" is open.` };

    const icon = entry.querySelector<HTMLElement>('.inline-drawer-icon');
    if (icon?.classList.contains('down')) icon.click();
    entry.scrollIntoView?.({ block: 'center' });
    highlight(entry);
    return { ok: true, book: checked.book };
  } catch (error) {
    return { ok: false, error: `World Info editor could not be opened: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    navigating = false;
  }
}
