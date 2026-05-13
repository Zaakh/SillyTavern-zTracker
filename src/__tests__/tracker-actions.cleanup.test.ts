/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import {
  applyTrackerUpdateAndRenderMock,
  buildPromptMock,
  createTrackerActions,
  installSillyTavernContext,
  makeBuiltPromptResult,
  makeContext,
  makeProfile,
  makeSettings,
  renderTrackerWithDepsMock,
  resetTrackerActionTestState,
  stEchoMock,
  TEST_IMPORT_META_URL,
} from '../test-utils/tracker-actions-test-helpers.js';

const trackerPartsModule = await import('../tracker-parts.js');

describe('createTrackerActions cleanup flow', () => {
  const originalCss = globalThis.CSS;

  async function flushAsyncWork(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  beforeEach(() => {
    resetTrackerActionTestState();
    globalThis.CSS = originalCss ?? ({ escape: (value: string) => value } as typeof CSS);
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));
    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    applyTrackerUpdateAndRenderMock.mockImplementation(() => undefined);
    (trackerPartsModule.buildTopLevelPartSchema as jest.Mock).mockReturnValue({
      type: 'object',
      properties: { time: { type: 'string' } },
      required: ['time'],
    });
    (trackerPartsModule.mergeTrackerPart as jest.Mock).mockImplementation((currentTracker, partKey, response) => ({
      ...(currentTracker ?? {}),
      [partKey]: response?.[partKey] ?? response,
    }));
    (trackerPartsModule.clearTrackerCleanupTargets as jest.Mock).mockImplementation((currentTracker) => ({
      ...currentTracker,
      time: '',
    }));
    (trackerPartsModule.buildPendingRedactions as jest.Mock).mockImplementation((targets) => ({ version: 1, targets }));
    (trackerPartsModule.removePendingRedactionTargets as jest.Mock).mockReturnValue(undefined);
  });

  afterEach(() => {
    globalThis.CSS = originalCss;
  });

  test('persists pending cleanup metadata when the popup applies clear-only', async () => {
    document.body.innerHTML = '<div id="extensionsMenu"></div><div class="mes" mesid="0"><div class="mes_text"></div></div>';

    const callGenericPopup = jest.fn((content: string, _type: unknown, _title: string, popupOptions: any) => {
      const container = document.createElement('div');
      container.innerHTML = content;
      document.body.appendChild(container);
      const checkbox = container.querySelector('[data-ztracker-cleanup-target-index="0"]') as HTMLInputElement;
      checkbox.checked = true;
      const clearOnlyRadio = container.querySelector('input[value="clear-only"]') as HTMLInputElement;
      clearOnlyRadio.checked = true;
      return popupOptions.onClose({ result: 'affirmative', content: container });
    });

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: { zTracker: { schemaValue: { time: '09:00:00' }, schemaHtml: '<div></div>' } } }],
        saveChat: async () => undefined,
        callGenericPopup,
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: { getSettings: () => makeSettings() } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.openTrackerCleanup(0);
    await flushAsyncWork();

    expect(callGenericPopup).toHaveBeenCalled();
    expect(trackerPartsModule.clearTrackerCleanupTargets).toHaveBeenCalledWith(
      { time: '09:00:00' },
      expect.any(Object),
      [{ kind: 'part', partKey: 'time' }],
    );
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        extensionData: expect.objectContaining({
          pendingRedactions: { version: 1, targets: [{ kind: 'part', partKey: 'time' }] },
        }),
      }),
    );
  });

  test('clears matching pending metadata after successful targeted regeneration', async () => {
    document.body.innerHTML = `
      <div id="extensionsMenu"></div>
      <div class="mes" mesid="0">
        <div class="mes_text">Message 0</div>
        <div class="ztracker-part-regenerate-button" data-ztracker-part="time"></div>
      </div>
    `;

    const generateRequest = jest.fn((_request, hooks) => {
      hooks.onStart('request-1');
      hooks.onFinish('request-1', { content: { time: '10:00:00' } }, null);
    });

    const actions = createTrackerActions({
      globalContext: {
        chat: [
          {
            original_avatar: 'avatar.png',
            extra: {
              zTracker: {
                schemaValue: { time: '09:00:00' },
                schemaHtml: '<div></div>',
                pendingRedactions: { version: 1, targets: [{ kind: 'part', partKey: 'time' }] },
              },
            },
          },
        ],
        saveChat: async () => undefined,
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: { getSettings: () => makeSettings() } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTrackerPart(0, 'time');

    expect(trackerPartsModule.removePendingRedactionTargets).toHaveBeenCalledWith(
      { version: 1, targets: [{ kind: 'part', partKey: 'time' }] },
      [{ kind: 'part', partKey: 'time' }],
    );
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        extensionData: expect.objectContaining({
          schemaKey: 'default',
          pendingRedactions: undefined,
        }),
      }),
    );
  });

  test('clears all pending metadata after successful full tracker regeneration', async () => {
    document.body.innerHTML = '<div id="extensionsMenu"></div><div class="mes" mesid="0"><div class="mes_ztracker_button"></div><div class="ztracker-regenerate-button"></div><div class="mes_text"></div></div>';

    const actions = createTrackerActions({
      globalContext: {
        chat: [
          {
            original_avatar: 'avatar.png',
            extra: {
              zTracker: {
                schemaValue: { time: '09:00:00' },
                schemaHtml: '<div></div>',
                pendingRedactions: { version: 1, targets: [{ kind: 'part', partKey: 'time' }] },
              },
            },
          },
        ],
        saveChat: async () => undefined,
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: { getSettings: () => makeSettings() } as any,
      generator: { generateRequest: jest.fn((_request, hooks) => {
        hooks.onStart('request-1');
        hooks.onFinish('request-1', { content: { time: '10:00:00' } }, null);
      }), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        extensionData: expect.objectContaining({
          schemaKey: 'default',
          pendingRedactions: undefined,
        }),
      }),
    );
  });

  test('uses the message schema preset for targeted regeneration instead of the currently selected preset', async () => {
    document.body.innerHTML = `
      <div id="extensionsMenu"></div>
      <div class="mes" mesid="0">
        <div class="mes_text">Message 0</div>
        <div class="ztracker-part-regenerate-button" data-ztracker-part="time"></div>
      </div>
    `;

    const generateRequest = jest.fn((_request, hooks) => {
      hooks.onStart('request-1');
      hooks.onFinish('request-1', { content: { time: '10:00:00' } }, null);
    });

    const defaultSchema = {
      type: 'object',
      properties: { time: { type: 'string' } },
      required: ['time'],
    };

    const saveMetadataDebounced = jest.fn();

    const actions = createTrackerActions({
      globalContext: {
        chat: [
          {
            original_avatar: 'avatar.png',
            extra: {
              zTracker: {
                schemaKey: 'default',
                schemaValue: { time: '09:00:00' },
                schemaHtml: '<div></div>',
              },
            },
          },
        ],
        saveChat: async () => undefined,
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () =>
          makeSettings({
            schemaPreset: 'alternate',
            schemaPresets: {
              default: { name: 'Default', value: defaultSchema, html: '<div></div>' },
              alternate: {
                name: 'Alternate',
                value: { type: 'object', properties: { weather: { type: 'string' } }, required: ['weather'] },
                html: '<div></div>',
              },
            },
          }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    (SillyTavern.getContext() as any).saveMetadataDebounced = saveMetadataDebounced;
    (SillyTavern.getContext() as any).chatMetadata = { zTracker: { schemaKey: 'alternate' } };

    await actions.generateTrackerPart(0, 'time');

    expect(trackerPartsModule.buildTopLevelPartSchema).toHaveBeenCalledWith(defaultSchema, 'time');
    expect((SillyTavern.getContext() as any).chatMetadata).toEqual({ zTracker: { schemaKey: 'alternate' } });
    expect(saveMetadataDebounced).not.toHaveBeenCalled();
  });

  test('notifies when targeted regeneration still uses an older message schema after the chat schema changes', async () => {
    document.body.innerHTML = `
      <div id="extensionsMenu"></div>
      <div class="mes" mesid="0">
        <div class="mes_text">Message 0</div>
        <div class="ztracker-part-regenerate-button" data-ztracker-part="time"></div>
      </div>
    `;

    const generateRequest = jest.fn((_request, hooks) => {
      hooks.onStart('request-1');
      hooks.onFinish('request-1', { content: { time: '10:00:00' } }, null);
    });

    const actions = createTrackerActions({
      globalContext: {
        chat: [
          {
            original_avatar: 'avatar.png',
            extra: {
              zTracker: {
                schemaKey: 'default',
                schemaValue: { time: '09:00:00' },
                schemaHtml: '<div></div>',
              },
            },
          },
        ],
        saveChat: async () => undefined,
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () =>
          makeSettings({
            schemaPreset: 'alternate',
            schemaPresets: {
              default: {
                name: 'Default',
                value: { type: 'object', properties: { time: { type: 'string' } }, required: ['time'] },
                html: '<div></div>',
              },
              alternate: {
                name: 'Alternate',
                value: { type: 'object', properties: { weather: { type: 'string' } }, required: ['weather'] },
                html: '<div></div>',
              },
            },
          }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    (SillyTavern.getContext() as any).chatMetadata = { zTracker: { schemaKey: 'alternate' } };

    await actions.generateTrackerPart(0, 'time');

    expect(stEchoMock).toHaveBeenCalledWith(
      'info',
      expect.stringContaining('Run a full tracker regeneration for this message to move it onto the current chat schema'),
    );
  });

  test('shows the schema mismatch notice only once during clear-and-recreate batches', async () => {
    document.body.innerHTML = '<div id="extensionsMenu"></div><div class="mes" mesid="0"><div class="mes_text"></div></div>';

    (trackerPartsModule.resolveTopLevelPartsOrder as jest.Mock).mockReturnValue(['time', 'weather']);
    (trackerPartsModule.buildTopLevelPartSchema as jest.Mock).mockImplementation((_schema, partKey) => ({
      type: 'object',
      properties: { [partKey]: { type: 'string' } },
      required: [partKey],
    }));

    const callGenericPopup = jest.fn((content: string, _type: unknown, _title: string, popupOptions: any) => {
      const container = document.createElement('div');
      container.innerHTML = content;
      document.body.appendChild(container);
      const checkboxes = Array.from(container.querySelectorAll('[data-ztracker-cleanup-target-index]')) as HTMLInputElement[];
      for (const checkbox of checkboxes) {
        checkbox.checked = true;
      }
      return popupOptions.onClose({ result: 'affirmative', content: container });
    });

    const generateRequest = jest.fn((_request, hooks) => {
      hooks.onStart('request-1');
      hooks.onFinish('request-1', { content: { time: '10:00:00', weather: 'Rain' } }, null);
    });

    const actions = createTrackerActions({
      globalContext: {
        chat: [
          {
            original_avatar: 'avatar.png',
            extra: {
              zTracker: {
                schemaKey: 'default',
                schemaValue: { time: '09:00:00', weather: 'Sunny' },
                schemaHtml: '<div></div>',
              },
            },
          },
        ],
        saveChat: async () => undefined,
        callGenericPopup,
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () =>
          makeSettings({
            schemaPreset: 'alternate',
            schemaPresets: {
              default: {
                name: 'Default',
                value: {
                  type: 'object',
                  properties: { time: { type: 'string' }, weather: { type: 'string' } },
                  required: ['time', 'weather'],
                },
                html: '<div></div>',
              },
              alternate: {
                name: 'Alternate',
                value: {
                  type: 'object',
                  properties: { time: { type: 'string' }, weather: { type: 'string' } },
                  required: ['time', 'weather'],
                },
                html: '<div></div>',
              },
            },
          }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    (SillyTavern.getContext() as any).chatMetadata = { zTracker: { schemaKey: 'alternate' } };

    await actions.openTrackerCleanup(0);
    await flushAsyncWork();

    const mismatchMessages = stEchoMock.mock.calls.filter(
      ([type, message]) => type === 'info' && typeof message === 'string' && message.includes('full tracker regeneration for this message'),
    );
    expect(mismatchMessages).toHaveLength(1);
  });
});