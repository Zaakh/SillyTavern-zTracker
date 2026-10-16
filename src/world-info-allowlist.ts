/**
 * Builds the World Info text injected into tracker generation. Include-all scans whatever the host has
 * active; allowlist mode combines "always" rows (entries injected verbatim) with "engine" rows
 * (only the allowlisted books go through the host activation scan). Only rows whose activation
 * scope is satisfied by the open chat are used, each limited to its entry subset.
 */
import { TrackerWorldInfoPolicyMode, type TrackerWorldInfoAllowlistRow } from './config.js';
import type { WorldInfoEntry } from './world-info-policy.js';
import { formatAllowlistedWorldInfo } from './world-info-policy.js';
import type { WorldInfoScanRestriction } from './world-info-scan.js';
import { isWorldInfoRowScopeSatisfied, type WorldInfoScopeSources } from './world-info-scope.js';

function satisfiedRows(rows: TrackerWorldInfoAllowlistRow[], sources: WorldInfoScopeSources, debug?: boolean) {
  return (rows ?? []).filter((row) => {
    const ok = isWorldInfoRowScopeSatisfied(row, sources);
    if (!ok && debug) {
      console.debug('zTracker: allowlist row skipped (scope not satisfied)', { book: row.book, activeVia: row.activeVia });
    }
    return ok;
  });
}

/** Verbatim text of the "always" rows: every enabled entry of each satisfied row, content only. */
export async function buildAllowlistedWorldInfoText(options: {
  rows: TrackerWorldInfoAllowlistRow[];
  sources: WorldInfoScopeSources;
  loadBookByName: (name: string) => Promise<{ name: string; entries: WorldInfoEntry[] } | null>;
  debug?: boolean;
}): Promise<string> {
  const loaded = await Promise.all(
    satisfiedRows(options.rows, options.sources, options.debug).map(async (row) => {
      const result = await options.loadBookByName(row.book);
      return result ? { name: result.name, entries: result.entries, entryIds: row.entryIds } : null;
    }),
  );

  return formatAllowlistedWorldInfo(loaded.filter((book): book is NonNullable<typeof book> => book !== null));
}

/** Everything the policy needs from the host, injected so this stays import-safe. */
export interface TrackerWorldInfoDeps {
  mode: TrackerWorldInfoPolicyMode;
  rows: TrackerWorldInfoAllowlistRow[];
  /** Resolves scope sources; only called for allowlist mode with at least one row. */
  resolveSources: () => Promise<WorldInfoScopeSources>;
  loadBookByName: (name: string) => Promise<{ name: string; entries: WorldInfoEntry[] } | null>;
  loadFullEntries: (name: string) => Promise<Array<Record<string, any>> | null>;
  scan: (restrictTo?: WorldInfoScanRestriction[]) => Promise<string>;
  /** Wraps include-all content with the active preset's World Info format. */
  wrapIncludeAll: (text: string) => string;
  debug?: boolean;
}

/** Returns the single World Info string to inject ('' when nothing applies). Exclude-all never scans. */
export async function buildTrackerWorldInfoText(deps: TrackerWorldInfoDeps): Promise<string> {
  if (deps.mode === TrackerWorldInfoPolicyMode.EXCLUDE_ALL) return '';

  if (deps.mode === TrackerWorldInfoPolicyMode.INCLUDE_ALL) {
    const text = await deps.scan();
    return text ? deps.wrapIncludeAll(text) : '';
  }

  if (deps.rows.length === 0) return '';
  const sources = await deps.resolveSources();
  const alwaysText = await buildAllowlistedWorldInfoText({
    rows: deps.rows.filter((row) => row.trigger !== 'engine'),
    sources,
    loadBookByName: deps.loadBookByName,
    debug: deps.debug,
  });

  const engineRows = satisfiedRows(
    deps.rows.filter((row) => row.trigger === 'engine'),
    sources,
    deps.debug,
  );
  const restrictions = (
    await Promise.all(
      engineRows.map(async (row) => {
        const entries = await deps.loadFullEntries(row.book);
        return entries ? { book: row.book, entries, entryIds: row.entryIds } : null;
      }),
    )
  ).filter((r): r is WorldInfoScanRestriction => r !== null);
  const engineText = restrictions.length > 0 ? await deps.scan(restrictions) : '';

  return [alwaysText, engineText].filter(Boolean).join('\n\n');
}
