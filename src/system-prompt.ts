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
};

type ConnectionProfileLike = {
  sysprompt?: string;
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
  profile?: ConnectionProfileLike,
): string | undefined {
  if (settings.trackerSystemPromptMode === 'saved') {
    const savedName = settings.trackerSystemPromptSavedName.trim();
    return savedName || undefined;
  }

  const profilePromptName = profile?.sysprompt?.trim();
  return profilePromptName || undefined;
}

export function shouldForceTrackerSystemPromptSelection(
  settings: Pick<ExtensionSettings, 'trackerSystemPromptMode' | 'trackerSystemPromptSavedName'>,
): boolean {
  return settings.trackerSystemPromptMode === 'saved' && settings.trackerSystemPromptSavedName.trim().length > 0;
}
