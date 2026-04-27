import { jest } from '@jest/globals';

/** Shared SillyTavern host and DOM harness helpers for zTracker host-boundary tests. */

type EventHandler = (...args: any[]) => unknown;

type HostContext = Record<string, unknown> & {
  chat: Array<unknown>;
  chatMetadata: Record<string, unknown>;
  characters: Array<unknown>;
  characterId: unknown;
  mainApi?: string;
  selected_group?: string | false;
  name1: string;
  name2: string;
  extensionSettings: Record<string, unknown>;
  powerUserSettings: Record<string, unknown>;
  eventSource: { on: ReturnType<typeof createEventSourceHarness>['on'] };
  generate: jest.Mock;
  stopGeneration: jest.Mock;
  Popup: {
    show: {
      confirm: jest.Mock;
      input: jest.Mock;
    };
  };
  saveChat: jest.Mock;
  saveMetadata: jest.Mock;
  saveSettingsDebounced: jest.Mock;
  renderExtensionTemplateAsync: jest.Mock;
  writeExtensionField: jest.Mock;
  getPresetManager: jest.Mock;
};

type CreateSillyTavernHostOptions = Partial<HostContext> & {
  events?: ReturnType<typeof createEventSourceHarness>;
};

type BootExtensionForTestOptions = {
  host?: ReturnType<typeof createSillyTavernHost>;
  dom?: {
    clearDocument?: boolean;
    extensionsMenu?: boolean;
    settingsContainer?: boolean;
    messageTemplate?: boolean;
    sendButton?: boolean;
    characterPanel?: boolean;
  };
  boot?: () => Promise<unknown> | unknown;
};

/** Tracks SillyTavern event registrations and lets tests emit host events deterministically. */
export function createEventSourceHarness() {
  const handlers = new Map<string, EventHandler[]>();
  const on = jest.fn((eventName: string, handler: EventHandler) => {
    const existingHandlers = handlers.get(eventName) ?? [];
    existingHandlers.push(handler);
    handlers.set(eventName, existingHandlers);
  });

  return {
    on,
    /** Returns the handlers registered for one SillyTavern event name. */
    getHandlers(eventName: string): EventHandler[] {
      return [...(handlers.get(eventName) ?? [])];
    },
    /** Emits one SillyTavern event to handlers in registration order. */
    emit(eventName: string, ...args: any[]): Array<unknown> {
      return this.getHandlers(eventName).map((handler) => handler(...args));
    },
    /** Clears both recorded registrations and the underlying Jest mock state. */
    reset(): void {
      handlers.clear();
      on.mockClear();
    },
  };
}

/** Builds a minimal SillyTavern host context with stable defaults for host-boundary tests. */
export function createSillyTavernHost(options: CreateSillyTavernHostOptions = {}) {
  const events = options.events ?? createEventSourceHarness();
  const popupConfirm = jest.fn(async () => true);
  const popupInput = jest.fn(async () => '');
  const saveChat = jest.fn(async () => undefined);
  const saveMetadata = jest.fn(async () => undefined);
  const saveSettingsDebounced = jest.fn(() => undefined);
  const renderExtensionTemplateAsync = jest.fn(async () => '');
  const writeExtensionField = jest.fn(() => undefined);
  const getPresetManager = jest.fn(() => null);
  const generate = jest.fn(async () => undefined);
  const stopGeneration = jest.fn(() => false);
  const popup = options.Popup ?? {
    show: {
      confirm: popupConfirm,
      input: popupInput,
    },
  };

  const context: HostContext = {
    chat: options.chat ?? [],
    chatMetadata: options.chatMetadata ?? {},
    characters: options.characters ?? [],
    characterId: options.characterId,
    mainApi: options.mainApi,
    selected_group: options.selected_group ?? false,
    name1: options.name1 ?? 'User',
    name2: options.name2 ?? 'Assistant',
    extensionSettings: options.extensionSettings ?? {},
    powerUserSettings: options.powerUserSettings ?? {},
    eventSource: { on: (options.events ?? events).on },
    generate: options.generate ?? generate,
    stopGeneration: options.stopGeneration ?? stopGeneration,
    Popup: popup,
    saveChat: options.saveChat ?? saveChat,
    saveMetadata: options.saveMetadata ?? saveMetadata,
    saveSettingsDebounced: options.saveSettingsDebounced ?? saveSettingsDebounced,
    renderExtensionTemplateAsync: options.renderExtensionTemplateAsync ?? renderExtensionTemplateAsync,
    writeExtensionField: options.writeExtensionField ?? writeExtensionField,
    getPresetManager: options.getPresetManager ?? getPresetManager,
  };

  return {
    context,
    events,
    /** Installs this harness context as the active SillyTavern host global. */
    install(): void {
      installSillyTavernHost(context);
    },
    spies: {
      generate: context.generate,
      stopGeneration: context.stopGeneration,
      popupConfirm: context.Popup.show.confirm,
      popupInput: context.Popup.show.input,
      saveChat: context.saveChat,
      saveMetadata: context.saveMetadata,
      saveSettingsDebounced: context.saveSettingsDebounced,
      renderExtensionTemplateAsync: context.renderExtensionTemplateAsync,
      writeExtensionField: context.writeExtensionField,
      getPresetManager: context.getPresetManager,
    },
    popupConfirm,
    popupInput,
    saveChat: context.saveChat,
    saveMetadata: context.saveMetadata,
    saveSettingsDebounced: context.saveSettingsDebounced,
    renderExtensionTemplateAsync: context.renderExtensionTemplateAsync,
    writeExtensionField: context.writeExtensionField,
    getPresetManager: context.getPresetManager,
    generate: context.generate,
    stopGeneration: context.stopGeneration,
  };
}

