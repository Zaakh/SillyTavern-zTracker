/**
 * @jest-environment jsdom
 */

// Covers `requestWithActiveConnection` / `getActiveConnectionLabel` (src/ui/tracker-actions.ts,
// openspec: add-llm-schema-generation 4.2): LLM schema/prompt generation always uses the global
// active connection, strips reasoning itself, applies no Start Reply With prefill, and budgets
// its reply from the live response length with a floor.

import { jest } from '@jest/globals';
import {
  createTrackerActions,
  installSillyTavernContext,
  makeContext,
  makeGenerateRequest,
  makeProfile,
  makeSettings,
  renderTrackerWithDepsMock,
  resetTrackerActionTestState,
  TEST_IMPORT_META_URL,
} from '../test-utils/tracker-actions-test-helpers.js';

const activeConnection = {
  connectionManager: { selectedProfile: 'active-profile', profiles: [{ id: 'active-profile', api: 'openai', startReplyWith: '{' }] },
};

describe('createTrackerActions requestWithActiveConnection', () => {
  const originalCss = globalThis.CSS;

  beforeEach(() => {
    resetTrackerActionTestState();
    globalThis.CSS = originalCss ?? ({ escape: (value: string) => value } as typeof CSS);
  });

  afterEach(() => {
    globalThis.CSS = originalCss;
  });

  function setup(options: { generateRequest?: ReturnType<typeof makeGenerateRequest>; context?: Record<string, unknown>; active?: boolean } = {}) {
    const context = makeContext({ extensionSettings: options.active === false ? {} : activeConnection, mainApi: options.active === false ? undefined : 'openai' });
    installSillyTavernContext({ ...context, substituteParams: (text: string) => text, ...options.context });
    const generateRequest = options.generateRequest ?? makeGenerateRequest({ content: 'reply' });
    const abortRequest = jest.fn();
    const actions = createTrackerActions({
      globalContext: {
        chat: [],
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      // The Module is pinned to a saved profile that differs from the active connection.
      settingsManager: { getSettings: () => makeSettings({ connectionSource: 'saved', profileId: 'profile-1' }) } as any,
      generator: { generateRequest, abortRequest } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });
    return { actions, generateRequest, abortRequest };
  }

  const messages = [{ role: 'user', content: 'go' }];

  test('uses the active connection even when the Module is pinned to a saved profile', async () => {
    const { actions, generateRequest } = setup();

    await expect(actions.requestWithActiveConnection(messages)).resolves.toBe('reply');

    expect(generateRequest).toHaveBeenCalledTimes(1);
    expect((generateRequest.mock.calls[0][0] as any).profileId).toBe('active-profile');
  });

  test('reports an error without sending when there is no active connection', async () => {
    const { actions, generateRequest } = setup({ active: false });

    await expect(actions.requestWithActiveConnection(messages)).rejects.toThrow(/active/i);

    expect(generateRequest).not.toHaveBeenCalled();
  });

  test('removes a leading reasoning block, even one containing braces', async () => {
    const generateRequest = makeGenerateRequest({ content: '<think>maybe {"a": 1}</think>{"type":"object"}' });
    const { actions } = setup({
      generateRequest,
      context: { powerUserSettings: { reasoning: { prefix: '<think>', suffix: '</think>' } } },
    });

    await expect(actions.requestWithActiveConnection(messages)).resolves.toBe('{"type":"object"}');
  });

  test('applies no Start Reply With prefill', async () => {
    const { actions, generateRequest } = setup();

    await actions.requestWithActiveConnection(messages);

    const sent = (generateRequest.mock.calls[0][0] as any).prompt;
    expect(sent).toHaveLength(1);
    expect(sent[sent.length - 1].role).not.toBe('assistant');
  });

  test.each([
    ['live value above the floor', '4096', 4096],
    ['live value below the floor', '350', 2048],
    ['non-numeric macro result', '{{maxResponse}}', 2048],
  ])('token budget: %s', async (_label, macroResult, expected) => {
    const { actions, generateRequest } = setup({ context: { substituteParams: () => macroResult } });

    await actions.requestWithActiveConnection(messages);

    expect((generateRequest.mock.calls[0][0] as any).maxTokens).toBe(expected);
  });

  test('forwards the override payload', async () => {
    const { actions, generateRequest } = setup();

    await actions.requestWithActiveConnection(messages, { json_schema: { name: 'X' } });

    expect((generateRequest.mock.calls[0][0] as any).overridePayload).toEqual({ json_schema: { name: 'X' } });
  });

  test('aborting the signal cancels the in-flight request and rejects with an AbortError', async () => {
    const controller = new AbortController();
    let hooks: any;
    const pending = jest.fn((_request: any, h: any) => {
      hooks = h;
      h.onStart('request-1');
    });
    const { actions, abortRequest } = setup({ generateRequest: pending as any });

    const result = actions.requestWithActiveConnection(messages, undefined, controller.signal);
    controller.abort();
    hooks.onFinish('request-1', undefined, null);

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(abortRequest).toHaveBeenCalledWith('request-1');
  });

  test('an already-aborted signal sends nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    const { actions, generateRequest } = setup();

    await expect(actions.requestWithActiveConnection(messages, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(generateRequest).not.toHaveBeenCalled();
  });

  test('getActiveConnectionLabel names the API and model, degrading to a generic phrase', () => {
    const { actions } = setup({ context: { substituteParams: (text: string) => (text === '{{model}}' ? 'gpt-x' : text) } });
    expect(actions.getActiveConnectionLabel()).toBe('openai · gpt-x');

    const { actions: bare } = setup({ active: false });
    expect(bare.getActiveConnectionLabel()).toBe('the active connection');
  });
});
