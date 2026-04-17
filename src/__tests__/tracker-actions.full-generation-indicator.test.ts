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

/** Builds the minimal DOM needed to show full-tracker generation state on a message. */
function buildMessage(messageId: number): string {
  return `
    <div id="extensionsMenu"></div>
    <div class="mes" mesid="${messageId}">
      <div class="mes_text">Message ${messageId}</div>
      <div class="mes_button mes_ztracker_button"></div>
      <div class="ztracker-regenerate-button"></div>
    </div>
  `;
}

/** Flushes pending microtasks so async tracker setup reaches the request boundary before assertions. */
async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createTrackerActions full generation indicator', () => {
  const originalStructuredClone = globalThis.structuredClone;

  beforeEach(() => {
    resetTrackerActionTestState();
    globalThis.structuredClone = originalStructuredClone ?? ((value: unknown) => JSON.parse(JSON.stringify(value)));
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
    globalThis.structuredClone = originalStructuredClone;
  });

  test('shows and clears a message-local badge during full tracker regeneration', async () => {
    document.body.innerHTML = buildMessage(0);

    let finishRequest: (() => void) | undefined;
    const generateRequest = jest.fn((_request, hooks) => {
      hooks.onStart('request-1');
      finishRequest = () => hooks.onFinish('request-1', { content: { time: '10:00:00' } }, null);
    });

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
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

    const pending = actions.generateTracker(0);
    await flushAsyncWork();

    expect(document.querySelector('.ztracker-full-tracker-status')?.textContent).toContain('Updating tracker');
    expect(document.querySelector('.mes_ztracker_button')?.classList.contains('spinning')).toBe(true);
    expect(document.querySelector('.ztracker-regenerate-button')?.classList.contains('spinning')).toBe(true);

    finishRequest?.();
    await pending;

    expect(document.querySelector('.ztracker-full-tracker-status')).toBeNull();
    expect(document.querySelector('.mes_ztracker_button')?.classList.contains('spinning')).toBe(false);
    expect(document.querySelector('.ztracker-regenerate-button')?.classList.contains('spinning')).toBe(false);
  });

  test('shows the same badge during sequential full tracker regeneration', async () => {
    document.body.innerHTML = buildMessage(0);

    let finishRequest: (() => void) | undefined;
    const generateRequest = jest.fn((_request, hooks) => {
      hooks.onStart('request-1');
      finishRequest = () => hooks.onFinish('request-1', { content: { time: '10:00:00' } }, null);
    });

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: { getSettings: () => makeSettings({ sequentialPartGeneration: true }) } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    const pending = actions.generateTracker(0);
    await flushAsyncWork();

    expect(document.querySelector('.ztracker-full-tracker-status')?.textContent).toContain('Updating tracker');

    finishRequest?.();
    await pending;

    expect(document.querySelector('.ztracker-full-tracker-status')).toBeNull();
  });

  test('does not show the manual full-tracker badge for silent generation', async () => {
    document.body.innerHTML = buildMessage(0);

    let finishRequest: (() => void) | undefined;
    const generateRequest = jest.fn((_request, hooks) => {
      hooks.onStart('request-1');
      finishRequest = () => hooks.onFinish('request-1', { content: { time: '10:00:00' } }, null);
    });

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
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

    const pending = actions.generateTracker(0, { silent: true });
    await flushAsyncWork();

    expect(document.querySelector('.ztracker-full-tracker-status')).toBeNull();
    expect(document.querySelector('.mes_ztracker_button')?.classList.contains('spinning')).toBe(true);

    finishRequest?.();
    await pending;
  });
});