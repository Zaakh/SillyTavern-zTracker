import type { ExtensionSettings } from '../config.js';
import { DEFAULT_MODULE_ID, EXTENSION_KEY, getOrderedTrackerModules, getSettingsForTrackerModule } from '../config.js';
import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import type { ChatMessage } from 'sillytavern-utils-lib/types';
import { EventNames } from 'sillytavern-utils-lib/types';
import type { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import type { TrackerActions } from './tracker-actions.js';
import { includeZTrackerMessages } from '../tracker.js';
import { selected_group, st_echo } from 'sillytavern-utils-lib/config';
import {
  getCurrentCharacterId,
  shouldAutoGenerateForCharacterMessage,
  shouldAutoGenerateForUserMessage,
} from './character-auto-mode-exclusion.js';
import { createCharacterPanelButtonController } from './character-panel-auto-mode.js';
import { installZTrackerThemeObserver } from './menu-theme.js';
import { clearMessageStatusIndicator, RENDER_ERROR_STATUS_CLASS, syncMessageStatusIndicator } from './message-status-indicator.js';
import { createOutgoingAutoModeController } from './outgoing-auto-mode.js';
import { installPartsMenuPortalHandlers } from './parts-menu-portal.js';
import { shouldSkipTrackerGeneration } from './tracker-action-helpers.js';

const incomingTypes = [AutoModeOptions.RESPONSES, AutoModeOptions.BOTH];
const outgoingTypes = [AutoModeOptions.INPUT, AutoModeOptions.BOTH];

function getDueAutoModuleIds(options: {
  settings: ExtensionSettings;
  messageId: number;
  characterContext: Parameters<typeof shouldAutoGenerateForUserMessage>[0];
  direction: 'incoming' | 'outgoing';
}): string[] {
  return getOrderedTrackerModules(options.settings)
    .filter((module) => module.auto.enabled)
    .filter((module) => (options.direction === 'incoming' ? incomingTypes : outgoingTypes).includes(module.auto.mode))
    .filter((module) => (
      options.direction === 'incoming'
        ? shouldAutoGenerateForCharacterMessage(options.characterContext, options.messageId, module.id)
        : shouldAutoGenerateForUserMessage(options.characterContext, module.id)
    ))
    .filter((module) => !shouldSkipTrackerGeneration(
      options.messageId,
      getSettingsForTrackerModule(options.settings, module.id),
      () => {},
      true,
    ))
    .map((module) => module.id);
}

/** Returns whether any configured Module wants automatic generation for one host event direction. */
function hasAutoModuleForDirection(settings: ExtensionSettings, directionModes: AutoModeOptions[]): boolean {
  return getOrderedTrackerModules(settings).some((module) => module.auto.enabled && directionModes.includes(module.auto.mode));
}

function generateDueAutoModules(actions: TrackerActions, messageId: number, moduleIds: string[]) {
  if (typeof actions.generateTrackersForMessage === 'function') {
    return actions.generateTrackersForMessage(messageId, {
      silent: true,
      showStatusIndicator: false,
      autoOnly: true,
      moduleIds,
    });
  }

  return actions.generateTracker(messageId, { silent: true, showStatusIndicator: false });
}

type InitializeGlobalUIOptions = {
  globalContext: any;
  settingsManager: ExtensionSettingsManager<ExtensionSettings>;
  actions: TrackerActions;
  renderTrackerWithDeps: (messageId: number) => void;
};

type GenerateInterceptorContext = {
  mainApi?: string;
  selected_group?: string | false;
  name2?: string;
  characterId?: unknown;
  characters?: Array<{
    avatar?: string;
    data?: Record<string, unknown> & {
      extensions?: Record<string, unknown>;
    };
    name?: string;
  }>;
};

let themeObserverInstalled = false;
let characterPanelObserverInstalled = false;
let trackerActionClickHandlerInstalled = false;

const registeredHostEventSources = new WeakSet<object>();

let activeTrackerActionHandler: {
  actions: TrackerActions;
  settingsManager: ExtensionSettingsManager<ExtensionSettings>;
  getPortaledPartsMessageId: (target: HTMLElement) => number | null;
} | null = null;

let activeManualModuleMenu: HTMLElement | null = null;

function normalizeSpeakerLabel(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

// Prefers the host-owned solo-chat speaker label over local history inference.
function resolveAssistantReplyLabel(context: GenerateInterceptorContext): string | undefined {
  const contextLabel = normalizeSpeakerLabel(context.name2);
  if (contextLabel) {
    return contextLabel;
  }

  const characterId = getCurrentCharacterId(context);
  if (characterId === undefined || !Array.isArray(context.characters)) {
    return undefined;
  }

  return normalizeSpeakerLabel(context.characters[characterId]?.name);
}

/** Injects the zTracker per-message action button into SillyTavern's message template. */
function ensureMessageTemplateButton(): void {
  if (document.querySelector('#message_template .mes_buttons .extraMesButtons .mes_ztracker_button')) {
    return;
  }

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

/** Resolves which rendered tracker module owns one clicked control. */
function resolveModuleIdFromTarget(target: HTMLElement): string {
  const moduleElement = target.closest('[data-ztracker-module]') as HTMLElement | null;
  return moduleElement?.dataset.ztrackerModule || DEFAULT_MODULE_ID;
}

/** Builds an optional action argument for non-default module controls. */
function getModuleActionArgs(moduleId: string): [string] | [] {
  return moduleId === DEFAULT_MODULE_ID ? [] : [moduleId];
}

/** Adds a module id to action options only when a non-default tracker owns the control. */
function withModuleActionOption<T extends Record<string, unknown>>(options: T, moduleId: string): T & { moduleId?: string } {
  return moduleId === DEFAULT_MODULE_ID ? options : { ...options, moduleId };
}

/** Closes the message-level manual Module chooser, if it is open. */
function closeManualModuleMenu(): void {
  activeManualModuleMenu?.remove();
  activeManualModuleMenu = null;
}

/** Places the manual Module chooser next to the message truck button. */
function positionManualModuleMenu(menu: HTMLElement, button: HTMLElement): void {
  const rect = button.getBoundingClientRect();
  const viewportMargin = 8;
  const width = Math.max(menu.offsetWidth, 180);
  const left = Math.max(
    window.scrollX + viewportMargin,
    Math.min(rect.right + window.scrollX - width, window.scrollX + window.innerWidth - viewportMargin - width),
  );
  const top = rect.bottom + window.scrollY + 6;

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

/** Lets the truck button target any enabled Module when multiple Modules are available. */
function openManualModuleMenu(options: {
  actions: TrackerActions;
  button: HTMLElement;
  messageId: number;
  settings: ExtensionSettings;
}): void {
  const modules = getOrderedTrackerModules(options.settings);
  if (modules.length === 0) {
    st_echo('warning', 'No zTracker Modules are enabled. Enable a Module before generating a tracker.');
    return;
  }

  if (modules.length <= 1) {
    const moduleId = modules[0]?.id ?? DEFAULT_MODULE_ID;
    options.actions.generateTracker(options.messageId, withModuleActionOption({ showStatusIndicator: true }, moduleId));
    return;
  }

  closeManualModuleMenu();

  const menu = document.createElement('div');
  menu.className = 'ztracker-module-generate-menu';
  menu.setAttribute('role', 'menu');
  menu.style.position = 'absolute';
  menu.style.visibility = 'hidden';
  menu.style.zIndex = '2147483647';

  for (const module of modules) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ztracker-module-generate-option menu_button';
    item.dataset.ztrackerModule = module.id;
    item.textContent = module.name || module.id;
    item.title = `Generate ${module.name || module.id}`;
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      closeManualModuleMenu();
      options.actions.generateTracker(
        options.messageId,
        withModuleActionOption({ showStatusIndicator: true }, module.id),
      );
    });
    menu.append(item);
  }

  document.body.append(menu);
  activeManualModuleMenu = menu;
  positionManualModuleMenu(menu, options.button);
  menu.style.visibility = '';
}

/** Applies tracker-specific click actions for message buttons and parts-menu controls. */
function installTrackerActionClickHandler(): void {
  if (trackerActionClickHandlerInstalled) {
    return;
  }

  document.addEventListener('click', (event) => {
    const runtime = activeTrackerActionHandler;
    if (!runtime) {
      return;
    }

    const target = event.target as HTMLElement;
    const messageId = resolveMessageIdFromTarget(target, runtime.getPortaledPartsMessageId);
    if (messageId === null) {
      return;
    }

    const { actions } = runtime;
    const moduleId = resolveModuleIdFromTarget(target);
    const moduleArgs = getModuleActionArgs(moduleId);

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
        actions.generateTrackerArrayItemFieldByIdentity(messageId, partKey, idKey, idValue, fieldKey, ...moduleArgs);
      } else if (partKey && fieldKey && name && 'generateTrackerArrayItemFieldByName' in actions) {
        // @ts-ignore - optional capability depending on build/version.
        actions.generateTrackerArrayItemFieldByName(messageId, partKey, name, fieldKey, ...moduleArgs);
      } else if (partKey && fieldKey && !Number.isNaN(index) && 'generateTrackerArrayItemField' in actions) {
        // @ts-ignore - optional capability depending on build/version.
        actions.generateTrackerArrayItemField(messageId, partKey, index, fieldKey, ...moduleArgs);
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
        actions.generateTrackerArrayItemByIdentity(messageId, partKey, idKey, idValue, ...moduleArgs);
      } else if (partKey && name) {
        actions.generateTrackerArrayItemByName(messageId, partKey, name, ...moduleArgs);
      } else if (partKey && !Number.isNaN(index)) {
        actions.generateTrackerArrayItem(messageId, partKey, index, ...moduleArgs);
      }
      return;
    }

    const partButton = target.closest('.ztracker-part-regenerate-button') as HTMLElement | null;
    if (partButton) {
      const partKey = partButton.getAttribute('data-ztracker-part') ?? '';
      if (partKey) {
        actions.generateTrackerPart(messageId, partKey, ...moduleArgs);
      }
      return;
    }

    if (target.classList.contains('mes_ztracker_button')) {
      openManualModuleMenu({
        actions,
        button: target,
        messageId,
        settings: runtime.settingsManager.getSettings(),
      });
    } else if (target.classList.contains('ztracker-cleanup-button') && 'openTrackerCleanup' in actions) {
      // @ts-ignore - optional capability depending on build/version.
      actions.openTrackerCleanup(messageId, ...moduleArgs);
    } else if (target.classList.contains('ztracker-edit-button')) {
      actions.editTracker(messageId, ...moduleArgs);
    } else if (target.classList.contains('ztracker-regenerate-button')) {
      actions.generateTracker(messageId, withModuleActionOption({ showStatusIndicator: true }, moduleId));
    } else if (target.classList.contains('ztracker-delete-button')) {
      actions.deleteTracker(messageId, ...moduleArgs);
    }
  });

  document.addEventListener('mousedown', (event) => {
    if (!activeManualModuleMenu || activeManualModuleMenu.contains(event.target as Node)) {
      return;
    }

    closeManualModuleMenu();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeManualModuleMenu();
    }
  }, true);

  trackerActionClickHandlerInstalled = true;
}

