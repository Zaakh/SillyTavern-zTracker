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
        const presets = (templateData?.presets ?? []) as Array<{ key: string; name: string; selected?: boolean }>;
        return `
          <div>
            <select id="ztracker-chat-schema-select">
              ${presets
                .map(
                  (preset) =>
                    `<option value="${preset.key}"${preset.selected ? ' selected' : ''}>${preset.name}</option>`,
                )
                .join('')}
            </select>
            <div id="schema-switch-note">Changing the chat schema affects future full tracker generations.</div>
          </div>
        `;
      }

      throw new Error(`Unexpected template path: ${templatePath}`);
    });

    const callGenericPopup = jest.fn(async (content: string, _type: unknown, _title: string, options: any) => {
      const popupContent = document.createElement('div');
      popupContent.innerHTML = content;
      document.body.appendChild(popupContent);

      const select = popupContent.querySelector('#ztracker-chat-schema-select') as HTMLSelectElement | null;
      expect(select).not.toBeNull();
      select!.value = 'alternate';

      await options.onClose?.({ result: 'affirmative', content: popupContent });
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

    await menuButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    expect(renderExtensionTemplateAsync).toHaveBeenCalledWith('root', 'dist/templates/modify_schema_popup', expect.any(Object));
    expect(callGenericPopup).toHaveBeenCalled();
    expect(context.chatMetadata).toEqual({ zTracker: { schemaKey: 'alternate' } });
    expect(saveMetadataDebounced).toHaveBeenCalledTimes(1);
    expect(stEchoMock).toHaveBeenCalledWith(
      'success',
      'Chat schema preset updated to "Alternate". Existing trackers keep their current schema until you run a full tracker regeneration for those messages.',
    );
  });
});