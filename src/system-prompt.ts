import type { TrackerModule, TrackerModuleSettings } from './config.js';

type SystemPromptPreset = {
  name: string;
  content: string;
};

type SystemPromptPresetManager = {
  getCompletionPresetByName(name?: string): SystemPromptPreset | undefined;
  getPresetList(): {
    presets: SystemPromptPreset[] | undefined;
    preset_names: Record<string, number> | string[];
  };
  getAllPresets?: () => string[];
  savePreset?: (name: string, settings: SystemPromptPreset, options?: { skipUpdate?: boolean }) => Promise<unknown>;
  /** Host selection mechanism: option value for a preset name, select it, and read the selected name. */
  findPreset?: (name: string) => unknown;
  selectPreset?: (value: unknown) => void;
  getSelectedPresetName?: () => string;
};

type SillyTavernContextLike = {
  getPresetManager: (apiId?: string) => unknown;
  powerUserSettings?: {
    prefer_character_prompt?: boolean;
    sysprompt?: {
      name?: string;
      enabled?: boolean;
    } | null;
  };
};

function getSystemPromptPresetManager(context: SillyTavernContextLike = SillyTavern.getContext()): SystemPromptPresetManager | null {
  return (context.getPresetManager?.('sysprompt') as SystemPromptPresetManager | undefined) ?? null;
}

export function listSystemPromptPresetNames(context: SillyTavernContextLike = SillyTavern.getContext()): string[] {
  const manager = getSystemPromptPresetManager(context);
  if (!manager) return [];

  const allPresets = manager.getAllPresets?.();
  if (Array.isArray(allPresets) && allPresets.length > 0) {
    return [...new Set(allPresets.filter((name): name is string => typeof name === 'string' && name.length > 0))];
  }

  const presetList = manager.getPresetList?.();
  if (!presetList) return [];

  const { preset_names: presetNames } = presetList;
  if (Array.isArray(presetNames)) {
    return [...new Set(presetNames.filter((name): name is string => typeof name === 'string' && name.length > 0))];
  }

  return [...new Set(Object.keys(presetNames ?? {}))];
}

export function hasSystemPromptPreset(name: string, context: SillyTavernContextLike = SillyTavern.getContext()): boolean {
  const trimmedName = name.trim();
  if (!trimmedName) return false;

  const manager = getSystemPromptPresetManager(context);
  return !!manager?.getCompletionPresetByName(trimmedName);
}

export function getSystemPromptPresetContent(
  name: string,
  context: SillyTavernContextLike = SillyTavern.getContext(),
): string | undefined {
  const trimmedName = name.trim();
  if (!trimmedName) return undefined;

  const content = getSystemPromptPresetManager(context)?.getCompletionPresetByName(trimmedName)?.content?.trim();
  return content || undefined;
}

export function getCurrentGlobalSystemPromptName(
  context: SillyTavernContextLike = SillyTavern.getContext(),
): string | undefined {
  const currentName = context.powerUserSettings?.sysprompt?.name?.trim();
  return currentName || undefined;
}

export function shouldWarnAboutSharedSystemPromptSelection(
  settings: Pick<TrackerModuleSettings, 'trackerSystemPromptMode' | 'trackerSystemPromptSavedName'>,
  context: SillyTavernContextLike = SillyTavern.getContext(),
): boolean {
  if (settings.trackerSystemPromptMode !== 'saved') return false;

  const trackerPromptName = settings.trackerSystemPromptSavedName.trim();
  const globalPromptName = getCurrentGlobalSystemPromptName(context);
  if (!trackerPromptName || !globalPromptName) return false;

  return trackerPromptName.toLowerCase() === globalPromptName.toLowerCase();
}

/**
 * Installs a Module's own referenced system-prompt preset from its persisted `content`, if that
 * Module has content and the preset doesn't already exist. Intended for creation-time calls only
 * (fresh-install seeding, or immediately after a manual Import) - see
 * `checkModuleSystemPromptPresetExists` for the later, non-creating check used elsewhere. Never
 * overwrites an existing preset of the same name; callers that need "recreate even if it once
 * existed" only call this when they know it's safe to do so (creation time, or an explicit
 * user-initiated recreate action).
 */
