/**
 * World Info entry formatting for the allowlist "always" path, plus the shape of the stored
 * per-generation report (which entries reached the tracker prompt, and which allowed ones did not).
 * The report holds titles, uids, keys and causes only, never entry content.
 */
import type { WorldInfoReason } from './world-info-scan.js';

export interface WorldInfoEntry {
  uid: number;
  key: string[];
  content: string;
  comment?: string;
  disable: boolean;
  keysecondary?: string[];
}

export type WorldInfoSkipCause = 'scope' | 'book-missing' | 'disabled' | 'not-in-subset' | 'empty';

export interface WorldInfoReportEntry {
  uid: number;
  title: string;
  via: 'scan' | 'allowlist';
  reason?: WorldInfoReason;
  matchedKeys?: string[];
}

/** `uid` and `title` are absent for whole-row skips (scope, book missing). */
export interface WorldInfoSkippedEntry {
  uid?: number;
  title?: string;
  cause: WorldInfoSkipCause;
}

/** Uncapped entries of one book, as collected while building the text. */
export interface WorldInfoBookGroup {
  book: string;
  applied: WorldInfoReportEntry[];
  skipped: WorldInfoSkippedEntry[];
}

export interface TrackerWorldInfoReportBook extends WorldInfoBookGroup {
  moreApplied?: number;
  moreSkipped?: number;
}

export type TrackerWorldInfoOutcome = 'applied' | 'none-matched' | 'excluded' | 'scan-unavailable';

/** Stored under `message.extra.zTracker.byId[moduleId].worldInfo`. */
export interface TrackerWorldInfoReport {
  outcome: TrackerWorldInfoOutcome;
  books: TrackerWorldInfoReportBook[];
  moreBooks?: number;
}

/** Caps that keep the stored record small: the chat file is exported and shared. */
export const WORLD_INFO_REPORT_LIST_CAP = 50;
export const WORLD_INFO_REPORT_BOOK_CAP = 20;
export const WORLD_INFO_REPORT_MATCHED_KEYS_CAP = 10;
export const WORLD_INFO_REPORT_TEXT_CAP = 100;

/** Shortens user-authored text (titles, keys, book names) for storage. */
export function capReportText(text: string): string {
  return text.length > WORLD_INFO_REPORT_TEXT_CAP ? `${text.slice(0, WORLD_INFO_REPORT_TEXT_CAP)}…` : text;
}

export function normalizeWorldInfoName(name: string): string {
  return name.trim().toLowerCase();
}

/** Entry comment, else its first key, else the uid (capped for storage). */
export function worldInfoEntryTitle(entry: { uid: number; comment?: unknown; key?: unknown }): string {
  const comment = typeof entry.comment === 'string' ? entry.comment.trim() : '';
  if (comment) return capReportText(comment);
  const firstKey = Array.isArray(entry.key) ? entry.key.find((k): k is string => typeof k === 'string' && k.trim() !== '') : undefined;
  return capReportText(firstKey?.trim() ?? String(entry.uid));
}

/** Merges groups of the same book and caps each list and the book count, counting what was cut. Books with nothing to show are dropped. */
export function finalizeReportBooks(groups: WorldInfoBookGroup[]): { books: TrackerWorldInfoReportBook[]; moreBooks?: number } {
  const merged = new Map<string, WorldInfoBookGroup>();
  for (const group of groups) {
    const name = capReportText(group.book);
    const into = merged.get(name) ?? { book: name, applied: [], skipped: [] };
    into.applied.push(...group.applied);
    into.skipped.push(...group.skipped);
    merged.set(name, into);
  }

  const shown = [...merged.values()].filter((g) => g.applied.length > 0 || g.skipped.length > 0);
  const books = shown
    .slice(0, WORLD_INFO_REPORT_BOOK_CAP)
    .map((g) => {
      const book: TrackerWorldInfoReportBook = {
        book: g.book,
        applied: g.applied.slice(0, WORLD_INFO_REPORT_LIST_CAP),
        skipped: g.skipped.slice(0, WORLD_INFO_REPORT_LIST_CAP),
      };
      if (g.applied.length > WORLD_INFO_REPORT_LIST_CAP) book.moreApplied = g.applied.length - WORLD_INFO_REPORT_LIST_CAP;
      if (g.skipped.length > WORLD_INFO_REPORT_LIST_CAP) book.moreSkipped = g.skipped.length - WORLD_INFO_REPORT_LIST_CAP;
      return book;
    });
  return shown.length > WORLD_INFO_REPORT_BOOK_CAP ? { books, moreBooks: shown.length - WORLD_INFO_REPORT_BOOK_CAP } : { books };
}

/** Verbatim content of the enabled, in-subset, non-empty entries, plus what was applied or skipped per book. */
export function formatAllowlistedWorldInfo(
  books: Array<{ name: string; entries: WorldInfoEntry[]; entryIds: number[] }>,
): { text: string; groups: WorldInfoBookGroup[] } {
  const lines: string[] = [];
  const groups: WorldInfoBookGroup[] = [];
  for (const book of [...books].sort((a, b) => a.name.localeCompare(b.name))) {
    const onlyIds = new Set(book.entryIds.map((id) => Math.trunc(id)));
    const group: WorldInfoBookGroup = { book: book.name, applied: [], skipped: [] };
    groups.push(group);

    for (const entry of book.entries) {
      const title = worldInfoEntryTitle(entry);
      if (onlyIds.size > 0 && !onlyIds.has(Math.trunc(entry.uid))) {
        group.skipped.push({ uid: entry.uid, title, cause: 'not-in-subset' });
      } else if (entry.disable) {
        group.skipped.push({ uid: entry.uid, title, cause: 'disabled' });
      } else if (!(entry.content ?? '').trim()) {
        group.skipped.push({ uid: entry.uid, title, cause: 'empty' });
      } else {
        lines.push(entry.content.trim());
        group.applied.push({ uid: entry.uid, title, via: 'allowlist' });
      }
    }
    if (group.applied.length > 0) lines.push('');
  }

  // Keep prompt injection minimal: only entry content.
  return { text: lines.join('\n').trim(), groups };
}
