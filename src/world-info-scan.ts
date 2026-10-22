/**
 * Runs SillyTavern's own World Info activation scan for tracker generation. Always a dry run, so
 * sticky/cooldown timers and the host's activated event are never touched. Besides the injected text,
 * it captures the activated entries from the host's (undocumented) scan-done event so the report can
 * say what was applied. Host functions are injected so the module stays import-safe and testable
 * with a fake host.
 */

import { capReportText, WORLD_INFO_REPORT_MATCHED_KEYS_CAP } from './world-info-policy.js';

const LORE_KEYS = ['globalLore', 'characterLore', 'chatLore', 'personaLore'] as const;

export interface WorldInfoScanData {
  personaDescription: string;
  characterDescription: string;
  characterPersonality: string;
  characterDepthPrompt: string;
  scenario: string;
  creatorNotes: string;
  trigger: string;
}

export interface WorldInfoScanHost {
  getWorldInfoPrompt?: (chat: string[], maxContext: number, isDryRun: boolean, scanData?: WorldInfoScanData) => Promise<any>;
  eventSource?: { on: (event: string, cb: (payload: any) => void) => void; removeListener: (event: string, cb: (payload: any) => void) => void };
  eventTypes?: { WORLDINFO_ENTRIES_LOADED?: string; WORLDINFO_SCAN_DONE?: string };
  /** True while the host is generating a reply (the scan listeners are host-global). */
  isGenerating?: () => boolean;
}

/** One allowlisted book: its full host entries, limited to `entryIds` when that set is non-empty. */
export interface WorldInfoScanRestriction {
  book: string;
  entries: Array<Record<string, any>>;
  entryIds: number[];
}

export interface WorldInfoScanOptions {
  host: WorldInfoScanHost;
  /** Module message window, newest first. */
  chat: string[];
  /** Real chat length; the window is padded with empty strings so entry `delay` sees it. */
  chatLength: number;
  maxContext: number;
  scanData?: WorldInfoScanData;
  /** Absent = unfiltered (whatever the host has active). */
  restrictTo?: WorldInfoScanRestriction[];
  idleTimeoutMs?: number;
  idlePollMs?: number;
}

/** Loop an entry first activated in, from the host's `scan_state` (1 initial, 2 recursion, 3 min-activations). */
export type WorldInfoScanLoop = 'initial' | 'recursion' | 'min-activations';
const SCAN_LOOPS: Record<number, WorldInfoScanLoop> = { 1: 'initial', 2: 'recursion', 3: 'min-activations' };

/** One entry the host scan activated. */
export interface ScannedWorldInfoEntry {
  book: string;
  uid: number;
  /** The entry's comment ('' when unset). */
  title: string;
  content: string;
  constant: boolean;
  key: string[];
  keysecondary: string[];
  /** Host `selectiveLogic`: 0 AND ANY, 1 NOT ALL, 2 NOT ANY, 3 AND ALL. */
  selectiveLogic: number;
  loop: WorldInfoScanLoop;
}

/**
 * `entries` is null when the host gave no usable activated-entry data (event missing or malformed).
 * `unavailable` marks a scan that could not run (host lacks the API, or it threw).
 */
export interface WorldInfoScanResult {
  text: string;
  entries: ScannedWorldInfoEntry[] | null;
  unavailable?: boolean;
}

const UNAVAILABLE: WorldInfoScanResult = { text: '', entries: null, unavailable: true };

const warnedHosts = new WeakSet<object>();
let queue: Promise<unknown> = Promise.resolve();

function warnOnce(host: object, message: string): void {
  if (warnedHosts.has(host)) return;
  warnedHosts.add(host);
  console.warn(message);
}

