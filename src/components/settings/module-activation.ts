import type { TrackerModule } from '../../config.js';

/** Maps a Module's `enabled`/`auto.enabled` flags onto the single Off / Manual / Auto state shown in settings. */
export type ModuleActivation = 'off' | 'manual' | 'auto';

export const MODULE_ACTIVATION_LABELS: Record<ModuleActivation, string> = { off: 'Off', manual: 'Manual', auto: 'Auto' };

/** Off wins over a stored auto flag, so a disabled Module always reads as Off. */
export function getModuleActivation(module: Pick<TrackerModule, 'enabled' | 'auto'>): ModuleActivation {
  if (!module.enabled) return 'off';
  return module.auto.enabled ? 'auto' : 'manual';
}

/** Writes a chosen state back onto the flags; Off leaves `auto.enabled` untouched so it is remembered. */
export function applyModuleActivation(module: Pick<TrackerModule, 'enabled' | 'auto'>, state: ModuleActivation): void {
  module.enabled = state !== 'off';
  if (state !== 'off') module.auto.enabled = state === 'auto';
}
