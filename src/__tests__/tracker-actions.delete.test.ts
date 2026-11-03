/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import {
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

/** Builds real actions over a one-message chat that carries stored data for the Default Module. */
function makeActions(confirm: jest.Mock<any>) {
  const message: any = {
    original_avatar: 'avatar.png',
    extra: { zTracker: { byId: { default: { schemaValue: { a: 1 } } } } },
  };
  const saveChat = jest.fn(async () => undefined);
  const actions = createTrackerActions({
    globalContext: {
      chat: [message],
      saveChat,
      Popup: { show: { confirm } },
      extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
      CONNECT_API_MAP: { openai: { selected: 'openai' } },
    },
    settingsManager: { getSettings: () => makeSettings() } as any,
    generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
    pendingRequests: new Map(),
    renderTrackerWithDeps: renderTrackerWithDepsMock,
    importMetaUrl: TEST_IMPORT_META_URL,
  });
  return { actions, message, saveChat };
}

describe('createTrackerActions deleteTracker', () => {
  beforeEach(() => {
    resetTrackerActionTestState();
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));
  });

  test('asks for confirmation and toasts by default, returning true', async () => {
    const confirm = jest.fn(async () => true);
    const { actions, message, saveChat } = makeActions(confirm);

    await expect(actions.deleteTracker(0, 'default')).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(message.extra.zTracker.byId.default).toBeUndefined();
    expect(saveChat).toHaveBeenCalled();
    expect(stEchoMock).toHaveBeenCalledWith('success', 'Tracker data deleted.');
  });

  test('skips the popup and success toast on request', async () => {
    const confirm = jest.fn(async () => true);
    const { actions, message } = makeActions(confirm);

    await expect(actions.deleteTracker(0, 'default', { skipConfirmation: true, skipSuccessToast: true })).resolves.toBe(
      true,
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(message.extra.zTracker.byId.default).toBeUndefined();
    expect(stEchoMock).not.toHaveBeenCalled();
  });

  test('returns false and keeps the data when the user declines', async () => {
    const { actions, message } = makeActions(jest.fn(async () => false));

    await expect(actions.deleteTracker(0, 'default')).resolves.toBe(false);
    expect(message.extra.zTracker.byId.default).toBeDefined();
  });
});

describe('createTrackerActions generate toggle', () => {
  beforeEach(() => {
    resetTrackerActionTestState();
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));
  });

  test('a second generate for a pending message and Module cancels the first and returns false', async () => {
    let resolvePrompt: (value: ReturnType<typeof makeBuiltPromptResult>) => void = () => undefined;
    buildPromptMock.mockImplementation(
      () => new Promise<ReturnType<typeof makeBuiltPromptResult>>((resolve) => (resolvePrompt = resolve)) as any,
    );
    const { actions } = makeActions(jest.fn(async () => true));

    const first = actions.generateTracker(0, { moduleId: 'default' });
    await expect(actions.generateTracker(0, { moduleId: 'default' })).resolves.toBe(false);
    resolvePrompt(makeBuiltPromptResult());

    await expect(first).resolves.toBe(false);
    expect(stEchoMock).toHaveBeenCalledWith('info', 'Tracker generation cancelled.');
  });
});
