import type { ExtensionSettings } from '../config.js';
import { EXTENSION_KEY } from '../config.js';
import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import type { ChatMessage } from 'sillytavern-utils-lib/types';
import { EventNames } from 'sillytavern-utils-lib/types';
import type { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import type { TrackerActions } from './tracker-actions.js';
import { includeZTrackerMessages } from '../tracker.js';
import { st_echo } from 'sillytavern-utils-lib/config';
import {
  shouldAutoGenerateForCharacterMessage,
  shouldAutoGenerateForUserMessage,
} from './character-auto-mode-exclusion.js';
import { createCharacterPanelButtonController } from './character-panel-auto-mode.js';
import { installZTrackerThemeObserver } from './menu-theme.js';
import { createOutgoingAutoModeController } from './outgoing-auto-mode.js';
import { installPartsMenuPortalHandlers } from './parts-menu-portal.js';

const incomingTypes = [AutoModeOptions.RESPONSES, AutoModeOptions.BOTH];
const outgoingTypes = [AutoModeOptions.INPUT, AutoModeOptions.BOTH];

type InitializeGlobalUIOptions = {
  globalContext: any;
  settingsManager: ExtensionSettingsManager<ExtensionSettings>;
  actions: TrackerActions;
  renderTrackerWithDeps: (messageId: number) => void;
};

/** Injects the zTracker per-message action button into SillyTavern's message template. */
function ensureMessageTemplateButton(): void {
  const zTrackerIcon = document.createElement('div');
  zTrackerIcon.title = 'zTracker';
  zTrackerIcon.className = 'mes_button mes_ztracker_button fa-solid fa-truck-moving interactable';
  zTrackerIcon.tabIndex = 0;
  document.querySelector('#message_template .mes_buttons .extraMesButtons')?.prepend(zTrackerIcon);
}

/** Resolves the message id for a click target from either a message row or the active portaled parts menu. */
function resolveMessageIdFromTarget(
  target: HTMLElement,
  getPortaledPartsMessageId: (target: HTMLElement) => number | null,
): number | null {
  const messageElement = target.closest('.mes');
  if (messageElement) {
    const parsedMessageId = Number(messageElement.getAttribute('mesid'));
    return Number.isNaN(parsedMessageId) ? null : parsedMessageId;
  }

  return getPortaledPartsMessageId(target);
}

/** Applies tracker-specific click actions for message buttons and parts-menu controls. */
function installTrackerActionClickHandler(options: {
  actions: TrackerActions;
  getPortaledPartsMessageId: (target: HTMLElement) => number | null;
}): void {
  const { actions, getPortaledPartsMessageId } = options;

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const messageId = resolveMessageIdFromTarget(target, getPortaledPartsMessageId);
    if (messageId === null) {
      return;
    }

    const fieldButton = target.closest('.ztracker-array-item-field-regenerate-button') as HTMLElement | null;
    if (fieldButton) {
      const partKey = fieldButton.getAttribute('data-ztracker-part') ?? '';
      const index = Number(fieldButton.getAttribute('data-ztracker-index') ?? '');
      const name = fieldButton.getAttribute('data-ztracker-name') ?? '';
      const idKey = fieldButton.getAttribute('data-ztracker-idkey') ?? '';
      const idValue = fieldButton.getAttribute('data-ztracker-idvalue') ?? '';
      const fieldKey = fieldButton.getAttribute('data-ztracker-field') ?? '';

      if (partKey && fieldKey && idKey && idValue && 'generateTrackerArrayItemFieldByIdentity' in actions) {
        // @ts-ignore - optional capability depending on build/version.
        actions.generateTrackerArrayItemFieldByIdentity(messageId, partKey, idKey, idValue, fieldKey);
      } else if (partKey && fieldKey && name && 'generateTrackerArrayItemFieldByName' in actions) {
        // @ts-ignore - optional capability depending on build/version.
        actions.generateTrackerArrayItemFieldByName(messageId, partKey, name, fieldKey);
      } else if (partKey && fieldKey && !Number.isNaN(index) && 'generateTrackerArrayItemField' in actions) {
        // @ts-ignore - optional capability depending on build/version.
        actions.generateTrackerArrayItemField(messageId, partKey, index, fieldKey);
      }

      return;
    }

    const itemButton = target.closest('.ztracker-array-item-regenerate-button') as HTMLElement | null;
    if (itemButton) {
      const partKey = itemButton.getAttribute('data-ztracker-part') ?? '';
      const index = Number(itemButton.getAttribute('data-ztracker-index') ?? '');
      const name = itemButton.getAttribute('data-ztracker-name') ?? '';
      const idKey = itemButton.getAttribute('data-ztracker-idkey') ?? '';
      const idValue = itemButton.getAttribute('data-ztracker-idvalue') ?? '';

      if (partKey && idKey && idValue && 'generateTrackerArrayItemByIdentity' in actions) {
        // @ts-ignore - optional capability depending on build/version.
        actions.generateTrackerArrayItemByIdentity(messageId, partKey, idKey, idValue);
      } else if (partKey && name) {
        actions.generateTrackerArrayItemByName(messageId, partKey, name);
      } else if (partKey && !Number.isNaN(index)) {
        actions.generateTrackerArrayItem(messageId, partKey, index);
      }
      return;
    }

    const partButton = target.closest('.ztracker-part-regenerate-button') as HTMLElement | null;
    if (partButton) {
      const partKey = partButton.getAttribute('data-ztracker-part') ?? '';
      if (partKey) {
        actions.generateTrackerPart(messageId, partKey);
      }
      return;
    }

    if (target.classList.contains('mes_ztracker_button')) {
      actions.generateTracker(messageId, { showStatusIndicator: true });
    } else if (target.classList.contains('ztracker-cleanup-button') && 'openTrackerCleanup' in actions) {
      // @ts-ignore - optional capability depending on build/version.
      actions.openTrackerCleanup(messageId);
    } else if (target.classList.contains('ztracker-edit-button')) {
      actions.editTracker(messageId);
    } else if (target.classList.contains('ztracker-regenerate-button')) {
      actions.generateTracker(messageId, { showStatusIndicator: true });
    } else if (target.classList.contains('ztracker-delete-button')) {
      actions.deleteTracker(messageId);
    }
  });
}

