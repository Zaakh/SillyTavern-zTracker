import { TrackerModuleSettings } from '../../config.js';

// Shared settings-section types keep the extracted settings components consistent without repeating the same prop signatures.
export type SettingsUpdateAndRefresh = (updater: (current: TrackerModuleSettings) => void) => void;

export interface SettingsSectionProps {
  settings: TrackerModuleSettings;
  updateAndRefresh: SettingsUpdateAndRefresh;
}