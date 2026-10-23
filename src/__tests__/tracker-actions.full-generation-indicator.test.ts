/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import {
  type GeneratorHooks, type AnyMock,
  applyTrackerUpdateAndRenderMock,
  buildPromptMock,
  createTrackerActions,
  createTrackerModuleFromLegacySettings,
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

/** Builds the minimal DOM needed to show full-tracker generation state on a message. */
function buildMessage(messageId: number): string {
  return `
    <div id="extensionsMenu"></div>
    <div class="mes" mesid="${messageId}">
      <div class="mes_text">Message ${messageId}</div>
      <div class="mes_button mes_ztracker_button"></div>
      <div class="mes_ztracker" data-ztracker-module="default">
        <div class="ztracker-regenerate-button"></div>
      </div>
    </div>
  `;
}

/** Flushes pending microtasks so async tracker setup reaches the request boundary before assertions. */
async function flushAsyncWork(): Promise<void> {
  // A macrotask hop lets the World Info scan step and the request reach the in-flight state.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('createTrackerActions full generation indicator', () => {
  const originalStructuredClone = globalThis.structuredClone;

  beforeEach(() => {
    resetTrackerActionTestState();
    globalThis.structuredClone = originalStructuredClone ?? ((value: unknown) => JSON.parse(JSON.stringify(value)));
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));
    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    applyTrackerUpdateAndRenderMock.mockImplementation(() => undefined);
    (trackerPartsModule.buildTopLevelPartSchema as AnyMock).mockReturnValue({
      type: 'object',
      properties: { time: { type: 'string' } },
      required: ['time'],
    });
    (trackerPartsModule.mergeTrackerPart as AnyMock).mockImplementation((currentTracker, partKey, response) => ({
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
    const generateRequest = jest.fn((_request: unknown, hooks: GeneratorHooks) => {
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

  test('spins only the regenerate button for the active Module block', async () => {
    document.body.innerHTML = `
      <div id="extensionsMenu"></div>
      <div class="mes" mesid="0">
        <div class="mes_text">Message 0</div>
        <div class="mes_button mes_ztracker_button"></div>
        <div class="mes_ztracker" data-ztracker-module="default">
          <div class="ztracker-regenerate-button default-regenerate"></div>
        </div>
        <div class="mes_ztracker" data-ztracker-module="agenda">
          <div class="ztracker-regenerate-button agenda-regenerate"></div>
        </div>
      </div>
    `;

    let finishRequest: (() => void) | undefined;
    const generateRequest = jest.fn((_request: unknown, hooks: GeneratorHooks) => {
      hooks.onStart('request-1');
      finishRequest = () => hooks.onFinish('request-1', { content: { time: '10:00:00' } }, null);
    });
    const baseSettings = makeSettings();
    const defaultModule = createTrackerModuleFromLegacySettings(baseSettings, { id: 'default', name: 'Default', order: 0 });
    const agendaModule = createTrackerModuleFromLegacySettings(baseSettings, { id: 'agenda', name: 'Agenda', order: 1 });

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: { getSettings: () => makeSettings({ modules: [defaultModule, agendaModule] }) } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    const pending = actions.generateTracker(0, { moduleId: 'agenda' });
    await flushAsyncWork();

    expect(document.querySelector('.default-regenerate')?.classList.contains('spinning')).toBe(false);
    expect(document.querySelector('.agenda-regenerate')?.classList.contains('spinning')).toBe(true);

    finishRequest?.();
    await pending;
  });

  test('shows the same badge during sequential full tracker regeneration', async () => {
    document.body.innerHTML = buildMessage(0);

    let finishRequest: (() => void) | undefined;
    const generateRequest = jest.fn((_request: unknown, hooks: GeneratorHooks) => {
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

  /** Builds actions over one message with the given settings, returning handles to drive the request. */
  function setup(settings = makeSettings(), generateRequestImpl?: (request: unknown, hooks: GeneratorHooks) => void) {
    const finishers: Array<() => void> = [];
    const aborters = new Map<string, () => void>();
    const generateRequest = jest.fn(
      generateRequestImpl ??
        ((_request: unknown, hooks: GeneratorHooks) => {
          const id = `request-${finishers.length + 1}`;
          hooks.onStart(id);
          finishers.push(() => hooks.onFinish(id, { content: { time: '10:00:00' } }, null));
          // Like the real generator: an aborted request finishes without data.
          aborters.set(id, () => hooks.onFinish(id, undefined, null));
        }),
    );
    const abortRequest = jest.fn((id: string) => aborters.get(id)?.());
    const actions = createTrackerActions({
      globalContext: {
        chat: [
          { original_avatar: 'avatar.png', extra: {} },
          { original_avatar: 'avatar.png', extra: {} },
        ],
        saveChat: async () => undefined,
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: { getSettings: () => settings } as any,
      generator: { generateRequest, abortRequest } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });
    return { actions, finishers, generateRequest, abortRequest };
  }

  const badgeText = (field: 'phase' | 'step') =>
    document.querySelector(`.ztracker-full-tracker-status .ztracker-message-status-${field}`)?.textContent;

  test('shows the badge for a silent (auto-mode) run and removes it on success', async () => {
    document.body.innerHTML = buildMessage(0);
    const { actions, finishers } = setup();

    const pending = actions.generateTracker(0, { silent: true });
    await flushAsyncWork();

    expect(document.querySelector('.ztracker-full-tracker-status')).not.toBeNull();
    expect(document.querySelector('.ztracker-message-status-timer')).not.toBeNull();

    finishers[0]();
    await pending;
    expect(document.querySelector('.ztracker-full-tracker-status')).toBeNull();
  });

  test('removes the badge when a silent run fails', async () => {
    document.body.innerHTML = buildMessage(0);
    const { actions } = setup(makeSettings(), (_request, hooks) => {
      hooks.onStart('request-1');
      hooks.onFinish('request-1', undefined, new Error('boom'));
    });

    await expect(actions.generateTracker(0, { silent: true })).resolves.toBe(false);
    expect(document.querySelector('.ztracker-full-tracker-status')).toBeNull();
  });

  test('removes the badge when a run is cancelled from the badge', async () => {
    document.body.innerHTML = buildMessage(0);
    const { actions, abortRequest } = setup();

    const pending = actions.generateTracker(0, { silent: true });
    await flushAsyncWork();
    (document.querySelector('.ztracker-message-status-cancel') as HTMLElement).click();

    await expect(pending).resolves.toBe(false);
    expect(abortRequest).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.ztracker-full-tracker-status')).toBeNull();
  });

  test('shows no tracker badge when the outgoing hold owns the run', async () => {
    document.body.innerHTML = buildMessage(0);
    const { actions, finishers } = setup();

    const pending = actions.generateTracker(0, { silent: true, ownedByHold: true });
    await flushAsyncWork();

    expect(document.querySelector('.ztracker-message-status')).toBeNull();

    finishers[0]();
    await pending;
  });

  test('reports preparing, then waiting for the model, without resetting the timer', async () => {
    document.body.innerHTML = buildMessage(0);
    let resolvePrompt: (value: ReturnType<typeof makeBuiltPromptResult>) => void = () => undefined;
    buildPromptMock.mockImplementation(
      () => new Promise<ReturnType<typeof makeBuiltPromptResult>>((resolve) => (resolvePrompt = resolve)) as any,
    );
    const { actions, finishers } = setup();

    const pending = actions.generateTracker(0);
    await flushAsyncWork();
    expect(badgeText('phase')).toBe('preparing');
    const badge = document.querySelector('.ztracker-full-tracker-status');

    resolvePrompt(makeBuiltPromptResult());
    await flushAsyncWork();
    expect(badgeText('phase')).toBe('waiting for the model');
    expect(document.querySelector('.ztracker-full-tracker-status')).toBe(badge);
    expect(badgeText('step')).toBe('');

    finishers[0]();
    await pending;
  });

  test('sequential generation reports part N/M in order', async () => {
    document.body.innerHTML = buildMessage(0);
    const { actions, finishers } = setup(makeSettings({ sequentialPartGeneration: true }));

    const pending = actions.generateTracker(0);
    await flushAsyncWork();
    const seen: Array<string | null | undefined> = [badgeText('step')];
    while (finishers.length > seen.length - 1 && seen.length < 20) {
      finishers[seen.length - 1]();
      await flushAsyncWork();
      if (!document.querySelector('.ztracker-full-tracker-status')) break;
      seen.push(badgeText('step'));
    }
    await pending;

    expect(seen[0]).toMatch(/^part 1\/\d+$/);
    seen.forEach((step, index) => expect(step).toBe(`part ${index + 1}/${seen[0]!.split('/')[1]}`));
  });

  test('cancelling module 2 of 3 stops module 3 and leaves another message unaffected', async () => {
    document.body.innerHTML = `${buildMessage(0)}${buildMessage(1)}`.replace('<div id="extensionsMenu"></div>', '');
    const base = makeSettings();
    const modules = ['m1', 'm2', 'm3'].map((id, order) =>
      createTrackerModuleFromLegacySettings(base, { id, name: id.toUpperCase(), order }),
    );
    const { actions, finishers, generateRequest } = setup(makeSettings({ modules }));

    const pending = actions.generateTrackersForMessage(0, { silent: true });
    await flushAsyncWork();
    expect(badgeText('step')).toBe('module 1/3');

    finishers[0]();
    await flushAsyncWork();
    expect(badgeText('step')).toBe('module 2/3');

    // A run on another message must survive the cancel.
    const other = actions.generateTracker(1, { silent: true, moduleId: 'm1' });
    await flushAsyncWork();
    expect(document.querySelectorAll('.ztracker-full-tracker-status')).toHaveLength(2);

    (document.querySelector('.mes[mesid="0"] .ztracker-message-status-cancel') as HTMLElement).click();
    await expect(pending).resolves.toBe(false);

    // Module 3 never started: only module 1, module 2 and the other message's run sent requests.
    expect(generateRequest).toHaveBeenCalledTimes(3);
    expect(document.querySelector('.mes[mesid="0"] .ztracker-full-tracker-status')).toBeNull();
    expect(document.querySelector('.mes[mesid="1"] .ztracker-full-tracker-status')).not.toBeNull();

    finishers[2]();
    await expect(other).resolves.toBe(true);
  });

  test('rolls back a rendered tracker update when saving the chat fails', async () => {
    document.body.innerHTML = buildMessage(0);

    const rollback = jest.fn(() => undefined);
    applyTrackerUpdateAndRenderMock.mockImplementation(() => rollback);
    const saveChat = jest.fn(async () => {
      throw new Error('save failed');
    });
    const generateRequest = jest.fn((_request: unknown, hooks: GeneratorHooks) => {
      hooks.onStart('request-1');
      hooks.onFinish('request-1', { content: { time: '10:00:00' } }, null);
    });

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat,
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: { getSettings: () => makeSettings() } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await expect(actions.generateTracker(0)).resolves.toBe(false);

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(renderTrackerWithDepsMock).toHaveBeenCalledTimes(1);
    expect(stEchoMock).toHaveBeenCalledWith(
      'error',
      'Tracker generation failed: Tracker changes could not be saved. Changes were rolled back.',
    );
  });
});