/**
 * Builds the World Info text injected into tracker generation, together with a report of what was
 * applied and why. Include-all scans whatever the host has active; allowlist mode combines "always"
 * rows (entries injected verbatim) with "engine" rows (only the allowlisted books go through the host
 * activation scan). Only rows whose activation scope is satisfied by the open chat are used, each
 * limited to its entry subset.
 */
import { TrackerWorldInfoPolicyMode, type TrackerWorldInfoAllowlistRow } from './config.js';
import {
  capReportText,
  finalizeReportBooks,
  formatAllowlistedWorldInfo,
  worldInfoEntryTitle,
  type TrackerWorldInfoReport,
  type WorldInfoBookGroup,
  type WorldInfoEntry,
} from './world-info-policy.js';
import { inferWorldInfoReason, type WorldInfoScanRestriction, type WorldInfoScanResult } from './world-info-scan.js';
import { isWorldInfoRowScopeSatisfied, type WorldInfoScopeSources } from './world-info-scope.js';

function partitionRowsByScope(rows: TrackerWorldInfoAllowlistRow[], sources: WorldInfoScopeSources, debug?: boolean) {
  const satisfied: TrackerWorldInfoAllowlistRow[] = [];
  const unsatisfied: TrackerWorldInfoAllowlistRow[] = [];
  for (const row of rows ?? []) {
    if (isWorldInfoRowScopeSatisfied(row, sources)) {
      satisfied.push(row);
      continue;
    }
    unsatisfied.push(row);
    if (debug) console.debug('zTracker: allowlist row skipped (scope not satisfied)', { book: row.book, activeVia: row.activeVia });
  }
  return { satisfied, unsatisfied };
}

const isMissingBook = (entries: unknown[] | null | undefined): boolean => !entries || entries.length === 0;

const wholeRowSkip = (book: string, cause: 'scope' | 'book-missing'): WorldInfoBookGroup => ({
  book,
  applied: [],
  skipped: [{ cause }],
});

/** Verbatim text of the "always" rows: every enabled entry of each satisfied row, content only. */
export async function buildAllowlistedWorldInfoText(options: {
  rows: TrackerWorldInfoAllowlistRow[];
  sources: WorldInfoScopeSources;
  loadBookByName: (name: string) => Promise<{ name: string; entries: WorldInfoEntry[] } | null>;
  debug?: boolean;
}): Promise<{ text: string; groups: WorldInfoBookGroup[] }> {
  const { satisfied, unsatisfied } = partitionRowsByScope(options.rows, options.sources, options.debug);
  const loaded = await Promise.all(
    satisfied.map(async (row) => {
      const result = await options.loadBookByName(row.book);
      return { row, result };
    }),
  );

  const found = loaded.flatMap(({ row, result }) => (!isMissingBook(result?.entries) && result ? [{ name: result.name, entries: result.entries, entryIds: row.entryIds }] : []));
  const formatted = formatAllowlistedWorldInfo(found);
  return {
    text: formatted.text,
    groups: [
      ...unsatisfied.map((row) => wholeRowSkip(row.book, 'scope')),
      ...loaded.filter(({ result }) => isMissingBook(result?.entries)).map(({ row }) => wholeRowSkip(row.book, 'book-missing')),
      ...formatted.groups,
    ],
  };
}

/** Everything the policy needs from the host, injected so this stays import-safe. */
export interface TrackerWorldInfoDeps {
  mode: TrackerWorldInfoPolicyMode;
  rows: TrackerWorldInfoAllowlistRow[];
  /** Resolves scope sources; only called for allowlist mode with at least one row. */
  resolveSources: () => Promise<WorldInfoScopeSources>;
  loadBookByName: (name: string) => Promise<{ name: string; entries: WorldInfoEntry[] } | null>;
  loadFullEntries: (name: string) => Promise<Array<Record<string, any>> | null>;
  scan: (restrictTo?: WorldInfoScanRestriction[]) => Promise<WorldInfoScanResult>;
  /** The message window the scan sees (newest first); used to infer which keys matched. */
  scannedChat: string[];
  /** Wraps include-all content with the active preset's World Info format. */
  wrapIncludeAll: (text: string) => string;
  debug?: boolean;
}

