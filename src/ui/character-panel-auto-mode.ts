import type { ExtensionSettings } from '../config.js';
import { getOrderedTrackerModules } from '../config.js';
import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import type { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import { st_echo } from 'sillytavern-utils-lib/config';
import { syncCharacterAutoModeButton } from './character-auto-mode-exclusion.js';

/** Keeps the character-card auto-mode exclusion button synced with the live host panel DOM. */
export function createCharacterPanelButtonController(options: {
  settingsManager: ExtensionSettingsManager<ExtensionSettings>;
}) {
  const { settingsManager } = options;
  let characterPanelButtonSyncTimer: number | undefined;
  let observedCharacterPanel: HTMLElement | null = null;
  let characterPanelObserver: MutationObserver | null = null;

  /** Reattaches the narrow observer that watches the active character panel subtree. */
  const attachCharacterPanelObserver = () => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return;
    }

    const nextPanel = document.querySelector('#form_create');
    const characterPanel = nextPanel instanceof HTMLElement ? nextPanel : null;
    if (characterPanel === observedCharacterPanel) {
      return;
    }

    characterPanelObserver?.disconnect();
    observedCharacterPanel = characterPanel;
    if (!observedCharacterPanel) {
      characterPanelObserver = null;
      return;
    }

    characterPanelObserver = new MutationObserver(() => scheduleSync());
    characterPanelObserver.observe(observedCharacterPanel, { childList: true, subtree: true });
  };

  /** Debounces host-panel churn before refreshing the exclusion toggle button. */
  const scheduleSync = () => {
    if (typeof document === 'undefined') {
      return;
    }

    if (characterPanelButtonSyncTimer) {
      window.clearTimeout(characterPanelButtonSyncTimer);
    }

    characterPanelButtonSyncTimer = window.setTimeout(() => {
      characterPanelButtonSyncTimer = undefined;
      attachCharacterPanelObserver();
      // Both getters re-read settingsManager.getSettings() at call time (sync AND click), not
      // just when this timeout fires, so the toggle never freezes on a Module list captured
      // before Modules were added/removed/reordered while the panel stayed open.
      // Write scope includes disabled Modules to preserve exclusion intent if re-enabled later;
      // read scope (display + toggle direction) is enabled-only so the button describes the
      // character's actual current auto-mode exposure, not a Module that cannot generate anyway.
      const getModuleIds = () => getOrderedTrackerModules(settingsManager.getSettings(), { includeDisabled: true }).map((module) => module.id);
      const getReadModuleIds = () => getOrderedTrackerModules(settingsManager.getSettings()).map((module) => module.id);
      syncCharacterAutoModeButton({
        getContext: () => SillyTavern.getContext(),
        autoModeEnabled: getOrderedTrackerModules(settingsManager.getSettings()).some((module) => module.auto.enabled && module.auto.mode !== AutoModeOptions.NONE),
        getModuleIds,
        getReadModuleIds,
        onToggle: ({ excluded }) => {
          st_echo('info', excluded ? 'zTracker auto mode excluded for this character.' : 'zTracker auto mode restored for this character.');
        },
      });
    }, 20);
  };

  /** Watches for the host swapping the character panel so the button can be re-injected. */
  const installDomObserver = () => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return;
    }

    attachCharacterPanelObserver();
    const observer = new MutationObserver((mutations) => {
      const characterPanelChanged = mutations.some((mutation) =>
        [...mutation.addedNodes, ...mutation.removedNodes].some(
          (node) => node instanceof Element && (node.id === 'form_create' || !!node.querySelector('#form_create')),
        ),
      );
      if (!characterPanelChanged) {
        return;
      }

      attachCharacterPanelObserver();
      scheduleSync();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  return {
    installDomObserver,
    scheduleSync,
  };
}