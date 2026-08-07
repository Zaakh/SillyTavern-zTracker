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
  includeZTrackerMessages: includeZTrackerMessagesMock,
}));

const { initializeGlobalUI } = await import('../ui/ui-init.js');
const { createDefaultTrackerModule } = await import('../config.js');

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
    stEchoMock.mockClear();
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

  test('opens a Module chooser for the message truck button when multiple Modules are enabled', async () => {
    const host = createSillyTavernHost();
    const actions = createUiInitActions();
    const defaultModule = createDefaultTrackerModule({ id: 'default', name: 'Default', order: 0 });
    const agendaModule = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 1 });
    const disabledModule = createDefaultTrackerModule({ id: 'disabled', name: 'Disabled', order: 2 });
    disabledModule.enabled = false;
    installSillyTavernHost(host.context);
    installExtensionsMenuDom();
    installMessageTemplateDom();
    installChatMessageDom(0, {
      innerHtml: '<div class="mes_button mes_ztracker_button"></div><div class="mes_text">Message 0</div>',
    });

    await initializeGlobalUI({
      globalContext: host.context,
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'none', modules: [defaultModule, agendaModule, disabledModule] })),
      } as any,
      actions,
      renderTrackerWithDeps: jest.fn(),
    });

    (document.querySelector('.mes[mesid="0"] .mes_ztracker_button') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    expect(actions.generateTracker).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.ztracker-module-generate-option')).toHaveLength(2);

    (document.querySelector('.ztracker-module-generate-option[data-ztracker-module="agenda"]') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    expect(actions.generateTracker).toHaveBeenCalledTimes(1);
    expect(actions.generateTracker).toHaveBeenCalledWith(0, { showStatusIndicator: true, moduleId: 'agenda' });
    expect(document.querySelector('.ztracker-module-generate-menu')).toBeNull();
  });

  test('uses the only enabled Module directly from the message truck button', async () => {
    const host = createSillyTavernHost();
    const actions = createUiInitActions();
    const agendaModule = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 0 });
    installSillyTavernHost(host.context);
    installExtensionsMenuDom();
    installMessageTemplateDom();
    installChatMessageDom(0, {
      innerHtml: '<div class="mes_button mes_ztracker_button"></div><div class="mes_text">Message 0</div>',
    });

    await initializeGlobalUI({
      globalContext: host.context,
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'none', modules: [agendaModule] })),
      } as any,
      actions,
      renderTrackerWithDeps: jest.fn(),
    });

    (document.querySelector('.mes[mesid="0"] .mes_ztracker_button') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    expect(actions.generateTracker).toHaveBeenCalledTimes(1);
    expect(actions.generateTracker).toHaveBeenCalledWith(0, { showStatusIndicator: true, moduleId: 'agenda' });
  });

  test('does not fall back to Default when no Module is enabled from the message truck button', async () => {
    const host = createSillyTavernHost();
    const actions = createUiInitActions();
    const disabledModule = createDefaultTrackerModule({ id: 'default', name: 'Default', order: 0 });
    disabledModule.enabled = false;
    installSillyTavernHost(host.context);
    installExtensionsMenuDom();
    installMessageTemplateDom();
    installChatMessageDom(0, {
      innerHtml: '<div class="mes_button mes_ztracker_button"></div><div class="mes_text">Message 0</div>',
    });

    await initializeGlobalUI({
      globalContext: host.context,
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'none', modules: [disabledModule] })),
      } as any,
      actions,
      renderTrackerWithDeps: jest.fn(),
    });

    (document.querySelector('.mes[mesid="0"] .mes_ztracker_button') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    expect(actions.generateTracker).not.toHaveBeenCalled();
    expect(stEchoMock).toHaveBeenCalledWith('warning', 'No zTracker Modules are enabled. Enable a Module before generating a tracker.');
  });
});
