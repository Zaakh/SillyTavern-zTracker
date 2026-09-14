/**
 * @jest-environment jsdom
 */

// Covers `testGrammarSchemaEnforcement` (src/ui/tracker-actions.ts): the live "Test" probe that
// fires one throwaway structured-output request with no chat message required and reports whether
// the resolved connection's backend actually honored the trivial test schema.

import { jest } from '@jest/globals';
import {
  createTrackerActions,
  installSillyTavernContext,
  makeContext,
  makeGenerateRequest,
  makeProfile,
  makeSettings,
  parseResponse,
  renderTrackerWithDepsMock,
  resetTrackerActionTestState,
  TEST_IMPORT_META_URL,
} from '../test-utils/tracker-actions-test-helpers.js';

describe('createTrackerActions testGrammarSchemaEnforcement', () => {
  const originalCss = globalThis.CSS;

  beforeEach(() => {
    resetTrackerActionTestState();
    globalThis.CSS = originalCss ?? ({ escape: (value: string) => value } as typeof CSS);
    installSillyTavernContext(makeContext());
    // Production code now parses the raw response via the shared `parseResponse` pipeline
    // (mocked at the module level in the test helpers); default to a conforming parse result
    // and override per-test for the parse-failure/wrong-shape cases below.
    (parseResponse as jest.Mock).mockReturnValue({ ok: true });
  });

  afterEach(() => {
    globalThis.CSS = originalCss;
  });

  function createActionsWithGenerateRequest(generateRequest: ReturnType<typeof makeGenerateRequest>, pendingRequests = new Map<number, string>()) {
    const actions = createTrackerActions({
      globalContext: {
        chat: [],
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: { getSettings: () => makeSettings() } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests,
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });
    return { actions, pendingRequests };
  }

  test('requires no chat message: the chat array can be empty', async () => {
    const { actions } = createActionsWithGenerateRequest(makeGenerateRequest({ content: '{"ok":true}' }));

    const result = await actions.testGrammarSchemaEnforcement('default');

    expect(result.supported).toBe(true);
  });

  test('reports supported for a schema-conforming response', async () => {
    const { actions } = createActionsWithGenerateRequest(makeGenerateRequest({ content: '{"ok":true}' }));

    const result = await actions.testGrammarSchemaEnforcement('default');

    expect(result).toEqual({ supported: true, message: expect.stringContaining('supported') });
  });

  test('reports not confirmed for a non-conforming (invalid JSON) response', async () => {
    (parseResponse as jest.Mock).mockImplementation(() => {
      throw new Error('Model response is not valid JSON.');
    });
    const { actions } = createActionsWithGenerateRequest(makeGenerateRequest({ content: 'Sure! Here you go: not json' }));

    const result = await actions.testGrammarSchemaEnforcement('default');

    expect(result.supported).toBe(false);
    expect(result.message).toMatch(/not valid JSON/i);
  });

  test('reports not confirmed for a non-conforming (wrong shape) response', async () => {
    (parseResponse as jest.Mock).mockReturnValue({ ok: 'nope' });
    const { actions } = createActionsWithGenerateRequest(makeGenerateRequest({ content: '{"ok":"nope"}' }));

    const result = await actions.testGrammarSchemaEnforcement('default');

    expect(result.supported).toBe(false);
    expect(result.message).toMatch(/did not match the trivial test schema/i);
  });

  test('sends the trivial test schema as a json_schema override', async () => {
    const generateRequest = makeGenerateRequest({ content: '{"ok":true}' });
    const { actions } = createActionsWithGenerateRequest(generateRequest);

    await actions.testGrammarSchemaEnforcement('default');

    const requestParams = generateRequest.mock.calls[0][0] as any;
    expect(requestParams.overridePayload).toEqual({
      json_schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    });
  });

  test('uses a small dedicated token budget instead of the Module\'s real maxResponseToken', async () => {
    // makeSettings() defaults maxResponseToken to 512 - the probe must not reuse that for a
    // trivial one-field check.
    const generateRequest = makeGenerateRequest({ content: '{"ok":true}' });
    const { actions } = createActionsWithGenerateRequest(generateRequest);

    await actions.testGrammarSchemaEnforcement('default');

    const requestParams = generateRequest.mock.calls[0][0] as any;
    expect(requestParams.maxTokens).toBe(64);
  });

  test('reaches the request layer for a `saved` connection source Module', async () => {
    const generateRequest = makeGenerateRequest({ content: '{"ok":true}' });
    const { actions } = createActionsWithGenerateRequest(generateRequest);

    await actions.testGrammarSchemaEnforcement('default');

    expect(generateRequest).toHaveBeenCalledTimes(1);
  });

  test('reaches the request layer for an `active` connection source Module', async () => {
    installSillyTavernContext(
      makeContext({
        extensionSettings: {
          connectionManager: {
            selectedProfile: 'active-profile',
            profiles: [{ id: 'active-profile', api: 'openai' }],
          },
        },
        mainApi: 'openai',
      }),
    );
    const generateRequest = makeGenerateRequest({ content: '{"ok":true}' });
    const actions = createTrackerActions({
      globalContext: {
        chat: [],
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: { getSettings: () => makeSettings({ connectionSource: 'active', profileId: '' }) } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.testGrammarSchemaEnforcement('default');

    expect(generateRequest).toHaveBeenCalledTimes(1);
  });

  test('leaves no lingering pendingRequests bookkeeping after a successful test call', async () => {
    const { actions, pendingRequests } = createActionsWithGenerateRequest(makeGenerateRequest({ content: '{"ok":true}' }));

    await actions.testGrammarSchemaEnforcement('default');

    expect(pendingRequests.size).toBe(0);
  });

  test('leaves no lingering pendingRequests bookkeeping after a failed test call', async () => {
    const failingGenerateRequest = jest.fn((
      _request: any,
      hooks: { onStart: (requestId: string) => void; onFinish: (requestId: string, data: unknown, error: unknown) => void },
    ) => {
      hooks.onStart('request-1');
      hooks.onFinish('request-1', undefined, new Error('backend unreachable'));
    });
    const { actions, pendingRequests } = createActionsWithGenerateRequest(failingGenerateRequest as any);

    const result = await actions.testGrammarSchemaEnforcement('default');

    expect(result.supported).toBe(false);
    expect(pendingRequests.size).toBe(0);
  });

  test('reports a clear failure instead of throwing when no connection can be resolved', async () => {
    // No matching saved profile for the configured profileId - resolveTrackerConnection() should
    // reject before any request is sent, and the test action should surface that as a result, not a throw.
    const actionsWithBadProfile = createTrackerActions({
      globalContext: {
        chat: [],
        extensionSettings: { connectionManager: { profiles: [] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: { getSettings: () => makeSettings({ profileId: 'missing-profile' }) } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    const result = await actionsWithBadProfile.testGrammarSchemaEnforcement('default');

    expect(result.supported).toBe(false);
    expect(result.message).toMatch(/profile/i);
  });
});
