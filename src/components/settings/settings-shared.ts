import { ExtensionSettings, TrackerModuleSettings } from '../../config.js';

// Shared settings-section types keep the extracted settings components consistent without repeating the same prop signatures.
export type SettingsUpdateAndRefresh = (updater: (current: TrackerModuleSettings) => void) => void;

/** Writes to the extension-wide settings (e.g. the global transform preset list) rather than one Module's draft. */
export type SettingsUpdateGlobal = (updater: (current: ExtensionSettings) => void) => void;

export interface SettingsSectionProps {
  settings: TrackerModuleSettings;
  updateAndRefresh: SettingsUpdateAndRefresh;
}