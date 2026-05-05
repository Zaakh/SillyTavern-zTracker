/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import {
  createSillyTavernHost,
  installChatMessageDom,
  installSillyTavernHost,
} from '../test-utils/sillytavern-host-harness.js';

const stEchoMock = jest.fn();

jest.unstable_mockModule('sillytavern-utils-lib/config', () => ({
  st_echo: stEchoMock,
  selected_group: false,
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

function createActions() {
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
  } as any;
}

async function initializeRerenderHarness(options: {
  renderTrackerWithDeps: jest.Mock;
  host?: Parameters<typeof createSillyTavernHost>[0];
}) {
  const host = createSillyTavernHost({
    chat: [
      {
        extra: {
          zTracker: {
            value: { time: '09:00:00' },
            html: '<div>{{data.time}}</div>',
          },
        },
      },
    ],
    ...(options.host ?? {}),
  });

  installChatMessageDom(0);
  installSillyTavernHost(host.context);

  await initializeGlobalUI({
    globalContext: host.context,
    settingsManager: {
      getSettings: jest.fn(() => ({ autoMode: 'none', includeLastXZTrackerMessages: 0 })),
    } as any,
    actions: createActions(),
    renderTrackerWithDeps: options.renderTrackerWithDeps,
  });

  return host;
}

describe('initializeGlobalUI chat rerender failures', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    stEchoMock.mockReset();
  });

  test('keeps stored tracker data when chat rerendering fails', async () => {
    const renderTrackerWithDeps = jest.fn(() => {
      throw new Error('render failed');
    });
    const host = await initializeRerenderHarness({ renderTrackerWithDeps });

    host.events.emit('CHAT_CHANGED');

    expect((host.context.chat as any[])[0].extra.zTracker).toEqual({
      value: { time: '09:00:00' },
      html: '<div>{{data.time}}</div>',
    });
    expect(document.querySelector('.ztracker-render-error-status')?.textContent).toContain('zTracker failed to render. Stored data was kept.');
    expect(host.spies.saveChat).not.toHaveBeenCalled();
    expect(stEchoMock).toHaveBeenCalledWith(
      'error',
      'A zTracker template failed to render for one or more messages. Tracker data was kept.',
    );
  });

  test('clears stale rerender failure badges after a later successful rerender', async () => {
    let shouldFail = true;
    const renderTrackerWithDeps = jest.fn(() => {
      if (shouldFail) {
        throw new Error('render failed');
      }
    });
    const host = await initializeRerenderHarness({ renderTrackerWithDeps });

    host.events.emit('CHAT_CHANGED');
    expect(document.querySelector('.ztracker-render-error-status')).not.toBeNull();

    shouldFail = false;
    host.events.emit('CHAT_CHANGED');

    expect(document.querySelector('.ztracker-render-error-status')).toBeNull();
  });
});
