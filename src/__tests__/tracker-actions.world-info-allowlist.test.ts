/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import {
  type AnyMock,
  applyTrackerUpdateAndRenderMock,
  buildPromptMock,
  createTrackerActions,
  installSillyTavernContext,
  loadFullWorldInfoEntriesMock,
  loadWorldInfoBookByNameMock,
  makeBuiltPromptResult,
  makeChat,
  makeContext,
  makeGenerateRequest,
  makeProfile,
  makeSettings,
  realScanWorldInfo,
  renderTrackerWithDepsMock,
  resetTrackerActionTestState,
  scanWorldInfoMock,
  TEST_IMPORT_META_URL,
  TrackerWorldInfoPolicyMode,
} from '../test-utils/tracker-actions-test-helpers.js';

const trackerPartsModule = await import('../tracker-parts.js');

const entry = (uid: number, content: string) => ({ uid, key: ['k'], content, comment: '', disable: false });
/** A scan result with one keyword entry whose key appears in the generated chat messages. */
const scanResult = (text: string) => ({
  text,
  entries: text
    ? [{ book: 'Lore', uid: 5, title: 'Message entry', content: text, constant: false, key: ['message'], keysecondary: [], selectiveLogic: 0, loop: 'initial' as const }]
    : [],
});

describe('createTrackerActions World Info allowlist scope', () => {
  const originalStructuredClone = globalThis.structuredClone;

  beforeEach(() => {
    resetTrackerActionTestState();
    globalThis.structuredClone = originalStructuredClone ?? ((value: unknown) => JSON.parse(JSON.stringify(value)));
    loadWorldInfoBookByNameMock.mockImplementation(async (name: string) => ({
      name,
      entries: [entry(1, `${name}-content`)],
    }));
  });

  afterEach(() => {
    globalThis.structuredClone = originalStructuredClone;
  });

  async function generateWithRows(rows: Array<Record<string, unknown>>) {
    const context = makeContext();
    context.chatId = 'chat-1';
    context.chatMetadata = {};
    context.characters = [{ avatar: 'avatar.png', data: { extensions: { world: 'Card Book' } } }];
    context.characterId = 0;
    context.executeSlashCommandsWithOptions = jest.fn(async () => ({ pipe: '[]' }));
    installSillyTavernContext(context);
    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const generateRequest = makeGenerateRequest();

    const actions = createTrackerActions({
      globalContext: {
        chat: makeChat(1),
        saveChat: async () => undefined,
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () =>
          makeSettings({
            trackerSystemPromptMode: 'profile',
            trackerWorldInfoPolicyMode: TrackerWorldInfoPolicyMode.ALLOWLIST,
            trackerWorldInfoAllowlist: rows,
          }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);
    return JSON.stringify(generateRequest.mock.calls[0][0].prompt);
  }

  test('injects an always row and a satisfied card row, and skips an unsatisfied card row', async () => {
    const prompt = await generateWithRows([
      { book: 'Always Book', activeVia: [], entryIds: [] },
      { book: 'Card Book', activeVia: ['card'], entryIds: [] },
      { book: 'Unattached Book', activeVia: ['card'], entryIds: [] },
    ]);

    expect(prompt).toContain('Always Book-content');
    expect(prompt).toContain('Card Book-content');
    expect(prompt).not.toContain('Unattached Book-content');
    expect(loadWorldInfoBookByNameMock).not.toHaveBeenCalledWith('Unattached Book');
  });
});

describe('createTrackerActions World Info engine scan', () => {
  const originalStructuredClone = globalThis.structuredClone;

  beforeEach(() => {
    resetTrackerActionTestState();
    globalThis.structuredClone = originalStructuredClone ?? ((value: unknown) => JSON.parse(JSON.stringify(value)));
    loadWorldInfoBookByNameMock.mockImplementation(async (name: string) => ({ name, entries: [entry(1, `${name}-content`)] }));
    loadFullWorldInfoEntriesMock.mockImplementation(async (name: string) => [{ uid: 7, group: 'g', content: `${name}-full` }]);
  });

  afterEach(() => {
    globalThis.structuredClone = originalStructuredClone;
  });

  async function generate(
    mode: string,
    rows: Array<Record<string, unknown>> = [],
    options: { wiFormat?: string; chatLength?: number; hostContext?: Record<string, unknown>; sequential?: boolean; generateRequest?: ReturnType<typeof makeGenerateRequest> } = {},
  ) {
    const context = makeContext({
      getPresetManager: (apiId?: string) =>
        apiId === 'openai' ? { getCompletionPresetByName: () => ({ wi_format: options.wiFormat }) } : null,
    });
    context.chatId = 'chat-1';
    context.chatMetadata = {};
    context.characters = [{ avatar: 'avatar.png', data: { extensions: { world: 'Card Book' } } }];
    context.characterId = 0;
    context.executeSlashCommandsWithOptions = jest.fn(async () => ({ pipe: '[]' }));
    Object.assign(context, options.hostContext);
    installSillyTavernContext(context);
    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const generateRequest = options.generateRequest ?? makeGenerateRequest();
    const chat = makeChat(options.chatLength ?? 1).map((m, i) => ({ ...m, name: 'Bar', mes: `message ${i}` }));

    const actions = createTrackerActions({
      globalContext: {
        chat,
        saveChat: async () => undefined,
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () =>
          makeSettings({
            trackerSystemPromptMode: 'profile',
            trackerWorldInfoPolicyMode: mode,
            trackerWorldInfoAllowlist: rows,
            ...(options.sequential ? { sequentialPartGeneration: true } : {}),
          }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);
    // Drop the trailing tracker instruction so assertions see only the World Info placement.
    return (generateRequest.mock.calls[0][0].prompt as Array<{ role: string; content: string }>).filter(
      (m) => m.content !== 'Generate tracker JSON',
    );
  }

  test('the library scan is always disabled, in every policy mode (timer safety)', async () => {
    for (const mode of [
      TrackerWorldInfoPolicyMode.INCLUDE_ALL,
      TrackerWorldInfoPolicyMode.EXCLUDE_ALL,
      TrackerWorldInfoPolicyMode.ALLOWLIST,
    ]) {
      buildPromptMock.mockClear();
      await generate(mode, [{ book: 'A', activeVia: [], entryIds: [], trigger: 'engine' }]);
      expect((buildPromptMock.mock.calls[0] as unknown[])[1]).toEqual(expect.objectContaining({ ignoreWorldInfo: true }));
    }
  });

  test('include-all runs one unfiltered scan with the module window and injects it before the first non-system message', async () => {
    scanWorldInfoMock.mockResolvedValue(scanResult('activated lore'));
    const prompt = await generate(TrackerWorldInfoPolicyMode.INCLUDE_ALL, [], { chatLength: 1 });

    expect(scanWorldInfoMock).toHaveBeenCalledTimes(1);
    const options = scanWorldInfoMock.mock.calls[0][0];
    expect(options.restrictTo).toBeUndefined();
    expect(options.chat).toEqual(expect.any(Array));
    expect(options.chatLength).toBe(1);
    expect(options.maxContext).toBe(8192);
    expect(options.scanData.trigger).toBe('normal');
    expect(prompt.map((m) => m.content)).toEqual(['Existing system prompt', 'activated lore', 'Prior chat message']);
    expect(prompt[1].role).toBe('system');
  });

  test('include-all wraps the scan with the preset World Info format, and leaves it bare without one', async () => {
    scanWorldInfoMock.mockResolvedValue(scanResult('lore'));
    const wrapped = await generate(TrackerWorldInfoPolicyMode.INCLUDE_ALL, [], { wiFormat: '[World: {0}]' });
    expect(wrapped.some((m) => m.content === '[World: lore]')).toBe(true);

    const bare = await generate(TrackerWorldInfoPolicyMode.INCLUDE_ALL);
    expect(bare.some((m) => m.content === 'lore')).toBe(true);
  });

  test('nothing activated injects no World Info message', async () => {
    scanWorldInfoMock.mockResolvedValue(scanResult(''));
    const prompt = await generate(TrackerWorldInfoPolicyMode.INCLUDE_ALL);
    expect(prompt.map((m) => m.content)).toEqual(['Existing system prompt', 'Prior chat message']);
  });

  test('exclude-all never scans or loads books', async () => {
    const prompt = await generate(TrackerWorldInfoPolicyMode.EXCLUDE_ALL, [{ book: 'A', activeVia: [], entryIds: [], trigger: 'always' }]);
    expect(scanWorldInfoMock).not.toHaveBeenCalled();
    expect(loadWorldInfoBookByNameMock).not.toHaveBeenCalled();
    expect(prompt).toHaveLength(2);
  });

  test('mixed rows: always text first, then engine activations, in one raw system message', async () => {
    scanWorldInfoMock.mockResolvedValue(scanResult('engine-activated'));
    const prompt = await generate(
      TrackerWorldInfoPolicyMode.ALLOWLIST,
      [
        { book: 'Engine Book', activeVia: [], entryIds: [12], trigger: 'engine' },
        { book: 'Always Book', activeVia: [], entryIds: [], trigger: 'always' },
        { book: 'Unattached Engine', activeVia: ['card'], entryIds: [], trigger: 'engine' },
      ],
      { wiFormat: '[World: {0}]' },
    );

    const injected = prompt.filter((m) => m.role === 'system' && m.content.includes('engine-activated'));
    expect(injected).toHaveLength(1);
    expect(injected[0].content).toBe('Always Book-content\n\nengine-activated');
    expect(scanWorldInfoMock).toHaveBeenCalledTimes(1);
    expect(scanWorldInfoMock.mock.calls[0][0].restrictTo).toEqual([
      { book: 'Engine Book', entries: [{ uid: 7, group: 'g', content: 'Engine Book-full' }], entryIds: [12] },
    ]);
    expect(loadFullWorldInfoEntriesMock).not.toHaveBeenCalledWith('Unattached Engine');
  });

  test('allowlist with only always rows never calls the scan', async () => {
    await generate(TrackerWorldInfoPolicyMode.ALLOWLIST, [{ book: 'Always Book', activeVia: [], entryIds: [], trigger: 'always' }]);
    expect(scanWorldInfoMock).not.toHaveBeenCalled();
  });

  test('timer safety: the real scan only ever calls the host as a dry run and never emits the activated event', async () => {
    scanWorldInfoMock.mockImplementation(realScanWorldInfo);
    const getWorldInfoPrompt = jest.fn(async (..._args: unknown[]) => ({ worldInfoBefore: 'lore' }));
    const emit = jest.fn();
    const hostContext = {
      getWorldInfoPrompt,
      eventSource: { on: jest.fn(), removeListener: jest.fn(), emit },
      eventTypes: { WORLDINFO_ENTRIES_LOADED: 'loaded', WORLD_INFO_ACTIVATED: 'activated' },
    };
    for (const mode of [
      TrackerWorldInfoPolicyMode.INCLUDE_ALL,
      TrackerWorldInfoPolicyMode.EXCLUDE_ALL,
      TrackerWorldInfoPolicyMode.ALLOWLIST,
    ]) {
      await generate(mode, [{ book: 'A', activeVia: [], entryIds: [], trigger: 'engine' }], { hostContext });
    }
    expect(getWorldInfoPrompt).toHaveBeenCalled();
    for (const call of getWorldInfoPrompt.mock.calls) expect(call[2]).toBe(true);
    expect(emit).not.toHaveBeenCalled();
  });

  test('the host counts as generating while streaming or while the host marks a generation on <body>', async () => {
    scanWorldInfoMock.mockResolvedValue(scanResult('lore'));
    await generate(TrackerWorldInfoPolicyMode.INCLUDE_ALL);
    const { isGenerating } = scanWorldInfoMock.mock.calls[0][0].host;

    expect(isGenerating()).toBe(false);
    document.body.dataset.generating = 'true';
    expect(isGenerating()).toBe(true);
    delete document.body.dataset.generating;
    expect(isGenerating()).toBe(false);
  });

  test('a failing scan step does not fail tracker generation', async () => {
    scanWorldInfoMock.mockRejectedValue(new Error('boom'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const prompt = await generate(TrackerWorldInfoPolicyMode.INCLUDE_ALL);
    expect(prompt).toHaveLength(2);
    warn.mockRestore();
  });

  describe('stored World Info record', () => {
    const storedWorldInfo = () => (applyTrackerUpdateAndRenderMock.mock.calls[0][1] as any).extensionData.worldInfo;

    test('a full generation stores the report with the tracker result', async () => {
      scanWorldInfoMock.mockResolvedValue(scanResult('activated lore'));
      await generate(TrackerWorldInfoPolicyMode.INCLUDE_ALL);

      expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalledTimes(1);
      expect(storedWorldInfo()).toEqual({
        outcome: 'applied',
        books: [{ book: 'Lore', applied: [{ uid: 5, title: 'Message entry', via: 'scan', reason: 'keyword', matchedKeys: ['message'] }], skipped: [] }],
      });
    });

    test('a sequential generation stores the same report once, after all parts', async () => {
      scanWorldInfoMock.mockResolvedValue(scanResult('activated lore'));
      (trackerPartsModule.buildTopLevelPartSchema as AnyMock).mockReturnValue({ type: 'object' });
      (trackerPartsModule.mergeTrackerPart as AnyMock).mockImplementation((tracker, key, response) => ({ ...(tracker ?? {}), [key]: response?.[key] ?? response }));
      await generate(TrackerWorldInfoPolicyMode.INCLUDE_ALL, [], { sequential: true });

      expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalledTimes(1);
      expect(storedWorldInfo().outcome).toBe('applied');
    });

    test('exclude-all stores an excluded record', async () => {
      await generate(TrackerWorldInfoPolicyMode.EXCLUDE_ALL);
      expect(storedWorldInfo()).toEqual({ outcome: 'excluded', books: [] });
    });

    test('a World Info build failure is stored as scan-unavailable, never as nothing matched', async () => {
      scanWorldInfoMock.mockRejectedValue(new Error('boom'));
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      await generate(TrackerWorldInfoPolicyMode.INCLUDE_ALL);
      warn.mockRestore();
      expect(storedWorldInfo()).toEqual({ outcome: 'scan-unavailable', books: [] });
    });

    test('a failed generation stores nothing, leaving the previous record intact', async () => {
      scanWorldInfoMock.mockResolvedValue(scanResult('activated lore'));
      const failing = jest.fn((_request: unknown, hooks: any) => {
        hooks.onStart('request-1');
        hooks.onFinish('request-1', null, new Error('model failed'));
      });
      const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      await generate(TrackerWorldInfoPolicyMode.INCLUDE_ALL, [], { generateRequest: failing as any });
      error.mockRestore();

      expect(applyTrackerUpdateAndRenderMock).not.toHaveBeenCalled();
    });
  });
});
