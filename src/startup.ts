/**
 * Chooses and runs the correct settings-initialization path at extension startup: fresh-install
 * starter-Module seeding, or the legacy-settings migration pipeline for an existing install.
 * Extracted from src/index.tsx (which is never imported in tests, per repo convention - see
 * CLAUDE.md) so this branch-selection logic itself is unit-testable.
 */
import type { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import {
  ExtensionSettings,
  migrateCorruptedSchemaPresetRequiredMetadata,
  migrateInvalidNumericSettings,
  migrateLegacyAutoMode,
  migrateLegacyPromptTemplates,
  migrateLegacySettingsToModules,
  migrateTrackerModuleAutoSettings,
  migrateTrackerModuleIncludeLists,
  migrateTrackerModuleSystemPromptContent,
} from './config.js';
import { seedStarterTrackerModules } from './fresh-install-seeding.js';

/**
 * Runs once per extension load, before any settings-dependent UI renders. `isFreshInstall`
 * (from `initializeSettings().oldSettings === null`) selects the path:
 * - Fresh install: seed the shipped starter templates. A seeding failure is caught and logged
 *   here rather than propagated, since it is non-fatal - the existing read-time zero-Modules
 *   recovery fallback (see `getTrackerModule()`) keeps the extension usable either way.
 * - Upgrading install: run the legacy-settings migration pipeline. A failure here propagates to
 *   the caller (matching prior behavior in src/index.tsx, where it surfaced as a data-migration
 *   error toast) since a failed migration can leave settings in an inconsistent state worth
 *   surfacing loudly.
 */
export async function initializeStartupSettings(options: {
  isFreshInstall: boolean;
  settingsManager: Pick<ExtensionSettingsManager<ExtensionSettings>, 'getSettings' | 'saveSettings'>;
  importMetaUrl: string;
}): Promise<void> {
  if (options.isFreshInstall) {
    try {
      await seedStarterTrackerModules({ settingsManager: options.settingsManager, importMetaUrl: options.importMetaUrl });
    } catch (error) {
      console.warn('zTracker: failed to seed starter Module templates on fresh install.', error);
    }
    return;
  }

  const settings = options.settingsManager.getSettings();
  // Order matters: migrateTrackerModuleAutoSettings, migrateTrackerModuleIncludeLists, and
  // migrateTrackerModuleSystemPromptContent read/write settings.modules, so they must run after
  // migrateLegacySettingsToModules has populated that collection (array evaluation order below is
  // what enforces this - do not reorder or run these independently).
  const didMigrateLegacySettings = [
    migrateLegacyAutoMode(settings),
    migrateLegacyPromptTemplates(settings),
    migrateCorruptedSchemaPresetRequiredMetadata(settings),
    migrateInvalidNumericSettings(settings),
    migrateLegacySettingsToModules(settings),
    migrateTrackerModuleAutoSettings(settings),
    migrateTrackerModuleIncludeLists(settings),
    migrateTrackerModuleSystemPromptContent(settings),
  ].some(Boolean);

  if (didMigrateLegacySettings) {
    options.settingsManager.saveSettings();
  }
}
