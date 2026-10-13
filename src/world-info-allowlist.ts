/**
 * Builds the World Info text injected into tracker generation in allowlist mode: only rows whose
 * activation scope is satisfied by the open chat are loaded, each limited to its entry subset.
 */
import type { TrackerWorldInfoAllowlistRow } from './config.js';
import type { WorldInfoEntry } from './world-info-policy.js';
import { formatAllowlistedWorldInfo } from './world-info-policy.js';
import { isWorldInfoRowScopeSatisfied, type WorldInfoScopeSources } from './world-info-scope.js';

export async function buildAllowlistedWorldInfoText(options: {
  rows: TrackerWorldInfoAllowlistRow[];
  sources: WorldInfoScopeSources;
  loadBookByName: (name: string) => Promise<{ name: string; entries: WorldInfoEntry[] } | null>;
  debug?: boolean;
}): Promise<string> {
  const satisfied = (options.rows ?? []).filter((row) => {
    const ok = isWorldInfoRowScopeSatisfied(row, options.sources);
    if (!ok && options.debug) {
      console.debug('zTracker: allowlist row skipped (scope not satisfied)', { book: row.book, activeVia: row.activeVia });
    }
    return ok;
  });

  const loaded = await Promise.all(
    satisfied.map(async (row) => {
      const result = await options.loadBookByName(row.book);
      return result ? { name: result.name, entries: result.entries, entryIds: row.entryIds } : null;
    }),
  );

  return formatAllowlistedWorldInfo(loaded.filter((book): book is NonNullable<typeof book> => book !== null));
}
