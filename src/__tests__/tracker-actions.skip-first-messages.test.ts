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
  makeChat,
  makeContext,
  makeGenerateRequest,
  makeProfile,
  makeSettings,
  renderTrackerWithDepsMock,
  resetTrackerActionTestState,
  stEchoMock,
  TEST_IMPORT_META_URL,
} from '../test-utils/tracker-actions-test-helpers.js';

const trackerPartsModule = await import('../tracker-parts.js');

describe('createTrackerActions skipFirstXMessages', () => {
  const originalStructuredClone = globalThis.structuredClone;

  beforeEach(() => {
    resetTrackerActionTestState();
    globalThis.structuredClone = originalStructuredClone ?? ((value: unknown) => JSON.parse(JSON.stringify(value)));
    installSillyTavernContext(makeContext());
  });

  afterEach(() => {
    globalThis.structuredClone = originalStructuredClone;
  });

  test('shows an info toast and skips manual generation before the threshold', async () => {
    const generateRequest = makeGenerateRequest();

    const actions = createTrackerActions({
      globalContext: {
        chat: makeChat(4),
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile()],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerSystemPromptMode: 'profile', skipFirstXMessages: 6 }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(3);

    expect(stEchoMock).toHaveBeenCalledWith(
      'info',
      'Tracker generation skipped: this message is within the first 6 messages.',
    );
    expect(buildPromptMock).not.toHaveBeenCalled();
    expect(generateRequest).not.toHaveBeenCalled();
  });

  test('silently skips auto generation before the threshold', async () => {
    const generateRequest = makeGenerateRequest();

    const actions = createTrackerActions({
      globalContext: {
        chat: makeChat(4),
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile()],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerSystemPromptMode: 'profile', skipFirstXMessages: 6 }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(3, { silent: true });

    expect(stEchoMock).not.toHaveBeenCalled();
    expect(buildPromptMock).not.toHaveBeenCalled();
    expect(generateRequest).not.toHaveBeenCalled();
  });

  test('allows generation once the message reaches the threshold', async () => {
    applyTrackerUpdateAndRenderMock.mockImplementation(() => undefined);
    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const generateRequest = makeGenerateRequest();

    const actions = createTrackerActions({
      globalContext: {
        chat: makeChat(7),
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile()],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerSystemPromptMode: 'profile', skipFirstXMessages: 6 }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(6);

    expect(buildPromptMock).toHaveBeenCalled();
    expect(generateRequest).toHaveBeenCalled();
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
    expect(stEchoMock).not.toHaveBeenCalled();
  });

  test('allows full redo of an existing tracker before the threshold', async () => {
    applyTrackerUpdateAndRenderMock.mockImplementation(() => undefined);
    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const generateRequest = makeGenerateRequest();
    const chat = makeChat(4);
    chat[3].extra = {
      zTracker: {
        schemaKey: 'default',
        schemaValue: { time: '09:00:00' },
        schemaHtml: '<div></div>',
      },
    } as any;

    const actions = createTrackerActions({
      globalContext: {
        chat,
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile()],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerSystemPromptMode: 'profile', skipFirstXMessages: 6 }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(3);

    expect(buildPromptMock).toHaveBeenCalled();
    expect(generateRequest).toHaveBeenCalled();
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
    expect(stEchoMock).not.toHaveBeenCalledWith(
      'info',
      'Tracker generation skipped: this message is within the first 6 messages.',
    );
  });

  test('allows full redo before the threshold during sequential generation', async () => {
    applyTrackerUpdateAndRenderMock.mockImplementation(() => undefined);
    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    (trackerPartsModule.buildTopLevelPartSchema as jest.Mock).mockReturnValue({
      type: 'object',
      properties: { time: { type: 'string' } },
      required: ['time'],
    });
    (trackerPartsModule.mergeTrackerPart as jest.Mock).mockImplementation((currentTracker, partKey, response) => ({
      ...(currentTracker ?? {}),
      [partKey]: response?.[partKey] ?? response,
    }));

    const generateRequest = makeGenerateRequest({ content: { time: '10:00:00' } });
    const chat = makeChat(4);
    chat[3].extra = {
      zTracker: {
        schemaKey: 'default',
        schemaValue: { time: '09:00:00' },
        schemaHtml: '<div></div>',
      },
    } as any;

    const actions = createTrackerActions({
      globalContext: {
        chat,
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile()],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () => makeSettings({ trackerSystemPromptMode: 'profile', skipFirstXMessages: 6, sequentialPartGeneration: true }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(3);

    expect(buildPromptMock).toHaveBeenCalled();
    expect(generateRequest).toHaveBeenCalled();
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
    expect(stEchoMock).not.toHaveBeenCalledWith(
      'info',
      'Tracker generation skipped: this message is within the first 6 messages.',
    );
  });
});
