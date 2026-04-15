import type { PresetItem } from 'sillytavern-utils-lib/components/react';

// Shared preset-list helpers keep create/rename/delete flows consistent across settings sections.
export function reconcilePresetItems<T extends { name: string }>(
  currentPresets: Record<string, T> | undefined,
  activeKey: string | undefined,
  newItems: PresetItem[],
) {
  const presets = currentPresets ?? {};
  const currentKey = activeKey ?? 'default';
  const fallbackPreset = presets[currentKey] ?? presets['default'] ?? Object.values(presets)[0];
  const nextPresets: Record<string, T> = {};

  newItems.forEach((item) => {
    const sourcePreset = presets[item.value] ?? fallbackPreset;
    if (!sourcePreset) {
      return;
    }

    nextPresets[item.value] = structuredClone(sourcePreset);
    nextPresets[item.value].name = item.label;
  });

  const fallbackKey = nextPresets['default'] ? 'default' : newItems[0]?.value ?? 'default';
  const nextActiveKey = nextPresets[currentKey] ? currentKey : fallbackKey;

  return {
    activeKey: nextActiveKey,
    presets: nextPresets,
  };
}

// Resolves the selected preset from the latest saved state so create/rename flows do not depend on stale renders.
export function resolvePresetSelection<T>(presets: Record<string, T> | undefined, newValue?: string) {
  const key = newValue ?? 'default';
  const preset = presets?.[key];
  if (!preset) {
    return undefined;
  }

  return {
    key,
    preset,
  };
}
