/**
 * @jest-environment jsdom
 */

import { describe, expect, jest, test } from '@jest/globals';
import {
  bootExtensionForTest,
  createSillyTavernHost,
  installChatMessageDom,
  installSendButtonDom,
} from '../test-utils/sillytavern-host-harness.js';

jest.unstable_mockModule('sillytavern-utils-lib/config', () => ({
  st_echo: jest.fn(),
  selected_group: false,
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

type AutoModeHarnessOptions = {
  host?: Parameters<typeof createSillyTavernHost>[0];
  hostHarness?: ReturnType<typeof createSillyTavernHost>;
  actions?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  renderTrackerWithDeps?: (messageId: number) => void;
};

/** Returns the common ui-init action surface used by outgoing auto-mode tests. */
function createAutoModeActions(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  } as any;
}

/** Boots initializeGlobalUI with one shared fake host and returns the test handles. */
async function initializeAutoModeHarness(options: AutoModeHarnessOptions = {}) {
  const host = options.hostHarness ?? createSillyTavernHost(options.host);
  const actions = createAutoModeActions(options.actions);

  const boot = await bootExtensionForTest({
    host,
    boot: () => initializeGlobalUI({
      globalContext: host.context as any,
      settingsManager: {
        getSettings: jest.fn(() => ({
          autoMode: 'inputs',
          includeLastXZTrackerMessages: 1,
          ...(options.settings ?? {}),
        })),
      } as any,
      actions: actions as any,
      renderTrackerWithDeps: options.renderTrackerWithDeps ?? (() => undefined),
    }),
  });

  return { host: boot.host, actions, events: boot.events };
}

/** Reinstalls one standard host-rendered chat message. */
function renderMessage(messageId: number): void {
  document.body.innerHTML = '';
  installChatMessageDom(messageId);
}

/** Reinstalls one standard chat message together with the live host send button. */
function renderMessageWithSendButton(messageId: number): void {
  document.body.innerHTML = '';
  installChatMessageDom(messageId);
  installSendButtonDom();
}

/** Lets MutationObserver callbacks and their deferred sync run before assertions. */
async function flushDomObservers(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('initializeGlobalUI auto-mode exclusion guards', () => {
  test('does not resume host generation when the original reply already started and could not be stopped', async () => {
    renderMessage(0);
    let resolveTracker: (value: boolean) => void = () => undefined;
    const trackerPromise = new Promise<boolean>((resolve) => {
      resolveTracker = resolve;
    });
    const { events, host } = await initializeAutoModeHarness({
      host: {
        chat: [{ original_avatar: 'alice.png' }],
        characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
        characterId: 0,
        stopGeneration: jest.fn(() => false),
        generate: jest.fn(async () => undefined),
      },
      actions: {
        generateTracker: jest.fn(() => trackerPromise),
      },
    });

    events.emit('MESSAGE_SENT', 0);
    events.emit('GENERATION_STARTED');

    resolveTracker(true);
    await trackerPromise;

    expect(host.spies.generate).not.toHaveBeenCalled();
    expect(document.querySelector('.ztracker-auto-mode-status')).toBeNull();
  });

  test('does not resume host generation after a tracker failure when the host reply was never suppressed', async () => {
    renderMessage(0);
    const { events, host } = await initializeAutoModeHarness({
      host: {
        chat: [{ original_avatar: 'alice.png' }],
        characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
        characterId: 0,
        stopGeneration: jest.fn(() => false),
        generate: jest.fn(async () => undefined),
      },
      actions: {
        generateTracker: jest.fn(async () => false),
      },
    });

    events.emit('MESSAGE_SENT', 0);
    await Promise.resolve();

    expect(host.spies.stopGeneration).toHaveBeenCalledTimes(1);
    expect(host.spies.generate).not.toHaveBeenCalled();
    expect(document.querySelector('.ztracker-auto-mode-status')).toBeNull();
  });

  test('ignores zTracker-owned request starts while outgoing auto mode is holding the host reply', async () => {
    renderMessage(0);
    let beforeRequestStartHook: (() => void) | undefined;
    const host = createSillyTavernHost({
      chat: [{ original_avatar: 'alice.png' }],
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      characterId: 0,
      stopGeneration: jest.fn(() => true),
      generate: jest.fn(async () => undefined),
    });
    const { actions } = await initializeAutoModeHarness({
      hostHarness: host,
      actions: {
      generateTracker: jest.fn(async () => {
        beforeRequestStartHook?.();
        host.events.emit('GENERATION_STARTED');
        return true;
      }),
      setBeforeRequestStartHook: jest.fn((callback?: () => void) => {
        beforeRequestStartHook = callback;
      }),
      },
    });

    host.events.emit('MESSAGE_SENT', 0);
    await Promise.resolve();

    expect(actions.setBeforeRequestStartHook).toHaveBeenCalledWith(expect.any(Function));
    expect(host.spies.stopGeneration).toHaveBeenCalledTimes(1);
    expect(host.spies.generate).toHaveBeenCalledWith(undefined, { automatic_trigger: true });
  });

  test('waits for tracker generation to finish before resuming normal generation for outgoing auto mode', async () => {
    renderMessage(0);
    let resolveTracker: (value: boolean) => void = () => undefined;
    const trackerPromise = new Promise<boolean>((resolve) => {
      resolveTracker = resolve;
    });
    const { events, host, actions } = await initializeAutoModeHarness({
      host: {
        chat: [{ original_avatar: 'alice.png' }],
        characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
        characterId: 0,
        stopGeneration: jest.fn(() => true),
        generate: jest.fn(async () => undefined),
      },
      actions: {
        generateTracker: jest.fn(() => trackerPromise),
      },
    });

    events.emit('MESSAGE_SENT', 0);
    expect(actions.generateTracker).toHaveBeenCalledWith(0, { silent: true, showStatusIndicator: false });
    expect(document.querySelector('.mes[mesid="0"]')?.classList.contains('ztracker-auto-mode-hold')).toBe(true);
    expect(document.querySelector('.ztracker-auto-mode-status')?.textContent).toContain('Generating tracker before reply');

    events.emit('GENERATION_STARTED');
    events.emit('GENERATION_STARTED');
    expect(host.spies.stopGeneration).toHaveBeenCalledTimes(1);
    expect(host.spies.generate).not.toHaveBeenCalled();

    resolveTracker(true);
    await trackerPromise;

    expect(host.spies.generate).toHaveBeenCalledWith(undefined, { automatic_trigger: true });
    expect(document.querySelector('.ztracker-auto-mode-status')).toBeNull();
    expect(document.querySelector('.mes[mesid="0"]')?.classList.contains('ztracker-auto-mode-hold')).toBe(false);
  });

  test('does not keep stopping unrelated generation starts after the initial outgoing auto-mode suppression', async () => {
    renderMessage(0);
    let resolveTracker: (value: boolean) => void = () => undefined;
    const trackerPromise = new Promise<boolean>((resolve) => {
      resolveTracker = resolve;
    });
    const { events, host } = await initializeAutoModeHarness({
      host: {
        chat: [{ original_avatar: 'alice.png' }],
        characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
        characterId: 0,
        stopGeneration: jest.fn(() => true),
        generate: jest.fn(async () => undefined),
      },
      actions: {
        generateTracker: jest.fn(() => trackerPromise),
      },
    });

    events.emit('MESSAGE_SENT', 0);
    events.emit('GENERATION_STARTED');
    events.emit('GENERATION_STARTED');

    expect(host.spies.stopGeneration).toHaveBeenCalledTimes(1);

    resolveTracker(true);
    await trackerPromise;

    expect(host.spies.generate).toHaveBeenCalledWith(undefined, { automatic_trigger: true });
  });

  test('reapplies the hold indicator when the pending user message renders after MESSAGE_SENT', async () => {
    document.body.innerHTML = '';
    let resolveTracker: (value: boolean) => void = () => undefined;
    const trackerPromise = new Promise<boolean>((resolve) => {
      resolveTracker = resolve;
    });
    const { events } = await initializeAutoModeHarness({
      host: {
        chat: [{ original_avatar: 'alice.png' }],
        characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
        characterId: 0,
        stopGeneration: jest.fn(() => true),
        generate: jest.fn(async () => undefined),
      },
      actions: {
        generateTracker: jest.fn(() => trackerPromise),
      },
    });

    events.emit('MESSAGE_SENT', 0);
    expect(document.querySelector('.ztracker-auto-mode-status')).toBeNull();

    renderMessage(0);
    events.emit('USER_MESSAGE_RENDERED', 0);

    expect(document.querySelector('.mes[mesid="0"]')?.classList.contains('ztracker-auto-mode-hold')).toBe(true);
    expect(document.querySelector('.ztracker-auto-mode-status')?.textContent).toContain('Generating tracker before reply');

    resolveTracker(true);
    await trackerPromise;
  });

  test('reapplies the hold indicator when SillyTavern rerenders the pending message without a user-message event', async () => {
    renderMessage(0);
    let resolveTracker: (value: boolean) => void = () => undefined;
    const trackerPromise = new Promise<boolean>((resolve) => {
      resolveTracker = resolve;
    });
    const { events } = await initializeAutoModeHarness({
      host: {
        chat: [{ original_avatar: 'alice.png' }],
        characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
        characterId: 0,
        stopGeneration: jest.fn(() => true),
        generate: jest.fn(async () => undefined),
      },
      actions: {
        generateTracker: jest.fn(() => trackerPromise),
      },
    });

    events.emit('MESSAGE_SENT', 0);
    expect(document.querySelector('.ztracker-auto-mode-status')?.textContent).toContain('Generating tracker before reply');

    renderMessage(0);
    await flushDomObservers();

    expect(document.querySelector('.mes[mesid="0"]')?.classList.contains('ztracker-auto-mode-hold')).toBe(true);
    expect(document.querySelector('.ztracker-auto-mode-status')?.textContent).toContain('Generating tracker before reply');

    resolveTracker(true);
    await trackerPromise;
  });

  test('turns the host send button into a tracker stop control and cancels the pending tracker run on click', async () => {
    renderMessageWithSendButton(0);
    let resolveTracker: (value: boolean) => void = () => undefined;
    const trackerPromise = new Promise<boolean>((resolve) => {
      resolveTracker = resolve;
    });
    const { events, host, actions } = await initializeAutoModeHarness({
      host: {
        chat: [{ original_avatar: 'alice.png' }],
        characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
        characterId: 0,
        stopGeneration: jest.fn(() => true),
        generate: jest.fn(async () => undefined),
      },
      actions: {
        generateTracker: jest.fn(() => trackerPromise),
        cancelTracker: jest.fn(() => true),
      },
    });

    events.emit('MESSAGE_SENT', 0);

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

    expect(host.spies.generate).not.toHaveBeenCalled();
  });

  test('resumes normal generation when tracker generation fails', async () => {
    renderMessage(0);
    const { events, host } = await initializeAutoModeHarness({
      host: {
        chat: [{ original_avatar: 'alice.png' }],
        characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
        characterId: 0,
        stopGeneration: jest.fn(() => true),
        generate: jest.fn(async () => undefined),
      },
      actions: {
        generateTracker: jest.fn(async () => false),
      },
    });

    events.emit('MESSAGE_SENT', 0);
    await Promise.resolve();

    expect(host.spies.generate).toHaveBeenCalledWith(undefined, { automatic_trigger: true });
    expect(document.querySelector('.ztracker-auto-mode-status')).toBeNull();
  });

  test('resumes normal generation when tracker generation throws', async () => {
    renderMessage(0);
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { events, host } = await initializeAutoModeHarness({
      host: {
        chat: [{ original_avatar: 'alice.png' }],
        characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
        characterId: 0,
        stopGeneration: jest.fn(() => true),
        generate: jest.fn(async () => undefined),
      },
      actions: {
        generateTracker: jest.fn(async () => {
          throw new Error('tracker failed');
        }),
      },
    });

    events.emit('MESSAGE_SENT', 0);
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleErrorSpy).toHaveBeenCalledWith('zTracker auto mode failed to generate a tracker before reply.', expect.any(Error));
    expect(host.spies.generate).toHaveBeenCalledWith(undefined, { automatic_trigger: true });
    expect(document.querySelector('.ztracker-auto-mode-status')).toBeNull();

    consoleErrorSpy.mockRestore();
  });

  test('auto-generates for outgoing user messages on message_sent when process inputs is selected', async () => {
    const { events, actions } = await initializeAutoModeHarness({
      host: {
        chat: [{ original_avatar: 'alice.png' }],
        characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
        characterId: 0,
      },
    });

    events.emit('MESSAGE_SENT', 0);
    expect(actions.generateTracker).toHaveBeenCalledWith(0, { silent: true, showStatusIndicator: false });
  });

  test('skips auto-generation for excluded character-rendered messages', async () => {
    const { events, actions } = await initializeAutoModeHarness({
      host: {
        chat: [{ original_avatar: 'alice.png' }],
        characters: [{ avatar: 'alice.png', data: { extensions: { zTracker: { autoModeExcluded: true } } } }],
        characterId: 0,
      },
      settings: {
        autoMode: 'responses',
      },
    });

    events.emit('CHARACTER_MESSAGE_RENDERED', 0);
    expect(actions.generateTracker).not.toHaveBeenCalled();
  });

  test('skips auto-generation for outgoing user messages when the active character is excluded', async () => {
    const { events, actions } = await initializeAutoModeHarness({
      host: {
        chat: [],
        characters: [{ avatar: 'alice.png', data: { extensions: { zTracker: { autoModeExcluded: true } } } }],
        characterId: 0,
      },
    });

    events.emit('MESSAGE_SENT', 0);
    expect(actions.generateTracker).not.toHaveBeenCalled();
  });

  test('does not resume host generation after chat changes during the pending outgoing auto-mode hold', async () => {
    renderMessage(0);
    let resolveTracker: (value: boolean) => void = () => undefined;
    const trackerPromise = new Promise<boolean>((resolve) => {
      resolveTracker = resolve;
    });
    const { events, host } = await initializeAutoModeHarness({
      host: {
        chat: [{ original_avatar: 'alice.png' }],
        characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
        characterId: 0,
        stopGeneration: jest.fn(() => true),
        generate: jest.fn(async () => undefined),
      },
      actions: {
        generateTracker: jest.fn(() => trackerPromise),
      },
    });

    events.emit('MESSAGE_SENT', 0);
    expect(document.querySelector('.ztracker-auto-mode-status')?.textContent).toContain('Generating tracker before reply');

    events.emit('CHAT_CHANGED');
    expect(document.querySelector('.ztracker-auto-mode-status')).toBeNull();

    resolveTracker(true);
    await trackerPromise;

    expect(host.spies.generate).not.toHaveBeenCalled();
    expect(document.querySelector('.ztracker-auto-mode-status')).toBeNull();
  });
});