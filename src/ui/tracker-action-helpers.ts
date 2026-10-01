import type { Message } from 'sillytavern-utils-lib';
import type { TrackerModuleSettings } from '../config.js';
import type { EffectiveConnectionSettings } from '../connection-settings.js';
import { getArrayItemIdentityKey } from '../tracker-parts.js';

/** Calculates tracker-part metadata once so render and regeneration flows can reuse the same schema hints. */
export function buildPartsMeta(schema: any): Record<string, { idKey?: string; fields?: string[]; dependsOn?: string[] }> {
  const meta: Record<string, { idKey?: string; fields?: string[]; dependsOn?: string[] }> = {};
  const props = schema?.properties;
  if (!props || typeof props !== 'object') {
    return meta;
  }

  for (const key of Object.keys(props)) {
    const def = (props as any)[key];
    if (def?.type !== 'array') {
      continue;
    }

    const idKey = getArrayItemIdentityKey(schema, key);
    const dependsOn = Array.isArray(def?.['x-ztracker-dependsOn'])
      ? def['x-ztracker-dependsOn'].filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
      : typeof def?.['x-ztracker-dependsOn'] === 'string' && def['x-ztracker-dependsOn'].trim().length > 0
        ? [def['x-ztracker-dependsOn'].trim()]
        : undefined;
    const itemProps = def?.items?.type === 'object' ? def?.items?.properties : undefined;
    const fields =
      itemProps && typeof itemProps === 'object'
        ? Object.keys(itemProps).filter((fieldKey) => fieldKey !== idKey && fieldKey !== 'name')
        : undefined;

    meta[key] = { idKey, ...(fields?.length ? { fields } : {}), ...(dependsOn?.length ? { dependsOn } : {}) };
  }

  return meta;
}

/** Captures which tracker details elements are currently expanded so rerenders can preserve UI state. */
export function captureDetailsState(messageId: number): boolean[] {
  const messageBlock = document.querySelector(`.mes[mesid="${messageId}"]`);
  const existingTracker = messageBlock?.querySelector('.mes_ztracker');
  if (!existingTracker) {
    return [];
  }

  const detailsElements = existingTracker.querySelectorAll('details');
  return Array.from(detailsElements).map((detail) => (detail as HTMLDetailsElement).open);
}

/** Restores the expanded/collapsed details state after the tracker DOM is regenerated. */
export function restoreDetailsState(messageId: number, detailsState: boolean[]): void {
  if (!detailsState.length) {
    return;
  }

  const messageBlock = document.querySelector(`.mes[mesid="${messageId}"]`);
  const newTracker = messageBlock?.querySelector('.mes_ztracker');
  if (!newTracker) {
    return;
  }

  const newDetailsElements = newTracker.querySelectorAll('details');
  newDetailsElements.forEach((detail, index) => {
    if (detailsState[index] !== undefined) {
      (detail as HTMLDetailsElement).open = detailsState[index];
    }
  });
}

/** Serializes a tracker snapshot into a system message so regeneration requests can keep surrounding state consistent. */
export function appendCurrentTrackerSnapshot(messages: Message[], tracker: unknown, label: string): void {
  if (!tracker || typeof tracker !== 'object') {
    return;
  }

  try {
    const text = JSON.stringify(tracker, null, 2);
    messages.push({
      role: 'system',
      content: `${label}\n\n\`\`\`json\n${text}\n\`\`\``,
    } as Message);
  } catch {
    // Snapshot injection is best-effort; skip non-serializable structures.
  }
}
type PromptPresetSelectionContextLike = {
  powerUserSettings?: Record<string, unknown> & {
    sysprompt?: {
      name?: unknown;
    } | null;
  };
};

/**
 * Resolves the prompt selectors passed to buildPrompt. Preset, instruct and context names come from
 * the effective connection settings (saved profile, else live); the system prompt is selected only by
 * the Module's System Prompt Source and is independent of which connection is used.
 */
export function getPromptPresetSelections(
  selectedApi: string,
  options: {
    context?: PromptPresetSelectionContextLike;
    effective?: Pick<EffectiveConnectionSettings, 'presetName' | 'instructName' | 'contextName'>;
    trackerSystemPromptMode?: TrackerModuleSettings['trackerSystemPromptMode'];
    trackerSystemPromptName?: string;
  } = {},
) {
  const normalizePromptPresetName = (value: unknown): string | undefined => {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmedValue = value.trim();
    return trimmedValue.length > 0 ? trimmedValue : undefined;
  };

  const activeSystemPromptName = normalizePromptPresetName(options.context?.powerUserSettings?.sysprompt?.name);

  const { presetName, instructName, contextName } = options.effective ?? {};
  const syspromptName = options.trackerSystemPromptMode === 'saved' || options.trackerSystemPromptMode === 'selected'
    ? selectedApi === 'textgenerationwebui'
      ? normalizePromptPresetName(options.trackerSystemPromptName)
      : undefined
    : selectedApi === 'textgenerationwebui'
      ? activeSystemPromptName
      : undefined;

  return {
    ...(presetName ? { presetName } : {}),
    ...(instructName ? { instructName } : {}),
    ...(contextName ? { contextName } : {}),
    ...(syspromptName ? { syspromptName } : {}),
  };
}

/** Applies the shared skip-first-messages guard and optionally emits the manual-call info toast. */
export function shouldSkipTrackerGeneration(
  messageId: number,
  settings: TrackerModuleSettings,
  notify: (message: string) => void,
  silent?: boolean,
): boolean {
  // Coerce defensively: an undefined/malformed skipFirstXMessages makes the comparisons NaN and
  // falls through to "skip", which would silently disable tracker generation on the MESSAGE_SENT
  // hot path. Production sanitizes this to a number; this guards imports and edge cases.
  const skipFirstXMessages = Number(settings.skipFirstXMessages) || 0;
  if (skipFirstXMessages <= 0 || messageId >= skipFirstXMessages) {
    return false;
  }

  if (!silent) {
    notify(`Tracker generation skipped: this message is within the first ${skipFirstXMessages} messages.`);
  }

  return true;
}
