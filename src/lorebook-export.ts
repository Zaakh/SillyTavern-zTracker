// Copies a tracker snapshot into a World Info lorebook entry (export as new / replace the linked
// entry) and defines the title/keys suggestion actions. Every host call goes through an injected
// `LorebookHost` so Jest can stub it; `createLorebookHost` wires the real SillyTavern functions.
import { formatEmbeddedTrackerSnapshot } from './embed-snapshot-transform.js';
import type { TrackerModuleSettings } from './config.js';
import type { LlmAction } from './llm-actions.js';
import { loadWorldInfoBookByName } from './sillytavern-world-info.js';

/** Where a message's tracker was last exported; stored on the Module's tracker record. */
export interface LorebookLink {
  book: string;
  uid: number;
  title: string;
}

export const LOREBOOK_LINK_KEY = 'lorebookLink';

type HostBook = { entries: Record<string, any> };

export interface LorebookHost {
  getWorldInfoNames(): string[];
  /** Host (cached) copy of a book; mutated and passed back to `saveWorldInfo`. */
  loadWorldInfo(name: string): Promise<HostBook | null>;
  saveWorldInfo(name: string, data: HostBook, immediately: boolean): Promise<void>;
  /** Uncached read straight from the server, used to confirm a save really persisted. */
  readBook(name: string): Promise<{ entries: Array<{ uid: number; content: string }> } | null>;
  reloadWorldInfoEditor(file: string, loadIfNotSelected?: boolean): void;
  /** Host factory for a complete new entry; absent when `/scripts/world-info.js` cannot be imported. */
  createWorldInfoEntry?(name: string, data: HostBook): any;
}

type SnapshotSettings = Pick<
  TrackerModuleSettings,
  'embedZTrackerSnapshotTransformPreset' | 'embedZTrackerSnapshotTransformPresets'
>;

export type LorebookResult =
  | { ok: true; link: LorebookLink; warnings: string[] }
  | { ok: false; error: string; missing?: 'book' | 'entry' };

/** Builds the real host from `SillyTavern.getContext()`; the entry factory is optional (see fallback). */
export async function createLorebookHost(context: any): Promise<LorebookHost> {
  let createWorldInfoEntry: LorebookHost['createWorldInfoEntry'];
  try {
    const worldInfo = await import(/* webpackIgnore: true */ '/scripts/world-info.js' as string);
    if (typeof worldInfo.createWorldInfoEntry === 'function') createWorldInfoEntry = worldInfo.createWorldInfoEntry;
  } catch {
    // Falls back to cloning a sibling entry.
  }
  return {
    getWorldInfoNames: () => context.getWorldInfoNames(),
    loadWorldInfo: (name) => context.loadWorldInfo(name),
    saveWorldInfo: (name, data, immediately) => context.saveWorldInfo(name, data, immediately),
    readBook: (name) => loadWorldInfoBookByName(name),
    reloadWorldInfoEditor: (file, loadIfNotSelected) => context.reloadWorldInfoEditor(file, loadIfNotSelected),
    createWorldInfoEntry,
  };
}

export function getLorebookLink(record: Record<string, any> | undefined): LorebookLink | undefined {
  const link = record?.[LOREBOOK_LINK_KEY];
  return link && typeof link.book === 'string' && Number.isFinite(link.uid) && typeof link.title === 'string'
    ? (link as LorebookLink)
    : undefined;
}

/** Snapshot text as chat injection would embed it, always unfenced. */
function formatEntryContent(trackerValue: unknown, settings: SnapshotSettings, title: string): string {
  return formatEmbeddedTrackerSnapshot(trackerValue, settings, { title }).text.trim();
}

/** A new entry with every host-defined field: the host factory, else a clone of a sibling entry. */
function buildNewEntry(host: LorebookHost, book: string, data: HostBook): any | null {
  data.entries ??= {};
  const created = host.createWorldInfoEntry?.(book, data);
  if (created && typeof created === 'object') {
    data.entries[created.uid] ??= created;
    return created;
  }
  const sibling = Object.values(data.entries)[0];
  if (!sibling) return null;
  const uid = Math.max(-1, ...Object.keys(data.entries).map(Number).filter(Number.isFinite)) + 1;
  // Keep the sibling's field set but not its behavior: a disabled or constant neighbor must not leak.
  const entry = { ...structuredClone(sibling), uid, content: '', disable: false, constant: false, keysecondary: [], group: '' };
  data.entries[uid] = entry;
  return entry;
}

/** Saves, then re-reads the book: the host never checks the save's HTTP status. */
async function saveAndConfirm(host: LorebookHost, book: string, data: HostBook, uid: number, content: string): Promise<boolean> {
  try {
    await host.saveWorldInfo(book, data, true);
    const saved = await host.readBook(book);
    return !!saved?.entries.some((entry) => entry.uid === uid && entry.content === content);
  } catch {
    return false;
  }
}

const NOT_SAVED = 'The lorebook could not be saved, or the saved entry could not be confirmed.';

