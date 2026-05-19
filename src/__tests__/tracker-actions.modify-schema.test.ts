/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import {
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

describe('createTrackerActions modifyChatMetadata', () => {
  beforeEach(() => {
    resetTrackerActionTestState();
    installSillyTavernContext(makeContext({ includeSavedPromptPreset: true }));
  });

  test('updates the chat schema through the rendered menu button and popup flow', async () => {
    const renderExtensionTemplateAsync = jest.fn(async (_root: string, templatePath: string, templateData?: any) => {
      if (templatePath === 'dist/templates/buttons') {
        return '<div id="ztracker_modify_schema_preset" class="list-group-item">Modify zTracker schema</div>';
      }

      if (templatePath === 'dist/templates/modify_schema_popup') {
        return `
          <select id="ztracker-chat-schema-select">
            <option value="default">Default</option>
            <option value="alternate">Alternate</option>
          </select>
        `;
      }

      throw new Error(`Unexpected template path: ${templatePath}`);
    });

    const callGenericPopup = jest.fn(async (content: string, _type: unknown, _title: string, options: any) => {
      document.body.insertAdjacentHTML('beforeend', content);

      const select = document.querySelector('#ztracker-chat-schema-select') as HTMLSelectElement | null;
      expect(select).not.toBeNull();
      select!.value = 'alternate';

      await options.onClose?.({ result: 'affirmative' });
    });

    const saveMetadataDebounced = jest.fn();
    const context = SillyTavern.getContext() as any;
    context.chatMetadata = { zTracker: { schemaKey: 'default' } };
    context.saveMetadataDebounced = saveMetadataDebounced;

    const actions = createTrackerActions({
      globalContext: {
        chat: [{ original_avatar: 'avatar.png', extra: {} }],
        saveChat: async () => undefined,
        callGenericPopup,
        renderExtensionTemplateAsync,
        extensionSettings: { connectionManager: { profiles: [makeProfile()] } },
        CONNECT_API_MAP: { openai: { selected: 'openai' } },
      },
      settingsManager: {
        getSettings: () =>
          makeSettings({
            schemaPreset: 'default',
            schemaPresets: {
              default: {
                name: 'Default',
                value: { type: 'object', properties: { time: { type: 'string' } }, required: ['time'] },
                html: '<div>default</div>',
              },
              alternate: {
                name: 'Alternate',
                value: { type: 'object', properties: { weather: { type: 'string' } }, required: ['weather'] },
                html: '<div>alternate</div>',
              },
            },
          }),
      } as any,
      generator: { generateRequest: jest.fn(), abortRequest: jest.fn() } as any,
      pendingRequests: new Map(),
      renderTrackerWithDeps: renderTrackerWithDepsMock,
      importMetaUrl: TEST_IMPORT_META_URL,
    });

    await actions.renderExtensionTemplates();

    const menuButton = document.querySelector('#ztracker_modify_schema_preset') as HTMLElement | null;
    expect(menuButton).not.toBeNull();

    menuButton!.click();
    await Promise.resolve();

    expect(renderExtensionTemplateAsync).toHaveBeenCalledWith('root', 'dist/templates/modify_schema_popup', expect.any(Object));
    expect(callGenericPopup).toHaveBeenCalled();
    expect(context.chatMetadata).toEqual({ zTracker: { schemaKey: 'alternate' } });
    expect(saveMetadataDebounced).toHaveBeenCalledTimes(1);
    expect(stEchoMock).toHaveBeenCalledWith(
      'success',
      'Current chat schema preset updated to "Alternate". Existing trackers keep their saved message schema until you run a full tracker regeneration for those messages.',
    );
  });
});