/** Rerenders persisted trackers for the active chat and strips any data that no longer matches the template. */
function rerenderTrackersForCurrentChat(options: {
  globalContext: any;
  renderTrackerWithDeps: (messageId: number) => void;
}): void {
  const { globalContext, renderTrackerWithDeps } = options;
  const { saveChat } = globalContext;
  let chatModified = false;

  globalContext.chat.forEach((message: any, messageId: number) => {
    try {
      renderTrackerWithDeps(messageId);
    } catch (error) {
      console.error(`Error rendering zTracker on message ${messageId}, removing data:`, error);
      st_echo('error', 'A zTracker template failed to render. Removing tracker from the message.');
      if (message?.extra?.[EXTENSION_KEY]) {
        delete message.extra[EXTENSION_KEY];
        chatModified = true;
      }
    }
  });

  if (chatModified) {
    saveChat();
  }
}

/** Boots zTracker's document-level UI helpers and wires them to SillyTavern runtime events. */
export async function initializeGlobalUI(options: InitializeGlobalUIOptions) {
  const { globalContext, settingsManager, actions, renderTrackerWithDeps } = options;
  const partsMenuPortal = installPartsMenuPortalHandlers();
  const characterPanelButtons = createCharacterPanelButtonController({ settingsManager });
  const outgoingAutoMode = createOutgoingAutoModeController({ actions });

  if ('setBeforeRequestStartHook' in actions && typeof actions.setBeforeRequestStartHook === 'function') {
    actions.setBeforeRequestStartHook(() => {
      outgoingAutoMode.noteTrackerRequestStart();
    });
  }

  installZTrackerThemeObserver();
  characterPanelButtons.scheduleSync();
  characterPanelButtons.installDomObserver();
  outgoingAutoMode.installDocumentHandlers();
  ensureMessageTemplateButton();
  installTrackerActionClickHandler({
    actions,
    getPortaledPartsMessageId: partsMenuPortal.getMessageIdForTarget,
  });

  await actions.renderExtensionTemplates();
  outgoingAutoMode.syncUi();

  globalContext.eventSource.on(
    EventNames.CHARACTER_MESSAGE_RENDERED,
    (messageId: number) => {
      const settings = settingsManager.getSettings();
      if (!incomingTypes.includes(settings.autoMode)) return;

      const context = SillyTavern.getContext();
      if (!shouldAutoGenerateForCharacterMessage({ chat: context.chat, characters: context.characters }, messageId)) {
        return;
      }

      actions.generateTracker(messageId, { silent: true, showStatusIndicator: false });
    },
  );
  globalContext.eventSource.on(EventNames.USER_MESSAGE_RENDERED, (messageId: number) => {
    outgoingAutoMode.handleUserMessageRendered(messageId);
  });
  globalContext.eventSource.on(
    EventNames.MESSAGE_SENT,
    (messageId: number) => {
      const settings = settingsManager.getSettings();
      if (!outgoingTypes.includes(settings.autoMode)) return;

      const context = SillyTavern.getContext();
      if (!shouldAutoGenerateForUserMessage({ characterId: (context as any).characterId, characters: context.characters })) {
        return;
      }

      const runId = outgoingAutoMode.beginPendingMessage(messageId);
      outgoingAutoMode.tryStopPendingHostGeneration();

      void (async () => {
        try {
          await actions.generateTracker(messageId, { silent: true, showStatusIndicator: false });
        } catch (error) {
          console.error('zTracker auto mode failed to generate a tracker before reply.', error);
        }

        const completion = outgoingAutoMode.finishPendingMessage(messageId, runId);
        if (!completion.finished) {
          return;
        }

        if (!completion.shouldResumeHostGeneration) {
          return;
        }

        await outgoingAutoMode.resumeHostGeneration();
      })();
    },
  );

  globalContext.eventSource.on(EventNames.GENERATION_STARTED, () => {
    outgoingAutoMode.handleGenerationStarted();
  });

  globalContext.eventSource.on(EventNames.CHAT_CHANGED, () => {
    outgoingAutoMode.resetAndSync({ invalidateRun: true });
    characterPanelButtons.scheduleSync();
    rerenderTrackersForCurrentChat({ globalContext, renderTrackerWithDeps });
  });

  (globalThis as any).ztrackerGenerateInterceptor = (chat: ChatMessage[]) => {
    const newChat = includeZTrackerMessages(chat, settingsManager.getSettings());
    chat.length = 0;
    chat.push(...newChat);
  };
}
