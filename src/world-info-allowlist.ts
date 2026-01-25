import type { WorldInfoEntry } from './world-info-policy.js';
import { formatAllowlistedWorldInfo } from './world-info-policy.js';

export type WorldInfosByBook = Record<string, WorldInfoEntry[]>;

function mergeWorldInfos(base: WorldInfosByBook, extra: WorldInfosByBook): WorldInfosByBook {
  const merged: WorldInfosByBook = { ...base };

  for (const [bookName, entries] of Object.entries(extra)) {
    const existing = merged[bookName] ?? [];
    if (existing.length === 0) {
      merged[bookName] = entries;
      continue;
    }

    const seen = new Set(existing.map((e) => Math.trunc(e.uid)));
    const combined = existing.slice();
    for (const entry of entries) {
      const id = Math.trunc(entry.uid);
      if (seen.has(id)) continue;
      seen.add(id);
      combined.push(entry);
    }
    merged[bookName] = combined;
  }

  return merged;
}

export async function buildAllowlistedWorldInfoText(options: {
  allowlistBookNames: string[];
  allowlistEntryIds: number[];
  getActiveWorldInfos: () => Promise<WorldInfosByBook>;
  loadBookByName: (name: string) => Promise<{ name: string; entries: WorldInfoEntry[] } | null>;
  debug?: boolean;
}): Promise<string> {
  const allowlistBookNames = options.allowlistBookNames ?? [];
  const allowlistEntryIds = options.allowlistEntryIds ?? [];

  let worldInfos: WorldInfosByBook = {};
  try {
    worldInfos = (await options.getActiveWorldInfos()) ?? {};
  } catch (err) {
    if (options.debug) console.debug('zTracker: getActiveWorldInfos failed', err);
  }

  if (allowlistBookNames.length > 0) {
    const fetched: WorldInfosByBook = {};
    await Promise.all(
      allowlistBookNames.map(async (bookName) => {
        const result = await options.loadBookByName(bookName);
        if (!result) return;
        fetched[result.name] = result.entries;
      }),
    );
    worldInfos = mergeWorldInfos(worldInfos, fetched);
  }

  return formatAllowlistedWorldInfo({
    allowlistBookNames,
    allowlistEntryIds,
    worldInfos,
  });
}
