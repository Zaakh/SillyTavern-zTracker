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
  makeGenerateRequest,
  makeProfile,
  makeSettings,
  parseResponse,
  PromptEngineeringMode,
  renderTrackerWithDepsMock,
  resetTrackerActionTestState,
  schemaToExample,
  schemaToPromptSchema,
  TEST_IMPORT_META_URL,
} from '../test-utils/tracker-actions-test-helpers.js';

const trackerPartsModule = await import('../tracker-parts.js');

describe('createTrackerActions prompt engineering', () => {
  const originalCss = globalThis.CSS;

  beforeEach(() => {
    resetTrackerActionTestState();
    // Part-regeneration's button lookup uses CSS.escape(), which jsdom does not provide.
    globalThis.CSS = originalCss ?? ({ escape: (value: string) => value } as typeof CSS);
  });

  afterEach(() => {
    globalThis.CSS = originalCss;
  });

  test('logs malformed prompt-engineered payloads when parsing fails', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    (schemaToExample as jest.Mock).mockReturnValue('time\tstring');
    (schemaToPromptSchema as jest.Mock).mockReturnValue('type: object');
    (parseResponse as jest.Mock).mockImplementation(() => {
      throw new Error('Model response is not valid TOON.');
    });
    const generateRequest = makeGenerateRequest({ content: '```toon\nnot valid\n```' });

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
        getSettings: () => makeSettings({
          promptEngineeringMode: PromptEngineeringMode.TOON,
          promptToon: 'TOON TEMPLATE\n{{example_response}}',
        }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'zTracker: malformed prompt-engineered payload',
      expect.objectContaining({
        format: 'toon',
        reason: 'parse failure',
        rawContent: '```toon\nnot valid\n```',
      }),
    );

    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test('logs malformed prompt-engineered payloads when parsed data fails strict rendering', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    const parsedPayload = {
      time: '10:00:00',
      charactersPresent: ['Silvia', 'Tobias'],
      characters: [{ name: 'Silvia' }],
    };
    (schemaToExample as jest.Mock).mockReturnValue('time\tstring');
    (schemaToPromptSchema as jest.Mock).mockReturnValue('type: object');
    (parseResponse as jest.Mock).mockReturnValue(parsedPayload);
    applyTrackerUpdateAndRenderMock.mockImplementation(() => {
      throw new Error('render failed');
    });
    const generateRequest = makeGenerateRequest({ content: '```toon\ncharactersPresent[2]: "Silvia"\t"Tobias"\n```' });

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
        getSettings: () => makeSettings({
          promptEngineeringMode: PromptEngineeringMode.TOON,
          promptToon: 'TOON TEMPLATE\n{{example_response}}',
        }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'zTracker: malformed prompt-engineered payload',
      expect.objectContaining({
        format: 'toon',
        reason: 'render rollback',
        rawContent: '```toon\ncharactersPresent[2]: "Silvia"\t"Tobias"\n```',
        parsedContent: parsedPayload,
      }),
    );

    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test('uses TOON prompt-engineering mode when selected', async () => {
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    (schemaToExample as jest.Mock).mockReturnValue('time\tstring');
    (schemaToPromptSchema as jest.Mock).mockReturnValue('type: object\nproperties:\n  time:\n    type: string');
    (parseResponse as jest.Mock).mockReturnValue({ time: '10:00:00' });
    const generateRequest = makeGenerateRequest({ content: '```toon\ntime\t10:00:00\n```' });

    const toonSettings = makeSettings({
      promptEngineeringMode: PromptEngineeringMode.TOON,
      promptToon: 'TOON TEMPLATE\n{{example_response}}',
    });

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
      settingsManager: { getSettings: () => toonSettings } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    expect(schemaToExample).toHaveBeenCalledWith(toonSettings.schemaPresets.default.value, 'toon');
    expect(schemaToPromptSchema).toHaveBeenCalledWith(toonSettings.schemaPresets.default.value, 'toon');
    expect(parseResponse).toHaveBeenCalledWith('```toon\ntime\t10:00:00\n```', 'toon', {
      schema: toonSettings.schemaPresets.default.value,
    });

    const sentMessages = generateRequest.mock.calls[0][0].prompt;
    expect(sentMessages.at(-1)).toEqual({
      role: 'system',
      content: 'TOON TEMPLATE\ntime\tstring',
    });
    expect(sentMessages.at(-2)).toEqual({ role: 'user', content: 'Prior chat message' });
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('normalizes user chat turns before prompt-engineered JSON tracker generation when configured', async () => {
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    (schemaToExample as jest.Mock).mockReturnValue('{"time":"10:00:00"}');
    (schemaToPromptSchema as jest.Mock).mockReturnValue('{"type":"object"}');
    (parseResponse as jest.Mock).mockReturnValue({ time: '10:00:00' });
    const generateRequest = makeGenerateRequest({ content: '```json\n{"time":"10:00:00"}\n```' });

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
        getSettings: () => makeSettings({
          promptEngineeringMode: PromptEngineeringMode.JSON,
          promptJson: 'JSON TEMPLATE\n{{schema}}\n{{example_response}}',
          trackerGenerationConversationRoleMode: 'all_assistant',
        }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    const sentMessages = generateRequest.mock.calls[0][0].prompt;
    expect(sentMessages).toEqual([
      { role: 'system', content: 'Existing system prompt' },
      { role: 'system', content: 'Saved tracker system prompt' },
      { role: 'assistant', content: 'Prior chat message' },
      { role: 'system', content: 'JSON TEMPLATE\n{"type":"object"}\n{"time":"10:00:00"}' },
    ]);
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('injects the translated XML schema instead of raw JSON when XML prompt-engineering is selected', async () => {
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    (schemaToExample as jest.Mock).mockReturnValue('<time>string</time>');
    (schemaToPromptSchema as jest.Mock).mockReturnValue('<type>object</type>');
    (parseResponse as jest.Mock).mockReturnValue({ time: '10:00:00' });
    const generateRequest = makeGenerateRequest({ content: '```xml\n<root><time>10:00:00</time></root>\n```' });

    const xmlSettings = makeSettings({
      promptEngineeringMode: PromptEngineeringMode.XML,
      promptXml: 'XML TEMPLATE\n{{schema}}\n{{example_response}}',
    });

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
      settingsManager: { getSettings: () => xmlSettings } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTracker(0);

    const sentMessages = generateRequest.mock.calls[0][0].prompt;
    expect(sentMessages.at(-1)).toEqual({
      role: 'system',
      content: 'XML TEMPLATE\n<type>object</type>\n<time>string</time>',
    });
    expect(sentMessages.at(-1).content).not.toContain('{\n  "type"');
  });

  test('conveys the array-item scoping directive and omission notice to a prompt-engineered request', async () => {
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    (schemaToExample as jest.Mock).mockReturnValue('{"item":{"name":"string"}}');
    (schemaToPromptSchema as jest.Mock).mockReturnValue('{"type":"object"}');
    (parseResponse as jest.Mock).mockReturnValue({ item: { name: 'Alice', status: 'updated status' } });
    const generateRequest = makeGenerateRequest({ content: '```json\n{"item":{"name":"Alice","status":"updated status"}}\n```' });

    (trackerPartsModule.buildArrayItemSchema as jest.Mock).mockReturnValue({
      type: 'object',
      properties: { item: { type: 'object' } },
    });
    (trackerPartsModule.redactTrackerArrayItemValue as jest.Mock).mockImplementation((tracker: unknown) => tracker);
    (trackerPartsModule.replaceTrackerArrayItem as jest.Mock).mockImplementation(
      (tracker: any, partKey: string, index: number, item: unknown) => ({
        ...tracker,
        [partKey]: (tracker?.[partKey] ?? []).map((entry: unknown, entryIndex: number) => (entryIndex === index ? item : entry)),
      }),
    );

    const actions = createTrackerActions({
      globalContext: {
        chat: [
          {
            original_avatar: 'avatar.png',
            extra: {
              zTracker: {
                schemaValue: { characters: [{ name: 'Alice', status: 'old status' }] },
                schemaHtml: '<div></div>',
              },
            },
          },
        ],
        saveChat: async () => undefined,
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () =>
          makeSettings({
            promptEngineeringMode: PromptEngineeringMode.JSON,
            promptJson: 'JSON TEMPLATE\n{{schema}}\n{{example_response}}',
          }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    // Index-based array-item regeneration: no behavior change intended, this locks in that the
    // scoping directive and previous-value-omission notice reach the model via the tracker-snapshot
    // channel (appendCurrentTrackerSnapshot) since prompt-engineered modes never send `options.prompt`.
    await actions.generateTrackerArrayItem(0, 'characters', 0);

    const sentMessages = generateRequest.mock.calls[0][0].prompt;
    const scopingMessage = sentMessages.find(
      (message: any) => typeof message.content === 'string' && message.content.startsWith('Regenerate ONLY this array item'),
    );
    expect(scopingMessage?.content).toContain('previous item intentionally omitted');
    expect(scopingMessage?.content).toContain('"part": "characters"');
    expect(scopingMessage?.content).toContain('"index": 0');
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });

  test('conveys the identity-preserve instruction and preserves the identity value for identity-matched regeneration', async () => {
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    (schemaToExample as jest.Mock).mockReturnValue('{"item":{"status":"string"}}');
    (schemaToPromptSchema as jest.Mock).mockReturnValue('{"type":"object"}');
    // The model omits the identity field entirely; finalizeItem() must restore it verbatim.
    (parseResponse as jest.Mock).mockReturnValue({ item: { status: 'updated status' } });
    const generateRequest = makeGenerateRequest({ content: '```json\n{"item":{"status":"updated status"}}\n```' });

    (trackerPartsModule.getArrayItemIdentityKey as jest.Mock).mockReturnValue('id');
    (trackerPartsModule.findArrayItemIndexByIdentity as jest.Mock).mockReturnValue(0);
    (trackerPartsModule.buildArrayItemSchema as jest.Mock).mockReturnValue({
      type: 'object',
      properties: { item: { type: 'object' } },
    });
    (trackerPartsModule.redactTrackerArrayItemValue as jest.Mock).mockImplementation((tracker: unknown) => tracker);
    (trackerPartsModule.replaceTrackerArrayItem as jest.Mock).mockImplementation(
      (tracker: any, partKey: string, index: number, item: unknown) => ({
        ...tracker,
        [partKey]: (tracker?.[partKey] ?? []).map((entry: unknown, entryIndex: number) => (entryIndex === index ? item : entry)),
      }),
    );

    const actions = createTrackerActions({
      globalContext: {
        chat: [
          {
            original_avatar: 'avatar.png',
            extra: {
              zTracker: {
                schemaValue: { characters: [{ id: 'char-1', name: 'Alice', status: 'old status' }] },
                schemaHtml: '<div></div>',
              },
            },
          },
        ],
        saveChat: async () => undefined,
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () =>
          makeSettings({
            promptEngineeringMode: PromptEngineeringMode.JSON,
            promptJson: 'JSON TEMPLATE\n{{schema}}\n{{example_response}}',
          }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTrackerArrayItemByIdentity(0, 'characters', 'id', 'char-1');

    const sentMessages = generateRequest.mock.calls[0][0].prompt;
    expect(sentMessages.at(-1).content).toContain('IMPORTANT: Preserve the identity field id exactly as "char-1".');

    expect(trackerPartsModule.replaceTrackerArrayItem).toHaveBeenCalledWith(
      expect.any(Object),
      'characters',
      0,
      { status: 'updated status', id: 'char-1' },
    );
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        trackerData: expect.objectContaining({
          characters: [{ status: 'updated status', id: 'char-1' }],
        }),
      }),
    );
  });

  test('documents the top-level part scoping channel in a prompt-engineered request (no equivalent omission-directive text today)', async () => {
    // Unlike array-item regeneration, top-level part regeneration only ever appends one generic
    // tracker-snapshot message (no second "Regenerate ONLY this part (previous value intentionally
    // omitted)" message, and no promptEngineeringInstruction suffix). "Which target to regenerate"
    // reaches the model only via the PE template's schema/example being scoped to just this field
    // (buildTopLevelPartSchema). This test locks in that current behavior rather than asserting an
    // explicit omission-directive that does not exist for parts - see the critical-review followup
    // on the "Targeted regeneration directives reach the model in every mode" requirement.
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));

    buildPromptMock.mockResolvedValue(makeBuiltPromptResult());
    (schemaToExample as jest.Mock).mockReturnValue('{"time":"string"}');
    (schemaToPromptSchema as jest.Mock).mockReturnValue('{"type":"object"}');
    (parseResponse as jest.Mock).mockReturnValue({ time: '10:00:00' });
    const generateRequest = makeGenerateRequest({ content: '```json\n{"time":"10:00:00"}\n```' });

    const partSchema = { type: 'object', properties: { time: { type: 'string' } } };
    (trackerPartsModule.buildTopLevelPartSchema as jest.Mock).mockReturnValue(partSchema);
    (trackerPartsModule.redactTrackerPartValue as jest.Mock).mockImplementation((tracker: unknown) => tracker);
    (trackerPartsModule.mergeTrackerPart as jest.Mock).mockImplementation((tracker: any, partKey: string, partObject: any) => ({
      ...tracker,
      [partKey]: partObject[partKey],
    }));

    document.body.innerHTML = [
      '<div id="extensionsMenu"></div>',
      '<div class="mes" mesid="0">',
      '<div class="ztracker-part-regenerate-button" data-ztracker-part="time"></div>',
      '<div class="mes_text"></div>',
      '</div>',
    ].join('');

    const actions = createTrackerActions({
      globalContext: {
        chat: [
          {
            original_avatar: 'avatar.png',
            extra: { zTracker: { schemaValue: { time: '09:00:00' }, schemaHtml: '<div></div>' } },
          },
        ],
        saveChat: async () => undefined,
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () =>
          makeSettings({
            promptEngineeringMode: PromptEngineeringMode.JSON,
            promptJson: 'JSON TEMPLATE\n{{schema}}\n{{example_response}}',
          }),
      } as any,
      generator: { generateRequest, abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.generateTrackerPart(0, 'time');

    // "Which target to regenerate" is conveyed only through the schema/example scoping, not
    // through explicit wording naming the field in the messages sent to the model.
    expect(schemaToExample).toHaveBeenCalledWith(partSchema, 'json');
    expect(schemaToPromptSchema).toHaveBeenCalledWith(partSchema, 'json');

    const sentMessages = generateRequest.mock.calls[0][0].prompt;
    const snapshotMessage = sentMessages.find(
      (message: any) => typeof message.content === 'string' && message.content.startsWith('Current tracker for this message'),
    );
    expect(snapshotMessage?.content).toContain('target part omitted for freshness; keep everything else consistent');
    // No dedicated "Regenerate ONLY..." / "previous value intentionally omitted" message exists
    // for parts today (contrast with the array-item test above finding one).
    expect(sentMessages.some((message: any) => typeof message.content === 'string' && message.content.startsWith('Regenerate ONLY'))).toBe(
      false,
    );

    const templateMessage = sentMessages.at(-1);
    expect(templateMessage?.content).toBe('JSON TEMPLATE\n{"type":"object"}\n{"time":"string"}');
    expect(applyTrackerUpdateAndRenderMock).toHaveBeenCalled();
  });
});
