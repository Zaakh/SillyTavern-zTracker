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
  TEST_IMPORT_META_URL,
} from '../test-utils/tracker-actions-test-helpers.js';

const trackerPartsModule = await import('../tracker-parts.js');

/** Builds the minimal DOM needed to exercise a real context-menu part regeneration path. */
function buildMessage(messageId: number): string {
  return `
    <div id="extensionsMenu"></div>
    <div class="mes" mesid="${messageId}">
      <div class="mes_text">Message ${messageId}</div>
      <div class="ztracker-part-regenerate-button" data-ztracker-part="time"></div>
    </div>
  `;
}

/** Flushes pending microtasks so the async request reaches the in-flight badge state before assertions. */
async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createTrackerActions context-menu indicator', () => {
  const originalCss = globalThis.CSS;

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
  });

  afterEach(() => {
    globalThis.CSS = originalCss;
  });

  test('shows and clears the message-local badge during part regeneration from the context menu', async () => {
    document.body.innerHTML = buildMessage(0);

    let finishRequest: (() => void) | undefined;
    const generateRequest = jest.fn((_request, hooks) => {
      hooks.onStart('request-1');
      finishRequest = () => hooks.onFinish('request-1', { content: { time: '10:00:00' } }, null);
    });

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: { zTracker: { schemaValue: { time: '09:00:00' } } } }],
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

    const pending = actions.generateTrackerPart(0, 'time');
    await flushAsyncWork();

    expect(document.querySelector('.ztracker-context-menu-status')?.textContent).toContain('Updating tracker from menu');
    expect(document.querySelector('.ztracker-part-regenerate-button')?.classList.contains('spinning')).toBe(true);

    finishRequest?.();
    await pending;

    expect(document.querySelector('.ztracker-context-menu-status')).toBeNull();
    expect(document.querySelector('.ztracker-part-regenerate-button')?.classList.contains('spinning')).toBe(false);
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });
});