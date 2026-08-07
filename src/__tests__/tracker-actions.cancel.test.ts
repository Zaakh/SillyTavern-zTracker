/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import {
  applyTrackerUpdateAndRenderMock,
  buildPromptMock,
  createTrackerModuleFromLegacySettings,
  createTrackerActions,
  installSillyTavernContext,
  makeBuiltPromptResult,
  makeContext,
  makeGenerateRequest,
  makeProfile,
  makeSettings,
  renderTrackerWithDepsMock,
  resetTrackerActionTestState,
  stEchoMock,
  TEST_IMPORT_META_URL,
} from '../test-utils/tracker-actions-test-helpers.js';

describe('createTrackerActions cancellation', () => {
  beforeEach(() => {
    resetTrackerActionTestState();
  });

  test('cancels a tracker run before the request is dispatched', async () => {
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    let resolveBuildPrompt: (value: ReturnType<typeof makeBuiltPromptResult>) => void = () => undefined;
    const buildPromptPromise = new Promise<ReturnType<typeof makeBuiltPromptResult>>((resolve) => {
      resolveBuildPrompt = resolve;
    });
    buildPromptMock.mockImplementation(() => buildPromptPromise as any);

    const generateRequest = jest.fn();
    const abortRequest = jest.fn();
    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile()],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: { getSettings: () => makeSettings() } as any,
      generator: { generateRequest, abortRequest } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    const generationPromise = actions.generateTracker(0);

    expect(actions.cancelTracker(0)).toBe(true);

    resolveBuildPrompt(makeBuiltPromptResult());

    await expect(generationPromise).resolves.toBe(false);
    expect(generateRequest).not.toHaveBeenCalled();
    expect(abortRequest).not.toHaveBeenCalled();
    expect(applyTrackerUpdateAndRenderMock).not.toHaveBeenCalled();
    expect(stEchoMock).toHaveBeenCalledWith('info', 'Tracker generation cancelled.');
  });

  test('cancels only the targeted module run', async () => {
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    const promptResolvers: Array<(value: ReturnType<typeof makeBuiltPromptResult>) => void> = [];
    buildPromptMock.mockImplementation(() => new Promise<ReturnType<typeof makeBuiltPromptResult>>((resolve) => {
      promptResolvers.push(resolve);
    }) as any);

    const generateRequest = makeGenerateRequest();
    const abortRequest = jest.fn();
    const defaultModule = createTrackerModuleFromLegacySettings(makeSettings(), { id: 'default', name: 'Default', order: 0 });
    const agendaModule = createTrackerModuleFromLegacySettings(makeSettings(), { id: 'agenda', name: 'Agenda', order: 1 });

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: {
          connectionManager: {
            profiles: [makeProfile()],
          },
        },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () => makeSettings({ modules: [defaultModule, agendaModule] }),
      } as any,
      generator: { generateRequest, abortRequest } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    const agendaGeneration = actions.generateTracker(0, { moduleId: 'agenda' });
    const defaultGeneration = actions.generateTracker(0, { moduleId: 'default' });

    expect(actions.cancelTracker(0, 'agenda')).toBe(true);

    promptResolvers.forEach((resolve) => resolve(makeBuiltPromptResult()));

    await expect(agendaGeneration).resolves.toBe(false);
    await expect(defaultGeneration).resolves.toBe(true);
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalledTimes(1);
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ moduleId: 'default' }),
    );
    expect(abortRequest).not.toHaveBeenCalled();
  });
});