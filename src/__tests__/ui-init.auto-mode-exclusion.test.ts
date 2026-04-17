/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('sillytavern-utils-lib/config', () => ({
  st_echo: jest.fn(),
}));

jest.unstable_mockModule('sillytavern-utils-lib/types/translate', () => ({
  AutoModeOptions: {
    NONE: 'none',
    RESPONSES: 'responses',
    BOTH: 'both',
    INPUT: 'inputs',
  },
}));

jest.unstable_mockModule('sillytavern-utils-lib/types', () => ({
  EventNames: {
    CHARACTER_MESSAGE_RENDERED: 'CHARACTER_MESSAGE_RENDERED',
    GENERATION_STARTED: 'GENERATION_STARTED',
    MESSAGE_SENT: 'MESSAGE_SENT',
    USER_MESSAGE_RENDERED: 'USER_MESSAGE_RENDERED',
    CHAT_CHANGED: 'CHAT_CHANGED',
  },
}));

jest.unstable_mockModule('../tracker.js', () => ({
  includeZTrackerMessages: (chat: unknown[]) => chat,
}));

const { initializeGlobalUI } = await import('../ui/ui-init.js');

function buildMessage(messageId: number): string {
  return `<div class="mes" mesid="${messageId}"><div class="mes_text">Message ${messageId}</div></div>`;
}

function buildSendButton(): string {
  return '<div id="send_but" class="fa-solid fa-paper-plane interactable" title="Send a message"></div>';
}

