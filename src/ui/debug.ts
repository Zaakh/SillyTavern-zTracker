import type { ExtensionSettings } from '../config.js';
import type { ExtensionSettingsManager } from 'sillytavern-utils-lib';

export function isDebugLoggingEnabled(settingsManager: ExtensionSettingsManager<ExtensionSettings>): boolean {
  try {
    return !!settingsManager.getSettings().debugLogging;
  } catch {
    return false;
  }
}

export function debugLog(settingsManager: ExtensionSettingsManager<ExtensionSettings>, ...args: unknown[]) {
  if (!isDebugLoggingEnabled(settingsManager)) return;
  // eslint-disable-next-line no-console
  console.debug('zTracker:', ...args);
}