/** The text to inject ('' when nothing applies) and the report of what it was built from. */
export interface TrackerWorldInfoBuild {
  text: string;
  report: TrackerWorldInfoReport;
}

/** Scan entries that contributed text, grouped by book, with the reason each got in. */
function scanGroups(result: WorldInfoScanResult, scannedChat: string[]): WorldInfoBookGroup[] {
  const groups = new Map<string, WorldInfoBookGroup>();
  for (const entry of result.entries ?? []) {
    if (!entry.content.trim()) continue;
    const group = groups.get(entry.book) ?? { book: entry.book, applied: [], skipped: [] };
    groups.set(entry.book, group);
    group.applied.push({
      uid: entry.uid,
      title: entry.title ? capReportText(entry.title) : worldInfoEntryTitle({ uid: entry.uid, key: entry.key }),
      via: 'scan',
      ...inferWorldInfoReason(entry, scannedChat),
    });
  }
  return [...groups.values()];
}

/** True when the scan produced text we cannot attribute to entries (or could not run at all). */
const scanLacksData = (result: WorldInfoScanResult) => !!result.unavailable || (!!result.text && result.entries === null);

const hasApplied = (groups: WorldInfoBookGroup[]) => groups.some((g) => g.applied.length > 0);

/** Builds the single World Info string to inject plus its report. Exclude-all never scans. */
export async function buildTrackerWorldInfo(deps: TrackerWorldInfoDeps): Promise<TrackerWorldInfoBuild> {
  if (deps.mode === TrackerWorldInfoPolicyMode.EXCLUDE_ALL) return { text: '', report: { outcome: 'excluded', books: [] } };

  if (deps.mode === TrackerWorldInfoPolicyMode.INCLUDE_ALL) {
    const result = await deps.scan();
    const groups = scanGroups(result, deps.scannedChat);
    const outcome = scanLacksData(result) ? 'scan-unavailable' : hasApplied(groups) ? 'applied' : 'none-matched';
    return {
      text: result.text ? deps.wrapIncludeAll(result.text) : '',
      report: { outcome, ...finalizeReportBooks(groups) },
    };
  }

  if (deps.rows.length === 0) return { text: '', report: { outcome: 'none-matched', books: [] } };
  const sources = await deps.resolveSources();
  const always = await buildAllowlistedWorldInfoText({
    rows: deps.rows.filter((row) => row.trigger !== 'engine'),
    sources,
    loadBookByName: deps.loadBookByName,
    debug: deps.debug,
  });

  const { satisfied, unsatisfied } = partitionRowsByScope(
    deps.rows.filter((row) => row.trigger === 'engine'),
    sources,
    deps.debug,
  );
  const loadedEngineRows = await Promise.all(
    satisfied.map(async (row) => ({ row, entries: await deps.loadFullEntries(row.book) })),
  );
  const restrictions: WorldInfoScanRestriction[] = [];
  const engineGroups: WorldInfoBookGroup[] = unsatisfied.map((row) => wholeRowSkip(row.book, 'scope'));
  for (const { row, entries } of loadedEngineRows) {
    if (isMissingBook(entries) || !entries) {
      engineGroups.push(wholeRowSkip(row.book, 'book-missing'));
      continue;
    }
    restrictions.push({ book: row.book, entries, entryIds: row.entryIds });
    const only = new Set(row.entryIds.map((id) => Math.trunc(id)));
    if (only.size > 0) {
      engineGroups.push({
        book: row.book,
        applied: [],
        skipped: entries
          .filter((e) => !only.has(Math.trunc(Number(e.uid))))
          .map((e) => ({ uid: Number(e.uid), title: worldInfoEntryTitle({ uid: Number(e.uid), comment: e.comment, key: e.key }), cause: 'not-in-subset' as const })),
      });
    }
  }

  const engine: WorldInfoScanResult = restrictions.length > 0 ? await deps.scan(restrictions) : { text: '', entries: [] };
  const groups = [...always.groups, ...engineGroups, ...scanGroups(engine, deps.scannedChat)];
  const outcome = scanLacksData(engine) ? 'scan-unavailable' : hasApplied(groups) ? 'applied' : 'none-matched';
  return {
    text: [always.text, engine.text].filter(Boolean).join('\n\n'),
    report: { outcome, ...finalizeReportBooks(groups) },
  };
}
