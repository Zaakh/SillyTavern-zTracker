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
    INPUT: 'input',
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

describe('initializeGlobalUI auto-mode exclusion guards', () => {
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
        getSettings: jest.fn(() => ({ autoMode: 'input', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions: actions as any,
      renderTrackerWithDeps: () => undefined,
    });

    handlers.get('MESSAGE_SENT')?.(0);
    expect(actions.generateTracker).toHaveBeenCalledWith(0, { silent: true });
    expect(document.querySelector('.mes[mesid="0"]')?.classList.contains('ztracker-auto-mode-hold')).toBe(true);
    expect(document.querySelector('.ztracker-auto-mode-status')?.textContent).toContain('Generating tracker before reply');

    handlers.get('GENERATION_STARTED')?.();
    handlers.get('GENERATION_STARTED')?.();
    expect(hostContext.stopGeneration).toHaveBeenCalledTimes(2);
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
        getSettings: jest.fn(() => ({ autoMode: 'input', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions: actions as any,
      renderTrackerWithDeps: () => undefined,
    });

    handlers.get('MESSAGE_SENT')?.(0);
    handlers.get('GENERATION_STARTED')?.();
    handlers.get('GENERATION_STARTED')?.();

    expect(hostContext.stopGeneration).toHaveBeenCalledTimes(2);

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
        getSettings: jest.fn(() => ({ autoMode: 'input', includeLastXZTrackerMessages: 1 })),
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
        getSettings: jest.fn(() => ({ autoMode: 'input', includeLastXZTrackerMessages: 1 })),
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
        getSettings: jest.fn(() => ({ autoMode: 'input', includeLastXZTrackerMessages: 1 })),
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
        getSettings: jest.fn(() => ({ autoMode: 'input', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions: actions as any,
      renderTrackerWithDeps: () => undefined,
    });

    handlers.get('MESSAGE_SENT')?.(0);
    expect(actions.generateTracker).toHaveBeenCalledWith(0, { silent: true });
  });

  test('auto-generates for outgoing user messages when the canonical input setting is selected', async () => {
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
        getSettings: jest.fn(() => ({ autoMode: 'input', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions: actions as any,
      renderTrackerWithDeps: () => undefined,
    });

    handlers.get('MESSAGE_SENT')?.(0);
    expect(actions.generateTracker).toHaveBeenCalledWith(0, { silent: true });
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
        getSettings: jest.fn(() => ({ autoMode: 'input', includeLastXZTrackerMessages: 1 })),
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
        getSettings: jest.fn(() => ({ autoMode: 'input', includeLastXZTrackerMessages: 1 })),
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