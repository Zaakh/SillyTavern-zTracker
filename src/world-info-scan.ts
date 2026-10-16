/**
 * Runs SillyTavern's own World Info activation scan for tracker generation. Always a dry run, so
 * sticky/cooldown timers and the host's activated event are never touched. Host functions are
 * injected so the module stays import-safe and testable with a fake host.
 */

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
  eventTypes?: { WORLDINFO_ENTRIES_LOADED?: string };
  /** True while the host is generating a reply (the entries-loaded listener is host-global). */
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
      console.warn('zTracker: host still generating; running the restricted World Info scan anyway.');
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

async function runScan(options: WorldInfoScanOptions): Promise<string> {
  const { host, restrictTo } = options;
  const eventName = host.eventTypes?.WORLDINFO_ENTRIES_LOADED;
  if (!host.getWorldInfoPrompt || (restrictTo && (!host.eventSource || !eventName))) {
    warnOnce(host, 'zTracker: this SillyTavern version lacks the World Info scan API; no World Info is injected.');
    return '';
  }

  const padded = [...options.chat];
  while (padded.length < options.chatLength) padded.push('');

  let listener: ((payload: any) => void) | undefined;
  try {
    if (restrictTo) {
      await waitForHostIdle(host, options.idleTimeoutMs ?? 5000, options.idlePollMs ?? 100);
      listener = (payload) => restrictLore(payload, restrictTo);
      host.eventSource!.on(eventName!, listener);
    }
    return joinResult(await host.getWorldInfoPrompt(padded, options.maxContext, true, options.scanData));
  } catch (error) {
    console.warn('zTracker: World Info scan failed; proceeding without it.', error);
    return '';
  } finally {
    if (listener) host.eventSource!.removeListener(eventName!, listener);
  }
}

/** Serialized dry-run scan; returns the activated entries' content joined into one string ('' on any failure). */
export function scanWorldInfo(options: WorldInfoScanOptions): Promise<string> {
  const run = queue.then(() => runScan(options));
  queue = run.catch(() => undefined);
  return run;
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
