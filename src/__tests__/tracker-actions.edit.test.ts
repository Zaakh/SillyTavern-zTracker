/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import {
  applyTrackerUpdateAndRenderMock,
  createTrackerActions,
  installSillyTavernContext,
  makeContext,
  makeProfile,
  makeSettings,
  renderTrackerWithDepsMock,
  resetTrackerActionTestState,
  stEchoMock,
  TEST_IMPORT_META_URL,
} from '../test-utils/tracker-actions-test-helpers.js';

describe('createTrackerActions editTracker', () => {
  beforeEach(() => {
    resetTrackerActionTestState();
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));
  });

  test('does not save invalid tracker edits when rerender validation fails', async () => {
    document.body.innerHTML = '<div class="mes" mesid="0"><div class="mes_ztracker"><details open><summary>Tracker</summary></details></div><div class="mes_text"></div></div>';

    const saveChat = jest.fn(async () => undefined);
    let popupContent: HTMLElement | undefined;
    let popupOptions: { onClose?: (popup: any) => Promise<void> | void } | undefined;

    applyTrackerUpdateAndRenderMock.mockImplementation(() => {
      throw new Error('render failed');
    });

    const actions = createTrackerActions({
      globalContext: {
        chat: [
          {
            original_avatar: 'avatar.png',
            extra: {
              zTracker: {
                schemaValue: { time: '09:00:00' },
                schemaHtml: '<div>{{data.time}}</div>',
              },
            },
          },
        ],
        saveChat,
        callGenericPopup: jest.fn((content: string, _type: unknown, _title: string, options: any) => {
          popupContent = document.createElement('div');
          popupContent.innerHTML = content;
          document.body.appendChild(popupContent);
          popupOptions = options;
        }),
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: { getSettings: () => makeSettings() } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.editTracker(0);

    const textarea = popupContent?.querySelector('#ztracker-edit-textarea') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    textarea!.value = '{"time":"10:00:00"}';

    await popupOptions?.onClose?.({ result: 'affirmative', content: popupContent });

    expect(saveChat).not.toHaveBeenCalled();
    expect(renderTrackerWithDepsMock).toHaveBeenCalledTimes(1);
    expect(stEchoMock).toHaveBeenCalledWith('error', 'Tracker data failed to render. Changes were not saved.');
  });
});
