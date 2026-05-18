/**
 * @jest-environment jsdom
 */

import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import {
  createSillyTavernHost,
  installChatMessageDom,
  installExtensionsMenuDom,
  installMessageTemplateDom,
  installSillyTavernHost,
} from '../test-utils/sillytavern-host-harness.js';

const includeZTrackerMessagesMock = jest.fn((chat: unknown[], ..._rest: unknown[]) => [...chat]);

jest.unstable_mockModule('sillytavern-utils-lib/config', () => ({
  st_echo: jest.fn(),
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
  includeZTrackerMessages: includeZTrackerMessagesMock,
}));

const { initializeGlobalUI } = await import('../ui/ui-init.js');

function createUiInitActions() {
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

describe('initializeGlobalUI idempotence', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    includeZTrackerMessagesMock.mockClear();
  });

  test('does not duplicate injected UI or click handlers when initialized twice', async () => {
    const host = createSillyTavernHost();
    const actions = createUiInitActions();
    installSillyTavernHost(host.context);
    installExtensionsMenuDom();
    installMessageTemplateDom();
    installChatMessageDom(0, {
      innerHtml: '<div class="mes_button mes_ztracker_button"></div><div class="mes_text">Message 0</div>',
    });

    await initializeGlobalUI({
      globalContext: host.context,
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'none', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions,
      renderTrackerWithDeps: jest.fn(),
    });

    await initializeGlobalUI({
      globalContext: host.context,
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'none', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions,
      renderTrackerWithDeps: jest.fn(),
    });

    expect(document.querySelectorAll('#message_template .mes_ztracker_button')).toHaveLength(1);

    (document.querySelector('.mes[mesid="0"] .mes_ztracker_button') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    expect(actions.generateTracker).toHaveBeenCalledTimes(1);
    expect(actions.generateTracker).toHaveBeenCalledWith(0, { showStatusIndicator: true });
  });

  test('routes the redo button through the full regeneration path', async () => {
    const host = createSillyTavernHost();
    const actions = createUiInitActions();
    installSillyTavernHost(host.context);
    installExtensionsMenuDom();
    installMessageTemplateDom();
    installChatMessageDom(0, {
      innerHtml: '<div class="ztracker-regenerate-button"></div><div class="mes_text">Message 0</div>',
    });

    await initializeGlobalUI({
      globalContext: host.context,
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'none', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions,
      renderTrackerWithDeps: jest.fn(),
    });

    (document.querySelector('.mes[mesid="0"] .ztracker-regenerate-button') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    expect(actions.generateTracker).toHaveBeenCalledTimes(1);
    expect(actions.generateTracker).toHaveBeenCalledWith(0, { showStatusIndicator: true });
  });
});
