import type { ExtensionSettings } from '../config.js';
import { EXTENSION_KEY } from '../config.js';
import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import type { ChatMessage } from 'sillytavern-utils-lib/types';
import { EventNames } from 'sillytavern-utils-lib/types';
import type { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import type { TrackerActions } from './tracker-actions.js';
import { includeZTrackerMessages } from '../tracker.js';
import { st_echo } from 'sillytavern-utils-lib/config';

const incomingTypes = [AutoModeOptions.RESPONSES, AutoModeOptions.BOTH];
const outgoingTypes = [AutoModeOptions.INPUT, AutoModeOptions.BOTH];

export async function initializeGlobalUI(options: {
  globalContext: any;
  settingsManager: ExtensionSettingsManager<ExtensionSettings>;
  actions: TrackerActions;
  renderTrackerWithDeps: (messageId: number) => void;
}) {
  const { globalContext, settingsManager, actions, renderTrackerWithDeps } = options;

  const zTrackerIcon = document.createElement('div');
  zTrackerIcon.title = 'zTracker';
  zTrackerIcon.className = 'mes_button mes_ztracker_button fa-solid fa-truck-moving interactable';
  zTrackerIcon.tabIndex = 0;
  document.querySelector('#message_template .mes_buttons .extraMesButtons')?.prepend(zTrackerIcon);

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const messageEl = target.closest('.mes');

    if (!messageEl) return;
    const messageId = Number(messageEl.getAttribute('mesid'));
    if (isNaN(messageId)) return;

    const itemButton = target.closest('.ztracker-array-item-regenerate-button') as HTMLElement | null;
    if (itemButton) {
      const partKey = itemButton.getAttribute('data-ztracker-part') ?? '';
      const indexText = itemButton.getAttribute('data-ztracker-index') ?? '';
      const index = Number(indexText);
      const name = itemButton.getAttribute('data-ztracker-name') ?? '';
      const idKey = itemButton.getAttribute('data-ztracker-idkey') ?? '';
      const idValue = itemButton.getAttribute('data-ztracker-idvalue') ?? '';

      if (partKey && idKey && idValue && 'generateTrackerArrayItemByIdentity' in actions) {
        // @ts-ignore - optional capability depending on build/version.
        actions.generateTrackerArrayItemByIdentity(messageId, partKey, idKey, idValue);
      } else if (partKey && name) {
        actions.generateTrackerArrayItemByName(messageId, partKey, name);
      } else if (partKey && !isNaN(index)) {
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
      actions.generateTracker(messageId);
    } else if (target.classList.contains('ztracker-edit-button')) {
      actions.editTracker(messageId);
    } else if (target.classList.contains('ztracker-regenerate-button')) {
      actions.generateTracker(messageId);
    } else if (target.classList.contains('ztracker-delete-button')) {
      actions.deleteTracker(messageId);
    }
  });

  await actions.renderExtensionTemplates();

  const settings = settingsManager.getSettings();
  globalContext.eventSource.on(
    EventNames.CHARACTER_MESSAGE_RENDERED,
    (messageId: number) => incomingTypes.includes(settings.autoMode) && actions.generateTracker(messageId),
  );
  globalContext.eventSource.on(
    EventNames.USER_MESSAGE_RENDERED,
    (messageId: number) => outgoingTypes.includes(settings.autoMode) && actions.generateTracker(messageId),
  );

  globalContext.eventSource.on(EventNames.CHAT_CHANGED, () => {
    const { saveChat } = globalContext;
    let chatModified = false;
    globalContext.chat.forEach((message: any, i: number) => {
      try {
        renderTrackerWithDeps(i);
      } catch (error) {
        console.error(`Error rendering zTracker on message ${i}, removing data:`, error);
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
  });

  (globalThis as any).ztrackerGenerateInterceptor = (chat: ChatMessage[]) => {
    const newChat = includeZTrackerMessages(chat, settingsManager.getSettings());
    chat.length = 0;
    chat.push(...newChat);
  };
}
