import { ExtensionSettings } from '../../config.js';

// Shared settings-section types keep the extracted settings components consistent without repeating the same prop signatures.
export type SettingsUpdateAndRefresh = (updater: (current: ExtensionSettings) => void) => void;

export interface SettingsSectionProps {
  settings: ExtensionSettings;
  updateAndRefresh: SettingsUpdateAndRefresh;
}