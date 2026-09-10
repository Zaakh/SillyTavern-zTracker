/**
 * Fresh-install-only Module seeding: on an install with no prior settings, builds the starter
 * Module collection from the shipped templates under templates/modules/ (see
 * openspec/changes/seed-starter-modules) instead of relying on a hardcoded default Module.
 * Reuses the same import-construction path the Settings "Import" button already uses, so a
 * seeded Module is indistinguishable from one a user imported by hand.
 */
import type { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import { st_echo } from 'sillytavern-utils-lib/config';
import { createImportedTrackerModule, parseImportedTrackerModule } from './components/settings/module-import.js';
import { defaultSettings, ExtensionSettings, extensionName, TrackerModule } from './config.js';
import { EXTENSION_KEY } from './extension-metadata.js';
import { getThirdPartyExtensionBasePath } from './extension-install.js';
import { ensureModuleSystemPromptPresetInstalled } from './system-prompt.js';

// Fixed seed order: Plot Steer's chained include-list entry targets Plot Log by id, and chaining
// eligibility requires the target Module's generation order to be strictly earlier (see
// tracker-module-chaining.ts) - createImportedTrackerModule assigns order from array position, so
// this order must be preserved.
const STARTER_TEMPLATE_NAMES = ['scene-tracker', 'plot-log', 'plot-steer'] as const;
const ENABLED_BY_DEFAULT_TEMPLATE = 'scene-tracker';

type SillyTavernContextLike = {
  extensionSettings: Record<string, any>;
};

async function fetchStarterTemplateText(
  templateName: string,
  importMetaUrl: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const basePath = getThirdPartyExtensionBasePath({ importMetaUrl, fallbackFolderName: extensionName });
  const url = new URL(`${basePath}/dist/templates/modules/${templateName}.json`, window.location.origin).toString();
  const response = await fetchImpl(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${templateName}.json (status ${response.status})`);
  }
  return response.text();
}

/**
 * Seeds `settings.modules` from the shipped starter templates, best-effort per template. Only
 * `scene-tracker` is enabled; every other seeded Module is disabled. If every template fails,
 * `settings.modules` stays empty - the existing read-time recovery fallback in
 * getTrackerModule()/getOrderedTrackerModules() covers that case, so no new fallback is added here.
 */
export async function seedStarterTrackerModules(options: {
  settingsManager: Pick<ExtensionSettingsManager<ExtensionSettings>, 'getSettings' | 'saveSettings'>;
  importMetaUrl: string;
  context?: SillyTavernContextLike;
  fetchImpl?: typeof fetch;
  stEcho?: typeof st_echo;
}): Promise<TrackerModule[]> {
  const context = options.context ?? SillyTavern.getContext();
  const fetchImpl = options.fetchImpl ?? fetch;
  const stEchoImpl = options.stEcho ?? st_echo;

  // Decouple live settings from the shared `defaultSettings` constant before any mutation, since
  // ExtensionSettingsManager assigns it by reference on a fresh install.
  context.extensionSettings[EXTENSION_KEY] = structuredClone(defaultSettings);

  const settings = options.settingsManager.getSettings();
  const seededModules: TrackerModule[] = [];

  for (const templateName of STARTER_TEMPLATE_NAMES) {
    try {
      const text = await fetchStarterTemplateText(templateName, options.importMetaUrl, fetchImpl);
      const imported = parseImportedTrackerModule(text);
      if (!imported) {
        throw new Error(`${templateName}.json did not parse as an importable Module`);
      }
      const module = createImportedTrackerModule(imported, seededModules);
      module.enabled = templateName === ENABLED_BY_DEFAULT_TEMPLATE;
      seededModules.push(module);
    } catch (error) {
      console.warn(`zTracker: failed to seed starter template "${templateName}.json".`, error);
    }
  }

  settings.modules = seededModules;
  options.settingsManager.saveSettings();

  for (const module of seededModules) {
    try {
      await ensureModuleSystemPromptPresetInstalled(module);
    } catch (error) {
      console.warn(`zTracker: failed to install the system prompt preset for seeded Module "${module.id}".`, error);
    }
  }

  // Surface a degraded setup to the user instead of leaving it discoverable only via the console -
  // full failure additionally relies on the existing read-time zero-Modules recovery fallback to
  // keep the extension usable (see getTrackerModule()), so this is informational, not a hard error.
  if (seededModules.length === 0) {
    await stEchoImpl(
      'warning',
      'zTracker could not automatically set up its starter trackers. You can add or import a Module manually in Settings.',
    );
  } else if (seededModules.length < STARTER_TEMPLATE_NAMES.length) {
    await stEchoImpl(
      'warning',
      'zTracker could not set up all of its starter trackers. Check the browser console for details, or import the missing one(s) manually in Settings.',
    );
  }

  return seededModules;
}