/**
 * Creates a new entry in `book` and, only after the save is confirmed, stores the link on `record`.
 * Never touches an existing entry. Empty `keys` succeed with a `no-keys` warning.
 */
export async function exportTrackerToLorebook(
  host: LorebookHost,
  args: {
    book: string;
    title: string;
    keys: string[];
    trackerValue: unknown;
    settings: SnapshotSettings;
    record: Record<string, any>;
  },
): Promise<LorebookResult> {
  const { book, title, keys, record } = args;
  const books = host.getWorldInfoNames();
  if (books.length === 0) return { ok: false, error: 'Create a lorebook first.' };
  if (!books.includes(book)) return { ok: false, error: `Lorebook "${book}" does not exist.`, missing: 'book' };
  const data = await host.loadWorldInfo(book);
  if (!data) return { ok: false, error: `Lorebook "${book}" could not be loaded.`, missing: 'book' };

  const content = formatEntryContent(args.trackerValue, args.settings, title);
  const entry = buildNewEntry(host, book, data);
  if (!entry) {
    return { ok: false, error: `Could not create a complete entry: "${book}" has no entry to copy the defaults from and the host factory is unavailable.` };
  }
  entry.comment = title;
  entry.key = keys;
  entry.content = content;

  if (!(await saveAndConfirm(host, book, data, entry.uid, content))) return { ok: false, error: NOT_SAVED };

  const link: LorebookLink = { book, uid: entry.uid, title };
  record[LOREBOOK_LINK_KEY] = link;
  host.reloadWorldInfoEditor(book);
  return { ok: true, link, warnings: keys.length === 0 ? ['no-keys'] : [] };
}

/**
 * Overwrites only `content` of the linked entry (keys, order, position, enabled state and a renamed
 * comment are left alone). Writes nothing and changes no link when the book or entry is gone.
 */
export async function replaceLinkedLorebookEntry(
  host: LorebookHost,
  args: { link: LorebookLink; trackerValue: unknown; settings: SnapshotSettings },
): Promise<LorebookResult> {
  const { link } = args;
  if (!host.getWorldInfoNames().includes(link.book)) {
    return { ok: false, error: `Lorebook "${link.book}" no longer exists.`, missing: 'book' };
  }
  const data = await host.loadWorldInfo(link.book);
  const entry = data?.entries?.[link.uid];
  if (!data || !entry) {
    return { ok: false, error: `Entry "${link.title}" no longer exists in "${link.book}".`, missing: 'entry' };
  }

  const content = formatEntryContent(args.trackerValue, args.settings, link.title);
  entry.content = content;
  if (!(await saveAndConfirm(host, link.book, data, link.uid, content))) return { ok: false, error: NOT_SAVED };

  host.reloadWorldInfoEditor(link.book);
  return { ok: true, link, warnings: [] };
}

const TITLE_MAX_LENGTH = 60;
const KEYS_MAX_COUNT = 8;
const QUOTES = /^["'“”‘’`]+|["'“”‘’`]+$/g;

/** One short unquoted line; throws on an empty reply. */
export function parseTitle(reply: string): string {
  const firstLine = String(reply ?? '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
  const title = firstLine.replace(QUOTES, '').replace(/\.$/, '').trim().slice(0, TITLE_MAX_LENGTH);
  if (!title) throw new Error('The connection returned no title.');
  return title;
}

/** Splits on commas and newlines, strips bullets and quotes, dedupes case-insensitively, caps the count. */
export function parseKeys(reply: string): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const part of String(reply ?? '').split(/[,\n]/)) {
    const key = part.replace(/^\s*(?:[-*•]\s*|\d+[.)]\s+)/, '').trim().replace(QUOTES, '').trim();
    if (!key || seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    keys.push(key);
  }
  if (keys.length === 0) throw new Error('The connection returned no usable keys.');
  return keys.slice(0, KEYS_MAX_COUNT);
}

export const LOREBOOK_TITLE_ACTION: LlmAction<{ snapshotText: string }, string> = {
  id: 'lorebook-title',
  defaultInstruction: 'Name the subject of the following text in 2 to 6 words. Reply with the title only: no quotes, no explanation.',
  buildMessages: (instruction, input) => [
    { role: 'system', content: instruction },
    { role: 'user', content: input.snapshotText },
  ],
  parse: parseTitle,
};

export const LOREBOOK_KEYS_ACTION: LlmAction<{ snapshotText: string; title: string }, string[]> = {
  id: 'lorebook-keys',
  defaultInstruction:
    "List 2 to 5 short words or phrases that a chat message would literally contain when this lorebook entry should be recalled, such as the subject's name and its variants. Skip generic words. Reply with the keys only, separated by commas.",
  buildMessages: (instruction, input) => [
    { role: 'system', content: instruction },
    { role: 'user', content: `${input.title.trim() ? `Entry title: ${input.title.trim()}\n\n` : ''}${input.snapshotText}` },
  ],
  parse: parseKeys,
};
