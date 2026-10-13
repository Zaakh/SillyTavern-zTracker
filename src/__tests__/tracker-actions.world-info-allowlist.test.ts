/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import {
  buildPromptMock,
  createTrackerActions,
  installSillyTavernContext,
  loadWorldInfoBookByNameMock,
  makeBuiltPromptResult,
  makeChat,
  makeContext,
  makeGenerateRequest,
  makeProfile,
  makeSettings,
  renderTrackerWithDepsMock,
  resetTrackerActionTestState,
  TEST_IMPORT_META_URL,
  TrackerWorldInfoPolicyMode,
} from '../test-utils/tracker-actions-test-helpers.js';

const entry = (uid: number, content: string) => ({ uid, key: ['k'], content, comment: '', disable: false });

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
