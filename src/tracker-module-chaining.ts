/**
 * Resolves and applies a Module's generation "include list" - the set of other Modules
 * (plus its own self-history) whose stored tracker snapshots are read into this Module's
 * own generation context. This is independent of the raw chat message window and independent
 * of downstream `generate_interceptor` embedding into normal chat generations (`injection.*`).
 */
import type { Message } from 'sillytavern-utils-lib';
import type { ChatMessage } from 'sillytavern-utils-lib/types';
import type { TrackerModule, TrackerModuleIncludeEntry, TrackerModuleSettings } from './config.js';
import { getSettingsForTrackerModule } from './config.js';
import { includeZTrackerMessages } from './tracker.js';

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

/**
 * Splices each active (eligible, non-zero-count) include-list entry's stored tracker snapshots
 * into `messages`, in list order. The self entry uses `sourceSettings`'s own self-history count;
 * chained entries reuse the *target* Module's own injection formatting (snapshot header,
 * embed-as-character, transform preset) with the entry's configured count.
 *
 * Each underlying `includeZTrackerMessages` call re-anchors its insertion right after the source
 * message, so entries are applied in reverse so the *last*-applied (first-in-list) entry ends up
 * closest to the source message - mirroring the same reverse-iteration trick the downstream
 * `generate_interceptor` composition uses for multi-module ordering (see `ui-init.ts`).
 */
export function applyTrackerModuleIncludeList<T extends Message | ChatMessage>(
  messages: T[],
  sourceModule: TrackerModule,
  sourceSettings: TrackerModuleSettings,
  options: Parameters<typeof includeZTrackerMessages>[2] = {},
): T[] {
  const allModules = sourceSettings.modules ?? [];
  const resolvedEntries = resolveTrackerModuleIncludeEntries(sourceModule, allModules)
    .filter((resolved) => resolved.eligible && resolved.entry.count > 0)
    .reverse();

  let result = messages;
  for (const resolved of resolvedEntries) {
    const targetModuleId = resolved.isSelf ? sourceModule.id : resolved.entry.target;
    const targetSettings = resolved.isSelf ? sourceSettings : getSettingsForTrackerModule(sourceSettings, targetModuleId);
    const perEntrySettings: TrackerModuleSettings = {
      ...targetSettings,
      includeLastXZTrackerMessages: resolved.entry.count,
    };

    result = includeZTrackerMessages(result, perEntrySettings, { ...options, moduleId: targetModuleId });
  }

  return result;
}
