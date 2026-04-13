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
    USER_MESSAGE_RENDERED: 'USER_MESSAGE_RENDERED',
    CHAT_CHANGED: 'CHAT_CHANGED',
  },
}));

jest.unstable_mockModule('../tracker.js', () => ({
  includeZTrackerMessages: (chat: unknown[]) => chat,
}));

const { initializeGlobalUI } = await import('../ui/ui-init.js');

describe('initializeGlobalUI auto-mode exclusion guards', () => {
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
      chat: [],
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
        getSettings: jest.fn(() => ({ autoMode: 'input', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions: actions as any,
      renderTrackerWithDeps: () => undefined,
    });

    handlers.get('USER_MESSAGE_RENDERED')?.(0);
    expect(actions.generateTracker).not.toHaveBeenCalled();
  });
});