/** Rerenders persisted trackers for the active chat and strips any data that no longer matches the template. */
function rerenderTrackersForCurrentChat(options: {
  globalContext: any;
  renderTrackerWithDeps: (messageId: number) => void;
}): void {
  const { globalContext, renderTrackerWithDeps } = options;
  let hadRenderError = false;
  clearMessageStatusIndicator({ statusClassName: RENDER_ERROR_STATUS_CLASS });

  globalContext.chat.forEach((_message: any, messageId: number) => {
    try {
      renderTrackerWithDeps(messageId);
    } catch (error) {
      hadRenderError = true;
      console.error(`Error rendering zTracker on message ${messageId}, keeping stored data:`, error);
      syncMessageStatusIndicator({
        messageId,
        text: 'zTracker failed to render. Stored data was kept.',
        statusClassName: RENDER_ERROR_STATUS_CLASS,
        iconClassName: 'ztracker-message-status-icon ztracker-message-status-icon--static fa-solid fa-triangle-exclamation',
      });
    }
  });

  if (hadRenderError) {
    st_echo('error', 'A zTracker template failed to render for one or more messages. Tracker data was kept.');
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

  if (!themeObserverInstalled) {
    installZTrackerThemeObserver();
    themeObserverInstalled = true;
  }

  characterPanelButtons.scheduleSync();
  if (!characterPanelObserverInstalled) {
    characterPanelButtons.installDomObserver();
    characterPanelObserverInstalled = true;
  }

  outgoingAutoMode.installDocumentHandlers();

  ensureMessageTemplateButton();
  activeTrackerActionHandler = {
    actions,
    settingsManager,
    getPortaledPartsMessageId: partsMenuPortal.getMessageIdForTarget,
  };
  installTrackerActionClickHandler();

  await actions.renderExtensionTemplates();
  outgoingAutoMode.syncUi();

  const eventSource = globalContext?.eventSource;
  if (eventSource && !registeredHostEventSources.has(eventSource as object)) {
    globalContext.eventSource.on(
      EventNames.CHARACTER_MESSAGE_RENDERED,
      (messageId: number) => {
        const settings = settingsManager.getSettings();
        if (!hasAutoModuleForDirection(settings, incomingTypes)) return;

        const context = SillyTavern.getContext();
        const moduleIds = getDueAutoModuleIds({
          settings,
          messageId,
          characterContext: { chat: context.chat, characters: context.characters },
          direction: 'incoming',
        });
        if (moduleIds.length === 0) {
          return;
        }

        generateDueAutoModules(actions, messageId, moduleIds);
      },
    );
    globalContext.eventSource.on(EventNames.USER_MESSAGE_RENDERED, (messageId: number) => {
      outgoingAutoMode.handleUserMessageRendered(messageId);
    });
    globalContext.eventSource.on(
      EventNames.MESSAGE_SENT,
      (messageId: number) => {
        const settings = settingsManager.getSettings();
        if (!hasAutoModuleForDirection(settings, outgoingTypes)) return;

        const context = SillyTavern.getContext();
        const moduleIds = getDueAutoModuleIds({
          settings,
          messageId,
          characterContext: { characterId: (context as any).characterId, characters: context.characters },
          direction: 'outgoing',
        });
        if (moduleIds.length === 0) {
          return;
        }

        const runId = outgoingAutoMode.beginPendingMessage(messageId);
        outgoingAutoMode.tryStopPendingHostGeneration();

        void (async () => {
          try {
            await generateDueAutoModules(actions, messageId, moduleIds);
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

    registeredHostEventSources.add(eventSource as object);
  }

  (globalThis as any).ztrackerGenerateInterceptor = (chat: ChatMessage[]) => {
    const textCompletionSafeContext = SillyTavern.getContext() as GenerateInterceptorContext;
    const isGroupChat = Boolean(textCompletionSafeContext?.selected_group ?? selected_group);
    const settings = settingsManager.getSettings();
    const interceptorOptions = {
      preserveTextCompletionTurnAlternation: textCompletionSafeContext?.mainApi === 'textgenerationwebui',
      isGroupChat,
      assistantReplyLabel: isGroupChat ? undefined : resolveAssistantReplyLabel(textCompletionSafeContext),
    };
    let newChat = chat;
    for (const module of [...getOrderedTrackerModules(settings)].reverse()) {
      const moduleSettings = getSettingsForTrackerModule(settings, module.id);
      if (moduleSettings.includeLastXZTrackerMessages <= 0) {
        continue;
      }

      newChat = includeZTrackerMessages(newChat, moduleSettings, {
        ...interceptorOptions,
        moduleId: module.id,
      });
    }
    chat.length = 0;
    chat.push(...newChat);
  };
}
