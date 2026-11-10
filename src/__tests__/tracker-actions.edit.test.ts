/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import {
  applyTrackerUpdateAndRenderMock,
  createTrackerActions,
  installSillyTavernContext,
  makeContext,
  makeProfile,
  makeSettings,
  renderTrackerWithDepsMock,
  resetTrackerActionTestState,
  stEchoMock,
  TEST_IMPORT_META_URL,
} from '../test-utils/tracker-actions-test-helpers.js';

describe('createTrackerActions editTracker', () => {
  beforeEach(() => {
    resetTrackerActionTestState();
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));
  });

  test('edits the selected module record instead of the legacy default tracker', async () => {
    document.body.innerHTML = '<div class="mes" mesid="0"><div class="mes_ztracker" data-ztracker-module="agenda"><details open><summary>Tracker</summary></details></div><div class="mes_text"></div></div>';

    const saveChat = jest.fn(async () => undefined);
    let popupContent: HTMLElement | undefined;
    let popupOptions: { onClose?: (popup: any) => Promise<void> | void } | undefined;
    const message = {
      original_avatar: 'avatar.png',
      extra: {
        zTracker: {
          schemaValue: { time: '09:00:00' },
          schemaHtml: '<div>{{data.time}}</div>',
          byId: {
            agenda: {
              schemaValue: { task: 'Find the exit' },
              schemaHtml: '<div>{{data.task}}</div>',
            },
          },
        },
      },
    };

    const actions = createTrackerActions({
      globalContext: {
        chat: [message],
        saveChat,
        callGenericPopup: jest.fn((content: string, _type: unknown, _title: string, options: any) => {
          popupContent = document.createElement('div');
          popupContent.innerHTML = content;
          document.body.appendChild(popupContent);
          popupOptions = options;
        }),
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: { getSettings: () => makeSettings() } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.editTracker(0, 'agenda');

    const textarea = popupContent?.querySelector('#ztracker-edit-textarea') as HTMLTextAreaElement | null;
    expect(textarea?.value).toBe(JSON.stringify({ task: 'Find the exit' }, null, 2));
    textarea!.value = '{"task":"Open the gate"}';

    await popupOptions?.onClose?.({ result: 'affirmative', content: popupContent });

    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalledWith(
      message,
      expect.objectContaining({
        moduleId: 'agenda',
        trackerData: { task: 'Open the gate' },
        trackerHtml: '<div>{{data.task}}</div>',
      }),
    );
    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(renderTrackerWithDepsMock).not.toHaveBeenCalled();
  });

  test('does not save invalid tracker edits when rerender validation fails', async () => {
    document.body.innerHTML = '<div class="mes" mesid="0"><div class="mes_ztracker"><details open><summary>Tracker</summary></details></div><div class="mes_text"></div></div>';

    const saveChat = jest.fn(async () => undefined);
    let popupContent: HTMLElement | undefined;
    let popupOptions: { onClose?: (popup: any) => Promise<void> | void } | undefined;

    applyTrackerUpdateAndRenderMock.mockImplementation(() => {
      throw new Error('render failed');
    });

    const actions = createTrackerActions({
      globalContext: {
        chat: [
          {
            original_avatar: 'avatar.png',
            extra: {
              zTracker: {
                schemaValue: { time: '09:00:00' },
                schemaHtml: '<div>{{data.time}}</div>',
              },
            },
          },
        ],
        saveChat,
        callGenericPopup: jest.fn((content: string, _type: unknown, _title: string, options: any) => {
          popupContent = document.createElement('div');
          popupContent.innerHTML = content;
          document.body.appendChild(popupContent);
          popupOptions = options;
        }),
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: { getSettings: () => makeSettings() } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.editTracker(0);

    const textarea = popupContent?.querySelector('#ztracker-edit-textarea') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    textarea!.value = '{"time":"10:00:00"}';

    await popupOptions?.onClose?.({ result: 'affirmative', content: popupContent });

    expect(saveChat).not.toHaveBeenCalled();
    expect(renderTrackerWithDepsMock).toHaveBeenCalledTimes(1);
    expect(stEchoMock).toHaveBeenCalledWith('error', 'Tracker data failed to render. Changes were not saved.');
  });

  test('rolls back tracker edits when saving the chat fails', async () => {
    document.body.innerHTML = '<div class="mes" mesid="0"><div class="mes_ztracker"><details open><summary>Tracker</summary></details></div><div class="mes_text"></div></div>';

    const rollback = jest.fn(() => undefined);
    const saveChat = jest.fn(async () => {
      throw new Error('save failed');
    });
    let popupContent: HTMLElement | undefined;
    let popupOptions: { onClose?: (popup: any) => Promise<void> | void } | undefined;

    applyTrackerUpdateAndRenderMock.mockImplementation(() => rollback);

    const actions = createTrackerActions({
      globalContext: {
        chat: [
          {
            original_avatar: 'avatar.png',
            extra: {
              zTracker: {
                schemaValue: { time: '09:00:00' },
                schemaHtml: '<div>{{data.time}}</div>',
              },
            },
          },
        ],
        saveChat,
        callGenericPopup: jest.fn((content: string, _type: unknown, _title: string, options: any) => {
          popupContent = document.createElement('div');
          popupContent.innerHTML = content;
          document.body.appendChild(popupContent);
          popupOptions = options;
        }),
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: { getSettings: () => makeSettings() } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.editTracker(0);

    const textarea = popupContent?.querySelector('#ztracker-edit-textarea') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    textarea!.value = '{"time":"10:00:00"}';

    await popupOptions?.onClose?.({ result: 'affirmative', content: popupContent });

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(renderTrackerWithDepsMock).toHaveBeenCalledTimes(1);
    expect(stEchoMock).toHaveBeenCalledWith('error', 'Tracker changes could not be saved. Changes were rolled back.');
  });
});

describe('createTrackerActions deleteTracker', () => {
  test('removes the lorebook link and the World Info record together with the Module record', async () => {
    resetTrackerActionTestState();
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));
    const message = {
      extra: {
        zTracker: {
          byId: {
            agenda: {
              schemaValue: { task: 'x' },
              schemaHtml: '<div/>',
              lorebookLink: { book: 'Characters', uid: 1, title: 'Bob' },
              worldInfo: { outcome: 'none-matched', books: [] },
            },
          },
        },
      },
    };
    const actions = createTrackerActions({
      globalContext: {
        chat: [message],
        saveChat: jest.fn(async () => undefined),
        Popup: { show: { confirm: jest.fn(async () => true) } },
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: { getSettings: () => makeSettings() } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.deleteTracker(0, 'agenda');

    expect((message.extra.zTracker.byId as any).agenda).toBeUndefined();
  });
});

describe('createTrackerActions showWorldInfoReport', () => {
  const instances: Array<{ content: HTMLElement; complete: jest.Mock }> = [];
  class FakePopup {
    content: HTMLElement;
    complete = jest.fn(async (..._args: unknown[]) => undefined);
    constructor(content: HTMLElement) {
      this.content = content;
      instances.push(this);
    }
    show = jest.fn(async () => undefined);
  }

  function setup(extra: Record<string, unknown>, host: Record<string, unknown> = {}) {
    resetTrackerActionTestState();
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));
    instances.length = 0;
    const actions = createTrackerActions({
      globalContext: {
        chat: [{ extra }],
        saveChat: jest.fn(async () => undefined),
        Popup: FakePopup,
        getWorldInfoNames: () => ['Lore'],
        loadWorldInfo: async () => ({ entries: { '1': {} } }),
        reloadWorldInfoEditor: jest.fn(),
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
        ...host,
      },
      settingsManager: { getSettings: () => makeSettings() } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });
    return { actions };
  }

  const popupText = () => instances[0].content.textContent ?? '';

  test('opens the popup with the record of the clicked Module, not another Module', async () => {
    const { actions } = setup({
      zTracker: {
        byId: {
          default: { schemaValue: {}, worldInfo: { outcome: 'excluded', books: [] } },
          agenda: {
            schemaValue: {},
            worldInfo: { outcome: 'applied', books: [{ book: 'Agenda Book', applied: [{ uid: 1, title: 'Plan', via: 'allowlist' }], skipped: [] }] },
          },
        },
      },
    });

    await actions.showWorldInfoReport(0, 'agenda');

    expect(instances).toHaveLength(1);
    expect(popupText()).toContain('Agenda Book');
    expect(popupText()).not.toContain('excluded for this tracker');
  });

  test('says the World Info was not recorded for a tracker without a record', async () => {
    const { actions } = setup({ zTracker: { byId: { default: { schemaValue: { time: 'x' } } } } });

    await actions.showWorldInfoReport(0);

    expect(popupText()).toContain('not recorded');
  });

  describe('clicking an entry', () => {
    const extra = { zTracker: { byId: { default: { schemaValue: {}, worldInfo: { outcome: 'applied', books: [{ book: 'Lore', applied: [{ uid: 1, title: 'Dragon', via: 'allowlist' }], skipped: [] }] } } } } };
    const row = () => instances[0].content.querySelector('li.ztracker-wi-entry') as HTMLElement;
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
    // A fake editor that shows entry #1 as soon as the book is selected, so a navigation finishes instead of timing out.
    const editorShowingEntry = () =>
      jest.fn(() => {
        document.body.innerHTML = '<div id="world_popup_entries_list"><div class="world_entry" uid="1"></div></div>';
      });

    test('closes the popup, then opens the book in the editor', async () => {
      const reloadWorldInfoEditor = editorShowingEntry();
      const { actions } = setup(extra, { reloadWorldInfoEditor });
      await actions.showWorldInfoReport(0);

      row().click();
      await settle();

      expect(instances[0].complete).toHaveBeenCalledWith('cancelled');
      expect(reloadWorldInfoEditor).toHaveBeenCalledWith('Lore', true);
      expect(instances[0].complete.mock.invocationCallOrder[0]).toBeLessThan(reloadWorldInfoEditor.mock.invocationCallOrder[0]);
    });

    test('a second click while one is opening is ignored without a warning', async () => {
      const reloadWorldInfoEditor = editorShowingEntry();
      const { actions } = setup(extra, { reloadWorldInfoEditor });
      await actions.showWorldInfoReport(0);

      row().click();
      row().click();
      await settle();

      expect(instances[0].complete).toHaveBeenCalledTimes(1);
      expect(stEchoMock).not.toHaveBeenCalledWith('warning', expect.stringContaining('still opening'));
    });

    test('a throwing host warns instead of failing silently', async () => {
      const { actions } = setup(extra, {
        getWorldInfoNames: () => {
          throw new Error('host gone');
        },
      });
      await actions.showWorldInfoReport(0);

      row().click();
      await settle();

      expect(stEchoMock).toHaveBeenCalledWith('warning', expect.stringContaining('host gone'));
      expect(instances[0].complete).not.toHaveBeenCalled();
    });

    test('a deleted entry warns and keeps the popup open and the editor closed', async () => {
      const reloadWorldInfoEditor = jest.fn();
      const { actions } = setup(extra, { reloadWorldInfoEditor, loadWorldInfo: async () => ({ entries: {} }) });
      await actions.showWorldInfoReport(0);

      row().click();
      await settle();

      expect(stEchoMock).toHaveBeenCalledWith('warning', expect.stringContaining('no longer exists'));
      expect(instances[0].complete).not.toHaveBeenCalled();
      expect(reloadWorldInfoEditor).not.toHaveBeenCalled();
    });
  });
});
