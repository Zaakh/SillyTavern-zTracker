/**
 * Resolves and applies a Module's generation "include list" - the set of other Modules
 * (plus its own self-history) whose stored tracker snapshots are read into this Module's
 * own generation context. This is independent of downstream `generate_interceptor` embedding
 * into normal chat generations (`injection.*`).
 *
 * Self-history and chained history use different discovery strategies:
 * - Self stays bound to the already-windowed prompt `messages` (unchanged legacy behavior) and
 *   interleaves inline right after the message that owns each snapshot.
 * - Chained entries are independent of the raw message window (`generation.includeLastXMessages`)
 *   by design, so they scan the full chat directly instead of the windowed `messages`. Their
 *   source turn may not even be present in `messages`, so they are prepended as standalone
 *   context messages ahead of the window rather than interleaved.
 */
import type { Message } from 'sillytavern-utils-lib';
import type { ChatMessage } from 'sillytavern-utils-lib/types';
import { DEFAULT_EMBED_SNAPSHOT_HEADER } from './config.js';
import type { TrackerModule, TrackerModuleIncludeEntry, TrackerModuleSettings } from './config.js';
import { getSettingsForTrackerModule } from './config.js';
import { formatEmbeddedTrackerSnapshot } from './embed-snapshot-transform.js';
import {
  CHAT_MESSAGE_SCHEMA_VALUE_KEY,
  deriveEmbeddedTrackerSpeakerName,
  getTrackerModuleRecord,
  includeZTrackerMessages,
} from './tracker.js';

/** Minimal shape needed to read stored tracker data off one chat history entry. */
type ChatHistoryMessage = { extra?: Record<string, any> };

export interface ResolvedTrackerModuleIncludeEntry {
  entry: TrackerModuleIncludeEntry;
  isSelf: boolean;
  /** Present only for chained (non-self) entries; undefined when the referenced Module no longer exists. */
  targetModule?: TrackerModule;
  /** False means this entry is currently dormant (target disabled or no longer strictly earlier in order); it stays stored. */
  eligible: boolean;
}

/**
 * A chained (non-self) entry is only eligible while its target Module is enabled and has a
 * strictly earlier generation order than the source Module. Self is always eligible.
 */
export function isChainedIncludeTargetEligible(
  sourceModule: Pick<TrackerModule, 'order'>,
  targetModule: Pick<TrackerModule, 'enabled' | 'order'> | undefined,
): boolean {
  return !!targetModule && targetModule.enabled && targetModule.order < sourceModule.order;
}

/**
 * Resolves every stored include-list entry against the current Module collection, flagging
 * dormant (currently-ineligible) chained entries without removing or mutating them.
 */
export function resolveTrackerModuleIncludeEntries(
  sourceModule: TrackerModule,
  allModules: TrackerModule[],
): ResolvedTrackerModuleIncludeEntry[] {
  const entries = sourceModule.generation.includeModules ?? [];
  return entries.map((entry) => {
    if (entry.target === 'self') {
      return { entry, isSelf: true, eligible: true };
    }

    const targetModule = allModules.find((module) => module.id === entry.target);
    return {
      entry,
      isSelf: false,
      targetModule,
      eligible: isChainedIncludeTargetEligible(sourceModule, targetModule),
    };
  });
}

/**
 * Modules eligible to be added as a NEW chained entry on `sourceModule`: enabled, with a
 * strictly earlier generation order, excluding the source Module itself.
 */
export function getEligibleChainableModules(
  sourceModule: Pick<TrackerModule, 'id' | 'order'>,
  allModules: TrackerModule[],
): TrackerModule[] {
  return allModules.filter(
    (module) => module.id !== sourceModule.id && module.enabled && module.order < sourceModule.order,
  );
}

/** Formats one chained tracker snapshot as a standalone message, reusing the target Module's own injection settings. */
function buildStandaloneSnapshotMessage(trackerValue: unknown, targetSettings: TrackerModuleSettings): Record<string, unknown> {
  const useCharacterName = targetSettings.embedZTrackerAsCharacter ?? false;
  const header = targetSettings.embedZTrackerSnapshotHeader ?? DEFAULT_EMBED_SNAPSHOT_HEADER;
  const { lang, text, wrapInCodeFence } = formatEmbeddedTrackerSnapshot(trackerValue, targetSettings);
  const speakerName = useCharacterName ? deriveEmbeddedTrackerSpeakerName(targetSettings) : undefined;
  const prefix = !useCharacterName && header ? `${header}\n` : '';
  const content = wrapInCodeFence ? `${prefix}\`\`\`${lang}\n${text}\n\`\`\`` : `${prefix}${text}`;
  const embedRole = targetSettings.embedZTrackerRole ?? 'user';

  return {
    content,
    role: embedRole,
    is_user: embedRole === 'user',
    is_system: embedRole === 'system',
    ...(speakerName ? { name: speakerName } : {}),
    mes: content,
    extra: embedRole === 'system' ? { type: 'narrator' } : {},
  };
}