export async function ensureModuleSystemPromptPresetInstalled(
  module: Pick<TrackerModule, 'systemPrompt'>,
  context: SillyTavernContextLike = SillyTavern.getContext(),
): Promise<boolean> {
  const content = module.systemPrompt.content?.trim();
  if (!content) return false;

  const trimmedName = module.systemPrompt.savedName.trim();
  if (!trimmedName) return false;

  const manager = getSystemPromptPresetManager(context);
  if (!manager?.savePreset) return false;
  if (manager.getCompletionPresetByName(trimmedName)) return false;

  await manager.savePreset(trimmedName, { name: trimmedName, content });
  return true;
}

/**
 * Saves a Module's system-prompt preset unconditionally (explicit user action only, e.g. "Generate
 * prompts") and leaves the user's global system-prompt selection as it was. The host's savePreset
 * selects the saved preset and force-enables system prompts (and with `skipUpdate` the preset stays
 * missing from the in-memory list until reload), so the previous selection and enabled state are
 * restored through the host's own select/checkbox afterwards (openspec: add-llm-schema-generation D10).
 */
export async function overwriteModuleSystemPromptPreset(
  module: Pick<TrackerModule, 'systemPrompt'>,
  context: SillyTavernContextLike = SillyTavern.getContext(),
): Promise<boolean> {
  const content = module.systemPrompt.content?.trim();
  const name = module.systemPrompt.savedName.trim();
  const manager = getSystemPromptPresetManager(context);
  if (!content || !name || !manager?.savePreset) return false;

  const previousName = getCurrentGlobalSystemPromptName(context);
  const wasEnabled = context.powerUserSettings?.sysprompt?.enabled;

  await manager.savePreset(name, { name, content });

  if (previousName && previousName !== name && manager.findPreset && manager.selectPreset) {
    manager.selectPreset(manager.findPreset(previousName));
  }
  const sysprompt = context.powerUserSettings?.sysprompt;
  if (sysprompt && wasEnabled !== undefined && sysprompt.enabled !== wasEnabled) {
    const checkbox = document.getElementById('sysprompt_enabled') as HTMLInputElement | null;
    if (checkbox) {
      checkbox.checked = wasEnabled;
      checkbox.dispatchEvent(new Event('input', { bubbles: true }));
    }
    sysprompt.enabled = wasEnabled;
  }
  return true;
}

/**
 * Reports whether a Module with persisted `content` has a missing referenced preset, without
 * creating it - used by the Settings warning/"recreate" UI so a later missing-preset check never
 * silently recreates (and potentially clobbers a user's SillyTavern-side customization).
 */
export function checkModuleSystemPromptPresetExists(
  module: Pick<TrackerModule, 'systemPrompt'>,
  context: SillyTavernContextLike = SillyTavern.getContext(),
): boolean {
  const content = module.systemPrompt.content?.trim();
  if (!content) return true;

  return hasSystemPromptPreset(module.systemPrompt.savedName, context);
}

export function resolveTrackerSystemPromptName(
  settings: Pick<TrackerModuleSettings, 'trackerSystemPromptMode' | 'trackerSystemPromptSavedName'>,
  context: SillyTavernContextLike = SillyTavern.getContext(),
  profile?: { sysprompt?: string },
): string | undefined {
  if (settings.trackerSystemPromptMode === 'saved') {
    const savedName = settings.trackerSystemPromptSavedName.trim();
    return savedName || undefined;
  }

  // "From connection profile presets" selects only the profile's own system prompt; instruct,
  // context and sampler presets are resolved separately from the connection settings.
  if (settings.trackerSystemPromptMode === 'selected' && profile) {
    const profileName = profile.sysprompt?.trim();
    if (profileName) {
      return profileName;
    }
  }

  return getCurrentGlobalSystemPromptName(context);
}

export function insertSystemPromptMessage<T extends { role: string; content: string }>(messages: T[], content: string): T[] {
  const trimmedContent = content.trim();
  if (!trimmedContent) return [...messages];

  let insertAt = messages.length;
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index].role !== 'system') {
      insertAt = index;
      break;
    }
  }

  return [
    ...messages.slice(0, insertAt),
    { role: 'system', content: trimmedContent } as T,
    ...messages.slice(insertAt),
  ];
}
