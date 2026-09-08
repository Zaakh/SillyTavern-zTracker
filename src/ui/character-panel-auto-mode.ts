import type { ExtensionSettings } from '../config.js';
import { getOrderedTrackerModules } from '../config.js';
import type { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import { st_echo } from 'sillytavern-utils-lib/config';
import { closeActiveOverridePopup, getCurrentCharacterId, syncCharacterAutoModeButton } from './character-auto-mode-exclusion.js';

/** Keeps the character-card auto-mode exclusion button synced with the live host panel DOM. */
export function createCharacterPanelButtonController(options: {
  settingsManager: ExtensionSettingsManager<ExtensionSettings>;
}) {
  const { settingsManager } = options;
  let characterPanelButtonSyncTimer: number | undefined;
  let observedCharacterPanel: HTMLElement | null = null;
  let characterPanelObserver: MutationObserver | null = null;
  // Tracks which character the multi-Module override popup (if open) currently displays, so a
  // panel mutation that swaps the active character (without an intervening outside click, which
  // is the popup's only other close trigger) closes the now-stale popup instead of letting a
  // click on it silently write the override to the wrong character.
  let lastSyncedCharacterId: number | undefined;

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

      // A panel mutation (this timeout's trigger) can mean the host swapped which character is
      // active, e.g. re-populating the panel in place without removing/re-adding #form_create.
      // If an override popup is open and still showing the previous character, close it now
      // rather than risk a stale click writing an override to the wrong character.
      const currentCharacterId = getCurrentCharacterId(SillyTavern.getContext() as any);
      if (currentCharacterId !== lastSyncedCharacterId) {
        closeActiveOverridePopup();
      }
      lastSyncedCharacterId = currentCharacterId;

      // Re-reads settingsManager.getSettings() at call time (sync AND click), not just when this
      // timeout fires, so the control never freezes on a Module list captured before Modules
      // were added/removed/reordered while the panel stayed open. Includes disabled Modules so a
      // per-character override can be pre-configured before that Module is re-enabled.
      const getModules = () => getOrderedTrackerModules(settingsManager.getSettings(), { includeDisabled: true });
      syncCharacterAutoModeButton({
        getContext: () => SillyTavern.getContext(),
        getModules,
        onOverrideChange: ({ moduleId, override }) => {
          st_echo('info', `zTracker auto mode for "${moduleId}" set to "${override}" for this character.`);
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