/** Installs one fake SillyTavern host context onto the global test environment. */
export function installSillyTavernHost(context: Record<string, unknown>): void {
  (globalThis as any).SillyTavern = {
    getContext: () => context,
  };
}

/** Clears the body and installs the requested shared host DOM nodes. */
export function installBaseExtensionDom(options: {
  clearBody?: boolean;
  clearDocument?: boolean;
  extensionsMenu?: boolean;
  settingsContainer?: boolean;
  messageTemplate?: boolean;
  sendButton?: boolean;
  characterPanel?: boolean;
} = {}) {
  if (options.clearBody || options.clearDocument) {
    document.body.innerHTML = '';
  }

  return {
    extensionsMenu: options.extensionsMenu ? installExtensionsMenuDom() : null,
    settingsContainer: options.settingsContainer ? installSettingsContainerDom() : null,
    messageTemplate: options.messageTemplate ? installMessageTemplateDom() : null,
    sendButton: options.sendButton ? installSendButtonDom() : null,
    characterPanel: options.characterPanel ? installCharacterPanelDom() : null,
  };
}

/** Installs a fake host, optional DOM scaffolds, and then runs one explicit boot seam. */
export async function bootExtensionForTest(options: BootExtensionForTestOptions = {}) {
  const host = options.host ?? createSillyTavernHost();

  host.install();
  if (options.dom) {
    installBaseExtensionDom({
      clearDocument: options.dom.clearDocument,
      extensionsMenu: options.dom.extensionsMenu,
      settingsContainer: options.dom.settingsContainer,
      messageTemplate: options.dom.messageTemplate,
      sendButton: options.dom.sendButton,
      characterPanel: options.dom.characterPanel,
    });
  }

  const bootResult = options.boot ? await options.boot() : undefined;
  return { host, events: host.events, bootResult };
}

/** Installs the extension menu container used by tracker actions and menu UI. */
export function installExtensionsMenuDom(root: ParentNode = document.body): HTMLElement {
  const container = document.createElement('div');
  container.id = 'extensionsMenu';
  root.appendChild(container);
  return container;
}

/** Installs the extension settings container used by the React settings root. */
export function installSettingsContainerDom(root: ParentNode = document.body): HTMLElement {
  const container = document.createElement('div');
  container.id = 'extensions_settings';
  root.appendChild(container);
  return container;
}

/** Installs the host message template anchor used for per-message button injection. */
export function installMessageTemplateDom(root: ParentNode = document.body): HTMLElement {
  const template = document.createElement('div');
  template.id = 'message_template';

  const buttons = document.createElement('div');
  buttons.className = 'mes_buttons';

  const extraButtons = document.createElement('div');
  extraButtons.className = 'extraMesButtons';

  buttons.appendChild(extraButtons);
  template.appendChild(buttons);
  root.appendChild(template);
  return template;
}

/** Installs the host send button that outgoing auto mode temporarily repurposes. */
export function installSendButtonDom(root: ParentNode = document.body): HTMLElement {
  const sendButton = document.createElement('div');
  sendButton.id = 'send_but';
  sendButton.className = 'fa-solid fa-paper-plane interactable';
  sendButton.title = 'Send a message';
  root.appendChild(sendButton);
  return sendButton;
}

/** Installs one supported character-panel action row for zTracker button sync tests. */
export function installCharacterPanelDom(root: ParentNode = document.body) {
  const form = document.createElement('div');
  form.id = 'form_create';

  const buttonRow = document.createElement('div');
  buttonRow.className = 'form_create_bottom_buttons_block buttons_block';
  form.appendChild(buttonRow);
  root.appendChild(form);

  return { form, buttonRow };
}

/** Installs one chat message block with a standard `.mes_text` region by default. */
export function installChatMessageDom(
  messageId: number,
  options: { root?: ParentNode; text?: string; innerHtml?: string } = {},
): HTMLElement {
  const message = document.createElement('div');
  message.className = 'mes';
  message.setAttribute('mesid', String(messageId));

  if (typeof options.innerHtml === 'string') {
    message.innerHTML = options.innerHtml;
  } else {
    const messageText = document.createElement('div');
    messageText.className = 'mes_text';
    messageText.textContent = options.text ?? `Message ${messageId}`;
    message.appendChild(messageText);
  }

  (options.root ?? document.body).appendChild(message);
  return message;
}