/**
 * Scans `chat` backward from `uptoMessageIndex` (inclusive - a chained target with an earlier
 * generation order may have already generated its own snapshot on the very message currently
 * being processed) collecting up to `entry.count` stored snapshots for the entry's target Module.
 * Returned oldest-first, matching normal chat chronological order.
 */
function collectChainedEntrySnapshots(
  entry: ResolvedTrackerModuleIncludeEntry,
  chat: ChatHistoryMessage[],
  uptoMessageIndex: number,
): unknown[] {
  if (!entry.targetModule) {
    return [];
  }

  const foundValues: unknown[] = [];
  const startIndex = Math.min(uptoMessageIndex, chat.length - 1);
  for (let i = startIndex; i >= 0 && foundValues.length < entry.entry.count; i--) {
    const trackerRecord = getTrackerModuleRecord(chat[i], entry.targetModule.id);
    const value = trackerRecord?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY];
    if (value !== undefined) {
      foundValues.unshift(value);
    }
  }

  return foundValues;
}

/**
 * Builds the standalone, prepended message block for every active chained entry (in list order),
 * each formatted using that entry's own target Module's injection settings.
 */
export function collectChainedSnapshotMessages<T extends Message | ChatMessage>(
  chainedEntries: ResolvedTrackerModuleIncludeEntry[],
  sourceSettings: TrackerModuleSettings,
  chat: ChatHistoryMessage[],
  uptoMessageIndex: number,
): T[] {
  const prepended: T[] = [];
  for (const resolved of chainedEntries) {
    if (!resolved.targetModule) {
      continue;
    }

    const targetSettings = getSettingsForTrackerModule(sourceSettings, resolved.targetModule.id);
    for (const value of collectChainedEntrySnapshots(resolved, chat, uptoMessageIndex)) {
      prepended.push(buildStandaloneSnapshotMessage(value, targetSettings) as T);
    }
  }

  return prepended;
}

/**
 * Applies a Module's active (eligible, non-zero-count) generation include-list entries to
 * `messages`. The self entry (if active) interleaves inline into `messages` via the existing
 * window-bound `includeZTrackerMessages` path. Chained entries (if active and `chatContext` is
 * provided) are resolved independently of the message window by scanning `chatContext.chat`
 * directly, and are prepended ahead of `messages` in list order since their source turn may not
 * be present in the (possibly narrower) prompt window at all.
 */
export function applyTrackerModuleIncludeList<T extends Message | ChatMessage>(
  messages: T[],
  sourceModule: TrackerModule,
  sourceSettings: TrackerModuleSettings,
  chatContext: { chat?: ChatHistoryMessage[]; messageId?: number } = {},
  options: Parameters<typeof includeZTrackerMessages>[2] = {},
): T[] {
  const allModules = sourceSettings.modules ?? [];
  const resolvedEntries = resolveTrackerModuleIncludeEntries(sourceModule, allModules).filter(
    (resolved) => resolved.eligible && resolved.entry.count > 0,
  );

  const selfEntry = resolvedEntries.find((resolved) => resolved.isSelf);
  const chainedEntries = resolvedEntries.filter((resolved) => !resolved.isSelf);

  // The self entry's own count drives self-history, independent of `injection.includeLastXMessages`
  // (which `sourceSettings.includeLastXZTrackerMessages` reflects and only controls downstream
  // generate_interceptor embedding) - override it before delegating to includeZTrackerMessages.
  const withSelf = selfEntry
    ? includeZTrackerMessages(
      messages,
      { ...sourceSettings, includeLastXZTrackerMessages: selfEntry.entry.count },
      { ...options, moduleId: sourceModule.id },
    )
    : messages;

  if (chainedEntries.length === 0 || !chatContext.chat || typeof chatContext.messageId !== 'number') {
    return withSelf;
  }

  const prepended = collectChainedSnapshotMessages<T>(chainedEntries, sourceSettings, chatContext.chat, chatContext.messageId);
  return [...prepended, ...withSelf];
}