/** Lets MutationObserver callbacks and their deferred sync run before assertions. */
async function flushDomObservers(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('initializeGlobalUI auto-mode exclusion guards', () => {
  test('does not resume host generation when the original reply already started and could not be stopped', async () => {
    document.body.innerHTML = buildMessage(0);
    let resolveTracker: (value: boolean) => void = () => undefined;
    const trackerPromise = new Promise<boolean>((resolve) => {
      resolveTracker = resolve;
    });
    const handlers = new Map<string, (...args: any[]) => void>();
    const hostContext = {
      chat: [{ original_avatar: 'alice.png' }],
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      characterId: 0,
      stopGeneration: jest.fn(() => false),
      generate: jest.fn(async () => undefined),
    };
    const actions = {
      renderExtensionTemplates: jest.fn(async () => undefined),
      generateTracker: jest.fn(() => trackerPromise),
      editTracker: jest.fn(),
      deleteTracker: jest.fn(),
      generateTrackerPart: jest.fn(),
      generateTrackerArrayItem: jest.fn(),
      generateTrackerArrayItemByName: jest.fn(),
      generateTrackerArrayItemByIdentity: jest.fn(),
      generateTrackerArrayItemField: jest.fn(),
      generateTrackerArrayItemFieldByName: jest.fn(),
      generateTrackerArrayItemFieldByIdentity: jest.fn(),
    };

    (globalThis as any).SillyTavern = { getContext: () => hostContext };

    await initializeGlobalUI({
      globalContext: {
        chat: hostContext.chat,
        saveChat: jest.fn(async () => undefined),
        eventSource: { on: (eventName: string, handler: (...args: any[]) => void) => handlers.set(eventName, handler) },
      },
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'inputs', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions: actions as any,
      renderTrackerWithDeps: () => undefined,
    });

    handlers.get('MESSAGE_SENT')?.(0);
    handlers.get('GENERATION_STARTED')?.();

    resolveTracker(true);
    await trackerPromise;

    expect(hostContext.generate).not.toHaveBeenCalled();
    expect(document.querySelector('.ztracker-auto-mode-status')).toBeNull();
  });

  test('does not resume host generation after a tracker failure when the host reply was never suppressed', async () => {
    document.body.innerHTML = buildMessage(0);
    const handlers = new Map<string, (...args: any[]) => void>();
    const hostContext = {
      chat: [{ original_avatar: 'alice.png' }],
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      characterId: 0,
      stopGeneration: jest.fn(() => false),
      generate: jest.fn(async () => undefined),
    };
    const actions = {
      renderExtensionTemplates: jest.fn(async () => undefined),
      generateTracker: jest.fn(async () => false),
      editTracker: jest.fn(),
      deleteTracker: jest.fn(),
      generateTrackerPart: jest.fn(),
      generateTrackerArrayItem: jest.fn(),
      generateTrackerArrayItemByName: jest.fn(),
      generateTrackerArrayItemByIdentity: jest.fn(),
      generateTrackerArrayItemField: jest.fn(),
      generateTrackerArrayItemFieldByName: jest.fn(),
      generateTrackerArrayItemFieldByIdentity: jest.fn(),
    };

    (globalThis as any).SillyTavern = { getContext: () => hostContext };

    await initializeGlobalUI({
      globalContext: {
        chat: hostContext.chat,
        saveChat: jest.fn(async () => undefined),
        eventSource: { on: (eventName: string, handler: (...args: any[]) => void) => handlers.set(eventName, handler) },
      },
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'inputs', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions: actions as any,
      renderTrackerWithDeps: () => undefined,
    });

    handlers.get('MESSAGE_SENT')?.(0);
    await Promise.resolve();

    expect(hostContext.stopGeneration).toHaveBeenCalledTimes(1);
    expect(hostContext.generate).not.toHaveBeenCalled();
    expect(document.querySelector('.ztracker-auto-mode-status')).toBeNull();
  });

  test('ignores zTracker-owned request starts while outgoing auto mode is holding the host reply', async () => {
    document.body.innerHTML = buildMessage(0);
    const handlers = new Map<string, (...args: any[]) => void>();
    let beforeRequestStartHook: (() => void) | undefined;
    const hostContext = {
      chat: [{ original_avatar: 'alice.png' }],
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      characterId: 0,
      stopGeneration: jest.fn(() => true),
      generate: jest.fn(async () => undefined),
    };
    const actions = {
      renderExtensionTemplates: jest.fn(async () => undefined),
      generateTracker: jest.fn(async () => {
        beforeRequestStartHook?.();
        handlers.get('GENERATION_STARTED')?.();
        return true;
      }),
      editTracker: jest.fn(),
      deleteTracker: jest.fn(),
      generateTrackerPart: jest.fn(),
      generateTrackerArrayItem: jest.fn(),
      generateTrackerArrayItemByName: jest.fn(),
      generateTrackerArrayItemByIdentity: jest.fn(),
      generateTrackerArrayItemField: jest.fn(),
      generateTrackerArrayItemFieldByName: jest.fn(),
      generateTrackerArrayItemFieldByIdentity: jest.fn(),
      setBeforeRequestStartHook: jest.fn((callback?: () => void) => {
        beforeRequestStartHook = callback;
      }),
    };

    (globalThis as any).SillyTavern = { getContext: () => hostContext };

    await initializeGlobalUI({
      globalContext: {
        chat: hostContext.chat,
        saveChat: jest.fn(async () => undefined),
        eventSource: { on: (eventName: string, handler: (...args: any[]) => void) => handlers.set(eventName, handler) },
      },
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'inputs', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions: actions as any,
      renderTrackerWithDeps: () => undefined,
    });

    handlers.get('MESSAGE_SENT')?.(0);
    await Promise.resolve();

    expect(actions.setBeforeRequestStartHook).toHaveBeenCalledWith(expect.any(Function));
    expect(hostContext.stopGeneration).toHaveBeenCalledTimes(1);
    expect(hostContext.generate).toHaveBeenCalledWith(undefined, { automatic_trigger: true });
  });

  test('waits for tracker generation to finish before resuming normal generation for outgoing auto mode', async () => {
    document.body.innerHTML = buildMessage(0);
    let resolveTracker: (value: boolean) => void = () => undefined;
    const trackerPromise = new Promise<boolean>((resolve) => {
      resolveTracker = resolve;
    });
    const handlers = new Map<string, (...args: any[]) => void>();
    const hostContext = {
      chat: [{ original_avatar: 'alice.png' }],
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      characterId: 0,
      stopGeneration: jest.fn(() => true),
      generate: jest.fn(async () => undefined),
    };
    const actions = {
      renderExtensionTemplates: jest.fn(async () => undefined),
      generateTracker: jest.fn(() => trackerPromise),
      editTracker: jest.fn(),
      deleteTracker: jest.fn(),
      generateTrackerPart: jest.fn(),
      generateTrackerArrayItem: jest.fn(),
      generateTrackerArrayItemByName: jest.fn(),
      generateTrackerArrayItemByIdentity: jest.fn(),
      generateTrackerArrayItemField: jest.fn(),
      generateTrackerArrayItemFieldByName: jest.fn(),
      generateTrackerArrayItemFieldByIdentity: jest.fn(),
    };

    (globalThis as any).SillyTavern = { getContext: () => hostContext };

    await initializeGlobalUI({
      globalContext: {
        chat: hostContext.chat,
        saveChat: jest.fn(async () => undefined),
        eventSource: { on: (eventName: string, handler: (...args: any[]) => void) => handlers.set(eventName, handler) },
      },
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'inputs', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions: actions as any,
      renderTrackerWithDeps: () => undefined,
    });

    handlers.get('MESSAGE_SENT')?.(0);
    expect(actions.generateTracker).toHaveBeenCalledWith(0, { silent: true, showStatusIndicator: false });
    expect(document.querySelector('.mes[mesid="0"]')?.classList.contains('ztracker-auto-mode-hold')).toBe(true);
    expect(document.querySelector('.ztracker-auto-mode-status')?.textContent).toContain('Generating tracker before reply');

    handlers.get('GENERATION_STARTED')?.();
    handlers.get('GENERATION_STARTED')?.();
    expect(hostContext.stopGeneration).toHaveBeenCalledTimes(1);
    expect(hostContext.generate).not.toHaveBeenCalled();

    resolveTracker(true);
    await trackerPromise;

    expect(hostContext.generate).toHaveBeenCalledWith(undefined, { automatic_trigger: true });
    expect(document.querySelector('.ztracker-auto-mode-status')).toBeNull();
    expect(document.querySelector('.mes[mesid="0"]')?.classList.contains('ztracker-auto-mode-hold')).toBe(false);
  });

  test('does not keep stopping unrelated generation starts after the initial outgoing auto-mode suppression', async () => {
    document.body.innerHTML = buildMessage(0);
    let resolveTracker: (value: boolean) => void = () => undefined;
    const trackerPromise = new Promise<boolean>((resolve) => {
      resolveTracker = resolve;
    });
    const handlers = new Map<string, (...args: any[]) => void>();
    const hostContext = {
      chat: [{ original_avatar: 'alice.png' }],
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      characterId: 0,
      stopGeneration: jest.fn(() => true),
      generate: jest.fn(async () => undefined),
    };
    const actions = {
      renderExtensionTemplates: jest.fn(async () => undefined),
      generateTracker: jest.fn(() => trackerPromise),
      editTracker: jest.fn(),
      deleteTracker: jest.fn(),
      generateTrackerPart: jest.fn(),
      generateTrackerArrayItem: jest.fn(),
      generateTrackerArrayItemByName: jest.fn(),
      generateTrackerArrayItemByIdentity: jest.fn(),
      generateTrackerArrayItemField: jest.fn(),
      generateTrackerArrayItemFieldByName: jest.fn(),
      generateTrackerArrayItemFieldByIdentity: jest.fn(),
    };

    (globalThis as any).SillyTavern = { getContext: () => hostContext };

    await initializeGlobalUI({
      globalContext: {
        chat: hostContext.chat,
        saveChat: jest.fn(async () => undefined),
        eventSource: { on: (eventName: string, handler: (...args: any[]) => void) => handlers.set(eventName, handler) },
      },
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'inputs', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions: actions as any,
      renderTrackerWithDeps: () => undefined,
    });

    handlers.get('MESSAGE_SENT')?.(0);
    handlers.get('GENERATION_STARTED')?.();
    handlers.get('GENERATION_STARTED')?.();

    expect(hostContext.stopGeneration).toHaveBeenCalledTimes(1);

    resolveTracker(true);
    await trackerPromise;

    expect(hostContext.generate).toHaveBeenCalledWith(undefined, { automatic_trigger: true });
  });

  test('reapplies the hold indicator when the pending user message renders after MESSAGE_SENT', async () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    let resolveTracker: (value: boolean) => void = () => undefined;
    const trackerPromise = new Promise<boolean>((resolve) => {
      resolveTracker = resolve;
    });
    const hostContext = {
      chat: [{ original_avatar: 'alice.png' }],
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      characterId: 0,
      stopGeneration: jest.fn(() => true),
      generate: jest.fn(async () => undefined),
    };
    const actions = {
      renderExtensionTemplates: jest.fn(async () => undefined),
      generateTracker: jest.fn(() => trackerPromise),
      editTracker: jest.fn(),
      deleteTracker: jest.fn(),
      generateTrackerPart: jest.fn(),
      generateTrackerArrayItem: jest.fn(),
      generateTrackerArrayItemByName: jest.fn(),
      generateTrackerArrayItemByIdentity: jest.fn(),
      generateTrackerArrayItemField: jest.fn(),
      generateTrackerArrayItemFieldByName: jest.fn(),
      generateTrackerArrayItemFieldByIdentity: jest.fn(),
    };

    document.body.innerHTML = '';
    (globalThis as any).SillyTavern = { getContext: () => hostContext };

    await initializeGlobalUI({
      globalContext: {
        chat: hostContext.chat,
        saveChat: jest.fn(async () => undefined),
        eventSource: { on: (eventName: string, handler: (...args: any[]) => void) => handlers.set(eventName, handler) },
      },
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'inputs', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions: actions as any,
      renderTrackerWithDeps: () => undefined,
    });

    handlers.get('MESSAGE_SENT')?.(0);
    expect(document.querySelector('.ztracker-auto-mode-status')).toBeNull();

    document.body.innerHTML = buildMessage(0);
    handlers.get('USER_MESSAGE_RENDERED')?.(0);

    expect(document.querySelector('.mes[mesid="0"]')?.classList.contains('ztracker-auto-mode-hold')).toBe(true);
    expect(document.querySelector('.ztracker-auto-mode-status')?.textContent).toContain('Generating tracker before reply');

    resolveTracker(true);
    await trackerPromise;
  });

  test('reapplies the hold indicator when SillyTavern rerenders the pending message without a user-message event', async () => {
    document.body.innerHTML = buildMessage(0);
    let resolveTracker: (value: boolean) => void = () => undefined;
    const trackerPromise = new Promise<boolean>((resolve) => {
      resolveTracker = resolve;
    });
    const handlers = new Map<string, (...args: any[]) => void>();
    const hostContext = {
      chat: [{ original_avatar: 'alice.png' }],
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      characterId: 0,
      stopGeneration: jest.fn(() => true),
      generate: jest.fn(async () => undefined),
    };
    const actions = {
      renderExtensionTemplates: jest.fn(async () => undefined),
      generateTracker: jest.fn(() => trackerPromise),
      editTracker: jest.fn(),
      deleteTracker: jest.fn(),
      generateTrackerPart: jest.fn(),
      generateTrackerArrayItem: jest.fn(),
      generateTrackerArrayItemByName: jest.fn(),
      generateTrackerArrayItemByIdentity: jest.fn(),
      generateTrackerArrayItemField: jest.fn(),
      generateTrackerArrayItemFieldByName: jest.fn(),
      generateTrackerArrayItemFieldByIdentity: jest.fn(),
    };

    (globalThis as any).SillyTavern = { getContext: () => hostContext };

    await initializeGlobalUI({
      globalContext: {
        chat: hostContext.chat,
        saveChat: jest.fn(async () => undefined),
        eventSource: { on: (eventName: string, handler: (...args: any[]) => void) => handlers.set(eventName, handler) },
      },
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'inputs', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions: actions as any,
      renderTrackerWithDeps: () => undefined,
    });

    handlers.get('MESSAGE_SENT')?.(0);
    expect(document.querySelector('.ztracker-auto-mode-status')?.textContent).toContain('Generating tracker before reply');

    document.body.innerHTML = buildMessage(0);
    await flushDomObservers();

    expect(document.querySelector('.mes[mesid="0"]')?.classList.contains('ztracker-auto-mode-hold')).toBe(true);
    expect(document.querySelector('.ztracker-auto-mode-status')?.textContent).toContain('Generating tracker before reply');

    resolveTracker(true);
    await trackerPromise;
  });

  test('turns the host send button into a tracker stop control and cancels the pending tracker run on click', async () => {
    document.body.innerHTML = `${buildMessage(0)}${buildSendButton()}`;
    let resolveTracker: (value: boolean) => void = () => undefined;
    const trackerPromise = new Promise<boolean>((resolve) => {
      resolveTracker = resolve;
    });
    const handlers = new Map<string, (...args: any[]) => void>();
    const hostContext = {
      chat: [{ original_avatar: 'alice.png' }],
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      characterId: 0,
      stopGeneration: jest.fn(() => true),
      generate: jest.fn(async () => undefined),
    };
    const actions = {
      renderExtensionTemplates: jest.fn(async () => undefined),
      generateTracker: jest.fn(() => trackerPromise),
      cancelTracker: jest.fn(() => true),
      editTracker: jest.fn(),
      deleteTracker: jest.fn(),
      generateTrackerPart: jest.fn(),
      generateTrackerArrayItem: jest.fn(),
      generateTrackerArrayItemByName: jest.fn(),
      generateTrackerArrayItemByIdentity: jest.fn(),
      generateTrackerArrayItemField: jest.fn(),
      generateTrackerArrayItemFieldByName: jest.fn(),
      generateTrackerArrayItemFieldByIdentity: jest.fn(),
    };

    (globalThis as any).SillyTavern = { getContext: () => hostContext };

    await initializeGlobalUI({
      globalContext: {
        chat: hostContext.chat,
        saveChat: jest.fn(async () => undefined),
        eventSource: { on: (eventName: string, handler: (...args: any[]) => void) => handlers.set(eventName, handler) },
      },
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'inputs', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions: actions as any,
      renderTrackerWithDeps: () => undefined,
    });

    handlers.get('MESSAGE_SENT')?.(0);

    const sendButton = document.querySelector('#send_but') as HTMLElement | null;
    expect(sendButton?.title).toBe('Stop tracker generation');
    expect(sendButton?.classList.contains('fa-stop')).toBe(true);
    expect(sendButton?.classList.contains('fa-paper-plane')).toBe(false);

    sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(actions.cancelTracker).toHaveBeenCalledWith(0);
    expect(sendButton?.title).toBe('Send a message');
    expect(sendButton?.classList.contains('fa-paper-plane')).toBe(true);
    expect(document.querySelector('.ztracker-auto-mode-status')).toBeNull();

    resolveTracker(false);
    await trackerPromise;

    expect(hostContext.generate).not.toHaveBeenCalled();
  });

  test('resumes normal generation when tracker generation fails', async () => {
    document.body.innerHTML = buildMessage(0);
    const handlers = new Map<string, (...args: any[]) => void>();
    const hostContext = {
      chat: [{ original_avatar: 'alice.png' }],
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      characterId: 0,
      stopGeneration: jest.fn(() => true),
      generate: jest.fn(async () => undefined),
    };
    const actions = {
      renderExtensionTemplates: jest.fn(async () => undefined),
      generateTracker: jest.fn(async () => false),
      editTracker: jest.fn(),
      deleteTracker: jest.fn(),
      generateTrackerPart: jest.fn(),
      generateTrackerArrayItem: jest.fn(),
      generateTrackerArrayItemByName: jest.fn(),
      generateTrackerArrayItemByIdentity: jest.fn(),
      generateTrackerArrayItemField: jest.fn(),
      generateTrackerArrayItemFieldByName: jest.fn(),
      generateTrackerArrayItemFieldByIdentity: jest.fn(),
    };

    (globalThis as any).SillyTavern = { getContext: () => hostContext };

    await initializeGlobalUI({
      globalContext: {
        chat: hostContext.chat,
        saveChat: jest.fn(async () => undefined),
        eventSource: { on: (eventName: string, handler: (...args: any[]) => void) => handlers.set(eventName, handler) },
      },
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'inputs', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions: actions as any,
      renderTrackerWithDeps: () => undefined,
    });

    handlers.get('MESSAGE_SENT')?.(0);
    await Promise.resolve();

    expect(hostContext.generate).toHaveBeenCalledWith(undefined, { automatic_trigger: true });
    expect(document.querySelector('.ztracker-auto-mode-status')).toBeNull();
  });

  test('resumes normal generation when tracker generation throws', async () => {
    document.body.innerHTML = buildMessage(0);
    const handlers = new Map<string, (...args: any[]) => void>();
    const hostContext = {
      chat: [{ original_avatar: 'alice.png' }],
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      characterId: 0,
      stopGeneration: jest.fn(() => true),
      generate: jest.fn(async () => undefined),
    };
    const actions = {
      renderExtensionTemplates: jest.fn(async () => undefined),
      generateTracker: jest.fn(async () => {
        throw new Error('tracker failed');
      }),
      editTracker: jest.fn(),
      deleteTracker: jest.fn(),
      generateTrackerPart: jest.fn(),
      generateTrackerArrayItem: jest.fn(),
      generateTrackerArrayItemByName: jest.fn(),
      generateTrackerArrayItemByIdentity: jest.fn(),
      generateTrackerArrayItemField: jest.fn(),
      generateTrackerArrayItemFieldByName: jest.fn(),
      generateTrackerArrayItemFieldByIdentity: jest.fn(),
    };

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (globalThis as any).SillyTavern = { getContext: () => hostContext };

    await initializeGlobalUI({
      globalContext: {
        chat: hostContext.chat,
        saveChat: jest.fn(async () => undefined),
        eventSource: { on: (eventName: string, handler: (...args: any[]) => void) => handlers.set(eventName, handler) },
      },
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'inputs', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions: actions as any,
      renderTrackerWithDeps: () => undefined,
    });

    handlers.get('MESSAGE_SENT')?.(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleErrorSpy).toHaveBeenCalledWith('zTracker auto mode failed to generate a tracker before reply.', expect.any(Error));
    expect(hostContext.generate).toHaveBeenCalledWith(undefined, { automatic_trigger: true });
    expect(document.querySelector('.ztracker-auto-mode-status')).toBeNull();

    consoleErrorSpy.mockRestore();
  });

  test('auto-generates for outgoing user messages on message_sent when process inputs is selected', async () => {
    const handlers = new Map<string, (messageId?: number) => void>();
    const actions = {
      renderExtensionTemplates: jest.fn(async () => undefined),
      generateTracker: jest.fn(),
      editTracker: jest.fn(),
      deleteTracker: jest.fn(),
      generateTrackerPart: jest.fn(),
      generateTrackerArrayItem: jest.fn(),
      generateTrackerArrayItemByName: jest.fn(),
      generateTrackerArrayItemByIdentity: jest.fn(),
      generateTrackerArrayItemField: jest.fn(),
      generateTrackerArrayItemFieldByName: jest.fn(),
      generateTrackerArrayItemFieldByIdentity: jest.fn(),
    };

    const hostContext = {
      chat: [{ original_avatar: 'alice.png' }],
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      characterId: 0,
    };
    (globalThis as any).SillyTavern = { getContext: () => hostContext };

    await initializeGlobalUI({
      globalContext: {
        chat: hostContext.chat,
        saveChat: jest.fn(async () => undefined),
        eventSource: { on: (eventName: string, handler: (messageId?: number) => void) => handlers.set(eventName, handler) },
      },
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'inputs', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions: actions as any,
      renderTrackerWithDeps: () => undefined,
    });

    handlers.get('MESSAGE_SENT')?.(0);
    expect(actions.generateTracker).toHaveBeenCalledWith(0, { silent: true, showStatusIndicator: false });
  });

  test('skips auto-generation for excluded character-rendered messages', async () => {
    const handlers = new Map<string, (messageId: number) => void>();
    const actions = {
      renderExtensionTemplates: jest.fn(async () => undefined),
      generateTracker: jest.fn(),
      editTracker: jest.fn(),
      deleteTracker: jest.fn(),
      generateTrackerPart: jest.fn(),
      generateTrackerArrayItem: jest.fn(),
      generateTrackerArrayItemByName: jest.fn(),
      generateTrackerArrayItemByIdentity: jest.fn(),
      generateTrackerArrayItemField: jest.fn(),
      generateTrackerArrayItemFieldByName: jest.fn(),
      generateTrackerArrayItemFieldByIdentity: jest.fn(),
    };

    const hostContext = {
      chat: [{ original_avatar: 'alice.png' }],
      characters: [{ avatar: 'alice.png', data: { extensions: { zTracker: { autoModeExcluded: true } } } }],
      characterId: 0,
    };
    (globalThis as any).SillyTavern = { getContext: () => hostContext };

    await initializeGlobalUI({
      globalContext: {
        chat: hostContext.chat,
        saveChat: jest.fn(async () => undefined),
        eventSource: { on: (eventName: string, handler: (messageId: number) => void) => handlers.set(eventName, handler) },
      },
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'responses', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions: actions as any,
      renderTrackerWithDeps: () => undefined,
    });

    handlers.get('CHARACTER_MESSAGE_RENDERED')?.(0);
    expect(actions.generateTracker).not.toHaveBeenCalled();
  });

  test('skips auto-generation for outgoing user messages when the active character is excluded', async () => {
    const handlers = new Map<string, (messageId?: number) => void>();
    const actions = {
      renderExtensionTemplates: jest.fn(async () => undefined),
      generateTracker: jest.fn(),
      editTracker: jest.fn(),
      deleteTracker: jest.fn(),
      generateTrackerPart: jest.fn(),
      generateTrackerArrayItem: jest.fn(),
      generateTrackerArrayItemByName: jest.fn(),
      generateTrackerArrayItemByIdentity: jest.fn(),
      generateTrackerArrayItemField: jest.fn(),
      generateTrackerArrayItemFieldByName: jest.fn(),
      generateTrackerArrayItemFieldByIdentity: jest.fn(),
    };

    const hostContext = {
      chat: [],
      characters: [{ avatar: 'alice.png', data: { extensions: { zTracker: { autoModeExcluded: true } } } }],
      characterId: 0,
    };
    (globalThis as any).SillyTavern = { getContext: () => hostContext };

    await initializeGlobalUI({
      globalContext: {
        chat: hostContext.chat,
        saveChat: jest.fn(async () => undefined),
        eventSource: { on: (eventName: string, handler: (messageId?: number) => void) => handlers.set(eventName, handler) },
      },
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'inputs', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions: actions as any,
      renderTrackerWithDeps: () => undefined,
    });

    handlers.get('MESSAGE_SENT')?.(0);
    expect(actions.generateTracker).not.toHaveBeenCalled();
  });

  test('does not resume host generation after chat changes during the pending outgoing auto-mode hold', async () => {
    document.body.innerHTML = buildMessage(0);
    let resolveTracker: (value: boolean) => void = () => undefined;
    const trackerPromise = new Promise<boolean>((resolve) => {
      resolveTracker = resolve;
    });
    const handlers = new Map<string, (...args: any[]) => void>();
    const hostContext = {
      chat: [{ original_avatar: 'alice.png' }],
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      characterId: 0,
      stopGeneration: jest.fn(() => true),
      generate: jest.fn(async () => undefined),
    };
    const actions = {
      renderExtensionTemplates: jest.fn(async () => undefined),
      generateTracker: jest.fn(() => trackerPromise),
      editTracker: jest.fn(),
      deleteTracker: jest.fn(),
      generateTrackerPart: jest.fn(),
      generateTrackerArrayItem: jest.fn(),
      generateTrackerArrayItemByName: jest.fn(),
      generateTrackerArrayItemByIdentity: jest.fn(),
      generateTrackerArrayItemField: jest.fn(),
      generateTrackerArrayItemFieldByName: jest.fn(),
      generateTrackerArrayItemFieldByIdentity: jest.fn(),
    };

    (globalThis as any).SillyTavern = { getContext: () => hostContext };

    await initializeGlobalUI({
      globalContext: {
        chat: hostContext.chat,
        saveChat: jest.fn(async () => undefined),
        eventSource: { on: (eventName: string, handler: (...args: any[]) => void) => handlers.set(eventName, handler) },
      },
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'inputs', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions: actions as any,
      renderTrackerWithDeps: () => undefined,
    });

    handlers.get('MESSAGE_SENT')?.(0);
    expect(document.querySelector('.ztracker-auto-mode-status')?.textContent).toContain('Generating tracker before reply');

    handlers.get('CHAT_CHANGED')?.();
    expect(document.querySelector('.ztracker-auto-mode-status')).toBeNull();

    resolveTracker(true);
    await trackerPromise;

    expect(hostContext.generate).not.toHaveBeenCalled();
    expect(document.querySelector('.ztracker-auto-mode-status')).toBeNull();
  });
});