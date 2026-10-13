/**
 * Decides which allowlisted World Info rows are in scope for the open chat: resolves where each
 * book is active (card / chat-bound / global) once, then evaluates per-row scopes purely.
 * Shared by tracker generation and the settings warning so the two can never disagree.
 */
import type { TrackerWorldInfoAllowlistRow } from './config.js';
import { normalizeWorldInfoName } from './world-info-policy.js';

export interface WorldInfoScopeSources {
  cardBooks: Set<string>;
  globalBooks: Set<string>;
  chatOpen: boolean;
  /** False when a card's additional books could not be read; card-scoped rows then fail closed. */
  cardLookupComplete: boolean;
}

export interface WorldInfoScopeDeps {
  context: {
    chatId?: unknown;
    chatMetadata?: { world_info?: unknown };
    characters?: any[];
    characterId?: unknown;
    groups?: any[];
    groupId?: unknown;
  };
  getGlobalBookNames: () => Promise<string[]>;
  /** Additional (non-primary) books attached to a card, by avatar (host `/getcharbook type=all`). */
  getExtraCardBooks: (avatar: string) => Promise<string[]>;
}

/** True when any row restricts injection to a card/global scope (otherwise no host lookups are needed). */
export function hasScopedRows(rows: TrackerWorldInfoAllowlistRow[]): boolean {
  return rows.some((row) => row.activeVia.length > 0);
}

function addName(target: Set<string>, name: unknown): void {
  if (typeof name === 'string' && name.trim()) target.add(normalizeWorldInfoName(name));
}

/** Resolves the card/chat and global book sets for the open chat; only queries the host for scopes the rows use. */
export async function resolveWorldInfoScopeSources(
  deps: WorldInfoScopeDeps,
  needs: { card: boolean; global: boolean } = { card: true, global: true },
): Promise<WorldInfoScopeSources> {
  const { context } = deps;
  const sources: WorldInfoScopeSources = {
    cardBooks: new Set(),
    globalBooks: new Set(),
    chatOpen: context.chatId !== undefined && context.chatId !== null,
    cardLookupComplete: true,
  };

  if (needs.global) {
    try {
      (await deps.getGlobalBookNames()).forEach((name) => addName(sources.globalBooks, name));
    } catch (error) {
      console.debug('zTracker: global World Info lookup failed', error);
    }
  }

  if (!needs.card) return sources;

  addName(sources.cardBooks, context.chatMetadata?.world_info);

  // Group chats use every member's card (disabled members included); otherwise the single open card.
  const characters = context.characters ?? [];
  const group = context.groupId ? (context.groups ?? []).find((g) => String(g.id) === String(context.groupId)) : undefined;
  const cards: any[] = group
    ? (group.members ?? []).map((avatar: string) => characters.find((c) => c?.avatar === avatar)).filter(Boolean)
    : [characters[Number(context.characterId)]].filter(Boolean);

  for (const card of cards) {
    addName(sources.cardBooks, card?.data?.extensions?.world);
    try {
      (await deps.getExtraCardBooks(card.avatar)).forEach((name) => addName(sources.cardBooks, name));
    } catch (error) {
      sources.cardLookupComplete = false;
      console.debug('zTracker: card World Info lookup failed', error);
    }
  }
  return sources;
}

/** Pure scope check: an empty scope is always satisfied; otherwise any listed source holding the book suffices. */
export function isWorldInfoRowScopeSatisfied(row: TrackerWorldInfoAllowlistRow, sources: WorldInfoScopeSources): boolean {
  if (row.activeVia.length === 0) return true;
  const book = normalizeWorldInfoName(row.book);
  return (
    (row.activeVia.includes('card') && sources.cardBooks.has(book)) ||
    (row.activeVia.includes('global') && sources.globalBooks.has(book))
  );
}

/** Production deps: host context plus the global-selection and `/getcharbook` lookups. */
export function createHostWorldInfoScopeDeps(
  context: any,
  getGlobalBookNames: () => Promise<string[]>,
): WorldInfoScopeDeps {
  return {
    context,
    getGlobalBookNames,
    getExtraCardBooks: async (avatar) => {
      const result = await context.executeSlashCommandsWithOptions(`/getcharbook type=all "${avatar}"`, {
        handleParserErrors: false,
      });
      const parsed = JSON.parse(String(result?.pipe ?? '[]'));
      return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : [];
    },
  };
}

export type WorldInfoRowScopeStatus = 'ok' | 'skipped' | 'unknown';

/** Settings-time status of one row: `unknown` when the chat is not open or a card lookup was incomplete, never a false "skipped". */
export function getWorldInfoRowScopeStatus(row: TrackerWorldInfoAllowlistRow, sources: WorldInfoScopeSources): WorldInfoRowScopeStatus {
  if (row.activeVia.length === 0 || isWorldInfoRowScopeSatisfied(row, sources)) return 'ok';
  if (!sources.chatOpen) return 'unknown';
  if (!sources.cardLookupComplete && row.activeVia.includes('card')) return 'unknown';
  return 'skipped';
}
