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

describe('createTrackerActions skipFirstXMessages', () => {
  beforeEach(() => {
    resetTrackerActionTestState();
    installSillyTavernContext(makeContext());
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
});