async function waitForHostIdle(host: WorldInfoScanHost, timeoutMs: number, pollMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (host.isGenerating?.()) {
    if (Date.now() >= deadline) {
      console.warn('zTracker: host still generating; running the World Info scan anyway.');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** Empties the host's lore arrays in place (the engine destructures them) and pushes only the allowed entries. */
function restrictLore(payload: Record<string, any[]>, restrictTo: WorldInfoScanRestriction[]): void {
  for (const key of LORE_KEYS) payload[key]?.splice(0);
  for (const { book, entries, entryIds } of restrictTo) {
    const only = new Set(entryIds.map((id) => Math.trunc(id)));
    for (const entry of entries) {
      if (only.size === 0 || only.has(Math.trunc(Number(entry.uid)))) payload.globalLore.push({ ...entry, world: book });
    }
  }
}

function joinResult(result: any): string {
  const parts: unknown[] = [
    result?.worldInfoBefore,
    result?.worldInfoAfter,
    ...(result?.worldInfoDepth ?? []).flatMap((d: any) => d?.entries ?? []),
    ...Object.values(result?.outletEntries ?? {}).flat(),
    ...(result?.anBefore ?? []),
    ...(result?.anAfter ?? []),
  ];
  return parts
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.trim())
    .filter(Boolean)
    .join('\n');
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

/**
 * Keeps the last cumulative activated map plus each entry's first-activation loop from the scan-done
 * events. Any unexpected payload shape leaves `entries()` null.
 */
function createScanCapture() {
  const firstLoop = new Map<string, WorldInfoScanLoop>();
  let activated: Map<string, any> | null = null;
  const listener = (args: any) => {
    const map = args?.activated?.entries;
    if (!(map instanceof Map)) return;
    activated = map;
    const loop = SCAN_LOOPS[args?.state?.current] ?? 'initial';
    for (const entry of Array.isArray(args?.new?.successful) ? args.new.successful : []) {
      const id = `${entry?.world}.${entry?.uid}`;
      if (!firstLoop.has(id)) firstLoop.set(id, loop);
    }
  };
  const entries = (): ScannedWorldInfoEntry[] | null =>
    activated &&
    [...activated.entries()].map(([id, e]) => ({
      book: String(e?.world ?? ''),
      uid: Number(e?.uid),
      title: typeof e?.comment === 'string' ? e.comment.trim() : '',
      content: typeof e?.content === 'string' ? e.content : '',
      constant: !!e?.constant,
      key: strings(e?.key),
      keysecondary: strings(e?.keysecondary),
      selectiveLogic: Number(e?.selectiveLogic ?? 0),
      loop: firstLoop.get(id) ?? 'initial',
    }));
  return { listener, entries };
}

async function runScan(options: WorldInfoScanOptions): Promise<WorldInfoScanResult> {
  const { host, restrictTo } = options;
  const eventName = host.eventTypes?.WORLDINFO_ENTRIES_LOADED;
  const doneEventName = host.eventTypes?.WORLDINFO_SCAN_DONE;
  if (!host.getWorldInfoPrompt || (restrictTo && (!host.eventSource || !eventName))) {
    warnOnce(host, 'zTracker: this SillyTavern version lacks the World Info scan API; no World Info is injected.');
    return UNAVAILABLE;
  }

  const padded = [...options.chat];
  while (padded.length < options.chatLength) padded.push('');

  let restrictListener: ((payload: any) => void) | undefined;
  const capture = createScanCapture();
  const capturing = !!(host.eventSource && doneEventName);
  try {
    await waitForHostIdle(host, options.idleTimeoutMs ?? 5000, options.idlePollMs ?? 100);
    if (restrictTo) {
      restrictListener = (payload) => restrictLore(payload, restrictTo);
      host.eventSource!.on(eventName!, restrictListener);
    }
    if (capturing) host.eventSource!.on(doneEventName!, capture.listener);
    const text = joinResult(await host.getWorldInfoPrompt(padded, options.maxContext, true, options.scanData));
    return { text, entries: capture.entries() };
  } catch (error) {
    console.warn('zTracker: World Info scan failed; proceeding without it.', error);
    return UNAVAILABLE;
  } finally {
    if (restrictListener) host.eventSource!.removeListener(eventName!, restrictListener);
    if (capturing) host.eventSource!.removeListener(doneEventName!, capture.listener);
  }
}

/** Serialized dry-run scan; returns the injected text and activated entries (an empty result on any failure). */
export function scanWorldInfo(options: WorldInfoScanOptions): Promise<WorldInfoScanResult> {
  const run = queue.then(() => runScan(options));
  queue = run.catch(() => undefined);
  return run;
}

export type WorldInfoReason = 'constant' | 'keyword' | 'recursion' | 'min-activations' | 'other';

/** Plain keys match case-insensitively as substrings; `/regex/flags` keys are tested as regexes. */
function keyMatches(key: string, haystack: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  const regex = /^\/(.+)\/([a-z]*)$/.exec(trimmed);
  if (regex) {
    try {
      return new RegExp(regex[1], regex[2]).test(haystack);
    } catch {
      return false;
    }
  }
  return haystack.toLowerCase().includes(trimmed.toLowerCase());
}

/**
 * Why a scan-activated entry got in. Constant and loop reasons come from the host and are exact;
 * `keyword` is inferred from the scanned window (per-entry depth, case/whole-word overrides, macros
 * and card fields are not modelled and show as `other`). Secondary keys count only under AND logic.
 */
export function inferWorldInfoReason(
  entry: ScannedWorldInfoEntry,
  scannedChat: string[],
): { reason: WorldInfoReason; matchedKeys?: string[] } {
  if (entry.constant) return { reason: 'constant' };
  if (entry.loop !== 'initial') return { reason: entry.loop };
  const haystack = scannedChat.join('\n');
  const andLogic = entry.selectiveLogic === 0 || entry.selectiveLogic === 3;
  const matchedKeys = [...entry.key, ...(andLogic ? entry.keysecondary : [])].filter((k) => keyMatches(k, haystack));
  return matchedKeys.length > 0
    ? { reason: 'keyword', matchedKeys: matchedKeys.slice(0, WORLD_INFO_REPORT_MATCHED_KEYS_CAP).map(capReportText) }
    : { reason: 'other' };
}

/**
 * The Module's message window as the host scan expects it: newest first, system messages dropped,
 * formatted as "name: text" when the host's "include names" World Info setting is on.
 */
export function buildWorldInfoScanChat(
  chat: Array<{ name?: string; mes?: string; is_system?: boolean }>,
  messageId: number,
  includeLastXMessages: number,
  includeNames = readIncludeNamesSetting(),
): string[] {
  const start = includeLastXMessages > 0 ? Math.max(0, messageId - includeLastXMessages) : 0;
  return chat
    .slice(start, messageId + 1)
    .filter((m) => !m.is_system)
    .map((m) => (includeNames ? `${m.name}: ${m.mes}` : String(m.mes ?? '')))
    .reverse();
}

/** Host "include names" World Info setting; unavailable (no DOM or checkbox) reads as off. */
function readIncludeNamesSetting(): boolean {
  return (globalThis.document?.querySelector('#world_info_include_names') as HTMLInputElement | null)?.checked ?? false;
}

/** Persona and character card fields for keyword matching; scanned even when the card is not added to the prompt. */
export function buildWorldInfoScanData(
  context: { getCharacterCardFields?: (opts: { chid?: number }) => Record<string, any> },
  characterId: number | undefined,
): WorldInfoScanData {
  const fields = context.getCharacterCardFields?.({ chid: characterId }) ?? {};
  return {
    personaDescription: fields.persona ?? '',
    characterDescription: fields.description ?? '',
    characterPersonality: fields.personality ?? '',
    characterDepthPrompt: fields.charDepthPrompt ?? '',
    scenario: fields.scenario ?? '',
    creatorNotes: fields.creatorNotes ?? '',
    trigger: 'normal',
  };
}
