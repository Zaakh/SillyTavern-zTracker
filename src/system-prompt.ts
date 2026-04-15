import type { ExtensionSettings } from './config.js';
import { ZTRACKER_SYSTEM_PROMPT_PRESET_NAME, ZTRACKER_SYSTEM_PROMPT_TEXT } from './config.js';

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
};

type SillyTavernContextLike = {
  getPresetManager: (apiId?: string) => unknown;
  powerUserSettings?: {
    prefer_character_prompt?: boolean;
    sysprompt?: {
      name?: string;
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
  settings: Pick<ExtensionSettings, 'trackerSystemPromptMode' | 'trackerSystemPromptSavedName'>,
  context: SillyTavernContextLike = SillyTavern.getContext(),
): boolean {
  if (settings.trackerSystemPromptMode !== 'saved') return false;

  const trackerPromptName = settings.trackerSystemPromptSavedName.trim();
  const globalPromptName = getCurrentGlobalSystemPromptName(context);
  if (!trackerPromptName || !globalPromptName) return false;

  return trackerPromptName.toLowerCase() === globalPromptName.toLowerCase();
}

export async function ensureZTrackerSystemPromptPresetInstalled(
  context: SillyTavernContextLike = SillyTavern.getContext(),
): Promise<boolean> {
  const manager = getSystemPromptPresetManager(context);
  if (!manager?.savePreset) return false;
  if (manager.getCompletionPresetByName(ZTRACKER_SYSTEM_PROMPT_PRESET_NAME)) return false;

  await manager.savePreset(ZTRACKER_SYSTEM_PROMPT_PRESET_NAME, {
    name: ZTRACKER_SYSTEM_PROMPT_PRESET_NAME,
    content: ZTRACKER_SYSTEM_PROMPT_TEXT,
  });

  return true;
}

export function resolveTrackerSystemPromptName(
  settings: Pick<ExtensionSettings, 'trackerSystemPromptMode' | 'trackerSystemPromptSavedName'>,
  context: SillyTavernContextLike = SillyTavern.getContext(),
): string | undefined {
  if (settings.trackerSystemPromptMode === 'saved') {
    const savedName = settings.trackerSystemPromptSavedName.trim();
    return savedName || undefined;
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
