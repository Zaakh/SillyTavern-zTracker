import type { ExtensionSettings } from '../config.js';
import { PromptEngineeringMode, TrackerWorldInfoPolicyMode, EXTENSION_KEY, extensionName } from '../config.js';
import type { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import { buildPrompt, Generator, getWorldInfos, Message } from 'sillytavern-utils-lib';
import type { ChatMessage, ExtractedData } from 'sillytavern-utils-lib/types';
import { characters, selected_group, st_echo } from 'sillytavern-utils-lib/config';
import Handlebars from 'handlebars';
import { POPUP_RESULT, POPUP_TYPE } from 'sillytavern-utils-lib/types/popup';
import { parseResponse } from '../parser.js';
import { schemaToExample } from '../schema-to-example.js';
import { shouldIgnoreWorldInfoDuringTrackerBuild } from '../world-info-policy.js';
import { buildAllowlistedWorldInfoText } from '../world-info-allowlist.js';
import { loadWorldInfoBookByName } from '../sillytavern-world-info.js';
import {
  applyTrackerUpdateAndRender,
  CHAT_METADATA_SCHEMA_PRESET_KEY,
  CHAT_MESSAGE_SCHEMA_HTML_KEY,
  CHAT_MESSAGE_SCHEMA_VALUE_KEY,
  includeZTrackerMessages,
} from '../tracker.js';
import { checkTemplateUrl, getExtensionRoot, getTemplateUrl } from './templates.js';
import { debugLog, isDebugLoggingEnabled } from './debug.js';

export function createTrackerActions(options: {
  globalContext: any;
  settingsManager: ExtensionSettingsManager<ExtensionSettings>;
  generator: Generator;
  pendingRequests: Map<number, string>;
  renderTrackerWithDeps: (messageId: number) => void;
  importMetaUrl: string;
}) {
  const { globalContext, settingsManager, generator, pendingRequests, renderTrackerWithDeps, importMetaUrl } = options;

  async function deleteTracker(messageId: number) {
    const message = globalContext.chat[messageId];
    if (!message?.extra?.[EXTENSION_KEY]) return;

    const confirm = await globalContext.Popup.show.confirm(
      'Delete Tracker',
      'Are you sure you want to delete the tracker data for this message? This cannot be undone.',
    );

    if (confirm) {
      delete message.extra[EXTENSION_KEY];
      await globalContext.saveChat();
      renderTrackerWithDeps(messageId);
      st_echo('success', 'Tracker data deleted.');
    }
  }

  async function editTracker(messageId: number) {
    const message = globalContext.chat[messageId];
    if (!message?.extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY]) return;

    const currentData = message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_VALUE_KEY];

    const popupContent = `
        <div style="display: flex; flex-direction: column; gap: 8px;">
            <label for="ztracker-edit-textarea">Edit Tracker JSON:</label>
            <textarea id="ztracker-edit-textarea" class="text_pole" rows="15" style="width: 100%; resize: vertical;"></textarea>
        </div>
    `;

    globalContext.callGenericPopup(popupContent, POPUP_TYPE.CONFIRM, 'Edit Tracker', {
      okButton: 'Save',
      onClose: async (popup: any) => {
        if (popup.result === POPUP_RESULT.AFFIRMATIVE) {
          const textarea = popup.content.querySelector('#ztracker-edit-textarea') as HTMLTextAreaElement;
          if (textarea) {
            try {
              const newData = JSON.parse(textarea.value);
              // @ts-ignore
              message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_VALUE_KEY] = newData;
              await globalContext.saveChat();
              let detailsState: boolean[] = [];
              const messageBlock = document.querySelector(`.mes[mesid="${messageId}"]`);
              const existingTracker = messageBlock?.querySelector('.mes_ztracker');
              if (existingTracker) {
                const detailsElements = existingTracker.querySelectorAll('details');
                detailsState = Array.from(detailsElements).map((detail) => (detail as HTMLDetailsElement).open);
              }
              renderTrackerWithDeps(messageId);
              if (detailsState.length > 0) {
                const newTracker = messageBlock?.querySelector('.mes_ztracker');
                if (newTracker) {
                  const newDetailsElements = newTracker.querySelectorAll('details');
                  newDetailsElements.forEach((detail, index) => {
                    if (detailsState[index] !== undefined) {
                      (detail as HTMLDetailsElement).open = detailsState[index];
                    }
                  });
                }
              }
              st_echo('success', 'Tracker data updated.');
            } catch (e) {
              console.error('Error parsing new tracker data:', e);
              st_echo('error', 'Invalid JSON. Changes were not saved.');
            }
          }
        }
      },
    });

    const textarea = document.querySelector('#ztracker-edit-textarea') as HTMLTextAreaElement;
    if (textarea) {
      textarea.value = JSON.stringify(currentData, null, 2);
    }
  }

  async function generateTracker(id: number) {
    const message = globalContext.chat[id];
    if (!message) return st_echo('error', `Message with ID ${id} not found.`);

    if (pendingRequests.has(id)) {
      const requestId = pendingRequests.get(id)!;
      generator.abortRequest(requestId);
      st_echo('info', 'Tracker generation cancelled.');
      return;
    }

    const settings = settingsManager.getSettings();
    if (!settings.profileId) return st_echo('error', 'Please select a connection profile in settings.');

    const context = SillyTavern.getContext();
    const chatMetadata = context.chatMetadata;
    const { extensionSettings, CONNECT_API_MAP, saveChat } = globalContext;

    chatMetadata[EXTENSION_KEY] = chatMetadata[EXTENSION_KEY] || {};
    chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY] =
      chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY] || settings.schemaPreset;

    const chatJsonValue = settings.schemaPresets[settings.schemaPreset].value;
    const chatHtmlValue = settings.schemaPresets[settings.schemaPreset].html;

    const profile = extensionSettings.connectionManager?.profiles?.find((p: any) => p.id === settings.profileId);
    if (!profile) {
      st_echo('error', 'Selected connection profile not found. Please re-select a profile in zTracker settings.');
      return;
    }
    if (!profile.api) {
      st_echo('error', 'Selected connection profile is missing an API. Please edit the profile in SillyTavern settings.');
      return;
    }

    const apiMap = CONNECT_API_MAP[profile.api];
    if (!apiMap?.selected) {
      st_echo('error', `Unsupported or unknown API for prompt building: ${String(profile.api)}`);
      return;
    }

    debugLog(settingsManager, 'generateTracker start', {
      mesId: id,
      profileId: settings.profileId,
      api: profile.api,
      mode: settings.promptEngineeringMode,
      trackerWorldInfoPolicyMode: settings.trackerWorldInfoPolicyMode,
      allowlistBookNames: settings.trackerWorldInfoAllowlistBookNames,
      allowlistEntryIds: settings.trackerWorldInfoAllowlistEntryIds,
    });

    let characterId = characters.findIndex((char: any) => char.avatar === message.original_avatar);
    characterId = characterId !== -1 ? characterId : undefined;

    const messageBlock = document.querySelector(`.mes[mesid="${id}"]`);
    const mainButton = messageBlock?.querySelector('.mes_ztracker_button');
    const regenerateButton = messageBlock?.querySelector('.ztracker-regenerate-button');

    let detailsState: boolean[] = [];
    const existingTracker = messageBlock?.querySelector('.mes_ztracker');
    if (existingTracker) {
      const detailsElements = existingTracker.querySelectorAll('details');
      detailsState = Array.from(detailsElements).map((detail) => (detail as HTMLDetailsElement).open);
    }

    try {
      mainButton?.classList.add('spinning');
      regenerateButton?.classList.add('spinning');

      const trackerWorldInfoMode = settings.trackerWorldInfoPolicyMode ?? TrackerWorldInfoPolicyMode.INCLUDE_ALL;
      const ignoreWorldInfo = shouldIgnoreWorldInfoDuringTrackerBuild(trackerWorldInfoMode);

      const promptResult = await buildPrompt(apiMap.selected, {
        targetCharacterId: characterId,
        messageIndexesBetween: {
          end: id,
          start: settings.includeLastXMessages > 0 ? Math.max(0, id - settings.includeLastXMessages) : 0,
        },
        presetName: profile?.preset,
        contextName: profile?.context,
        instructName: profile?.instruct,
        syspromptName: profile?.sysprompt,
        includeNames: !!selected_group,
        ignoreWorldInfo,
      });

      let messages = includeZTrackerMessages(promptResult.result, settings);
      debugLog(settingsManager, 'prompt built', {
        ignoreWorldInfo,
        messageCount: messages.length,
        roles: messages.map((m: any) => m.role),
      });

      if (trackerWorldInfoMode === TrackerWorldInfoPolicyMode.ALLOWLIST) {
        const allowlistBookNames = settings.trackerWorldInfoAllowlistBookNames ?? [];
        const allowlistEntryIds = settings.trackerWorldInfoAllowlistEntryIds ?? [];
        if (allowlistBookNames.length > 0 || allowlistEntryIds.length > 0) {
          try {
            debugLog(settingsManager, 'allowlist injection starting', {
              allowlistBookNames,
              allowlistEntryIds,
              characterId,
            });
            const worldInfoText = await buildAllowlistedWorldInfoText({
              allowlistBookNames,
              allowlistEntryIds,
              debug: !!settings.debugLogging,
              getActiveWorldInfos: () => getWorldInfos(['global', 'chat', 'character', 'persona'], true, characterId),
              loadBookByName: (name) => loadWorldInfoBookByName(name, { debug: !!settings.debugLogging }),
            });
            if (worldInfoText) {
              const firstNonSystem = messages.findIndex((m: any) => m.role !== 'system');
              const insertAt = firstNonSystem === -1 ? messages.length : firstNonSystem;
              messages.splice(insertAt, 0, { role: 'system', content: worldInfoText } as Message);

              debugLog(settingsManager, 'allowlist injected', {
                insertAt,
                systemCount: messages.filter((m: any) => m.role === 'system').length,
                injectedLength: worldInfoText.length,
                allowlistBookNames,
                preview: worldInfoText.slice(0, 200),
              });
            } else {
              debugLog(settingsManager, 'allowlist produced empty worldInfoText', {
                allowlistBookNames,
                allowlistEntryIds,
              });
            }
          } catch (e) {
            console.warn('zTracker: failed to load allowlisted World Info; proceeding without it.', e);
          }
        }
      }

      let response: ExtractedData['content'];

      const makeRequest = (requestMessages: Message[], overideParams?: any): Promise<ExtractedData | undefined> => {
        return new Promise((resolve, reject) => {
          const abortController = new AbortController();
          generator.generateRequest(
            {
              profileId: settings.profileId,
              prompt: requestMessages,
              maxTokens: settings.maxResponseToken,
              custom: { signal: abortController.signal },
              overridePayload: {
                ...overideParams,
              },
            },
            {
              abortController,
              onStart: (requestId: string) => {
                pendingRequests.set(id, requestId);
              },
              onFinish: (requestId: string, data: unknown, error: unknown) => {
                pendingRequests.delete(id);
                if (error) return reject(error);
                if (!data) return reject(new DOMException('Request aborted by user', 'AbortError'));
                resolve(data as ExtractedData | undefined);
              },
            },
          );
        });
      };

      if (settings.promptEngineeringMode === PromptEngineeringMode.NATIVE) {
        messages.push({ content: settings.prompt, role: 'user' });
        const result = await makeRequest(messages, {
          json_schema: { name: 'SceneTracker', strict: true, value: chatJsonValue },
        });
        // @ts-ignore
        response = result?.content;
      } else {
        const format = settings.promptEngineeringMode as 'json' | 'xml';
        const promptTemplate = format === 'json' ? settings.promptJson : settings.promptXml;
        const exampleResponse = schemaToExample(chatJsonValue, format);
        const finalPrompt = Handlebars.compile(promptTemplate, { noEscape: true, strict: true })({
          schema: JSON.stringify(chatJsonValue, null, 2),
          example_response: exampleResponse,
        });
        messages.push({ content: finalPrompt, role: 'user' });
        const rest = await makeRequest(messages);
        if (!rest?.content) throw new Error('No response content received.');
        // @ts-ignore
        response = parseResponse(rest.content as string, format, { schema: chatJsonValue });
      }

      if (!response || Object.keys(response as any).length === 0) throw new Error('Empty response from zTracker.');

      try {
        applyTrackerUpdateAndRender(message as any, {
          trackerData: response,
          trackerHtml: chatHtmlValue,
          render: () => renderTrackerWithDeps(id),
        });

        if (detailsState.length > 0) {
          const newTracker = messageBlock?.querySelector('.mes_ztracker');
          if (newTracker) {
            const newDetailsElements = newTracker.querySelectorAll('details');
            newDetailsElements.forEach((detail, index) => {
              if (detailsState[index] !== undefined) {
                (detail as HTMLDetailsElement).open = detailsState[index];
              }
            });
          }
        }

        await saveChat();
      } catch {
        renderTrackerWithDeps(id);
        throw new Error(`Generated data failed to render with the current template. Not saved.`);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error generating tracker:', error);
        st_echo('error', `Tracker generation failed: ${(error as Error).message}`);
      }
    } finally {
      mainButton?.classList.remove('spinning');
      regenerateButton?.classList.remove('spinning');
    }
  }

  async function renderExtensionTemplates() {
    const extensionsMenu = document.querySelector('#extensionsMenu');
    const buttonContainer = document.createElement('div');
    buttonContainer.id = 'ztracker_menu_buttons';
    buttonContainer.className = 'extension_container';
    extensionsMenu?.appendChild(buttonContainer);

    const extensionRoot = getExtensionRoot({ importMetaUrl, fallbackFolderName: extensionName });
    const buttonsTemplatePath = 'dist/templates/buttons';
    debugLog(settingsManager, 'Initializing UI', {
      extensionName,
      extensionRoot,
      buttonsTemplatePath,
      buttonsTemplateUrl: getTemplateUrl({ importMetaUrl, fallbackFolderName: extensionName, templatePathNoExt: buttonsTemplatePath }),
    });

    try {
      const buttonHtml = await globalContext.renderExtensionTemplateAsync(extensionRoot, buttonsTemplatePath);
      buttonContainer.insertAdjacentHTML('beforeend', buttonHtml);
    } catch (error) {
      console.error('zTracker: failed to render extension menu buttons template', {
        extensionName,
        extensionRoot,
        templatePath: buttonsTemplatePath,
        expectedUrl: getTemplateUrl({ importMetaUrl, fallbackFolderName: extensionName, templatePathNoExt: buttonsTemplatePath }),
        error,
      });

      if (isDebugLoggingEnabled(settingsManager)) {
        const checks = await Promise.all([
          checkTemplateUrl({ importMetaUrl, fallbackFolderName: extensionName, templatePathNoExt: 'templates/buttons' }),
          checkTemplateUrl({ importMetaUrl, fallbackFolderName: extensionName, templatePathNoExt: 'dist/templates/buttons' }),
          checkTemplateUrl({ importMetaUrl, fallbackFolderName: extensionName, templatePathNoExt: 'templates/modify_schema_popup' }),
          checkTemplateUrl({ importMetaUrl, fallbackFolderName: extensionName, templatePathNoExt: 'dist/templates/modify_schema_popup' }),
        ]);
        debugLog(settingsManager, 'Template availability checks', checks);
        (globalThis as any).zTrackerDiagnostics = { templateChecks: checks };
      }

      st_echo('error', 'zTracker failed to load one or more HTML templates. See console for diagnostics.');
    }

    extensionsMenu?.querySelector('#ztracker_modify_schema_preset')?.addEventListener('click', async () => {
      await modifyChatMetadata();
    });
  }

  async function modifyChatMetadata() {
    const settings = settingsManager.getSettings();
    const context = SillyTavern.getContext();
    const chatMetadata = context.chatMetadata;
    if (!chatMetadata[EXTENSION_KEY]) {
      chatMetadata[EXTENSION_KEY] = {};
    }
    if (!chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY]) {
      chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY] = 'default';
      context.saveMetadataDebounced();
    }
    const currentPresetKey = chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY];

    const templateData = {
      presets: Object.entries(settings.schemaPresets).map(([key, preset]) => ({
        key: key,
        name: preset.name,
        selected: key === currentPresetKey,
      })),
    };

    const extensionRoot = getExtensionRoot({ importMetaUrl, fallbackFolderName: extensionName });
    const popupTemplatePath = 'dist/templates/modify_schema_popup';
    let popupContent: string;
    try {
      popupContent = await globalContext.renderExtensionTemplateAsync(extensionRoot, popupTemplatePath, templateData);
    } catch (error) {
      console.error('zTracker: failed to render modify schema popup template', {
        extensionName,
        extensionRoot,
        templatePath: popupTemplatePath,
        expectedUrl: getTemplateUrl({ importMetaUrl, fallbackFolderName: extensionName, templatePathNoExt: popupTemplatePath }),
        error,
      });
      if (isDebugLoggingEnabled(settingsManager)) {
        const checks = await Promise.all([
          checkTemplateUrl({ importMetaUrl, fallbackFolderName: extensionName, templatePathNoExt: 'templates/modify_schema_popup' }),
          checkTemplateUrl({ importMetaUrl, fallbackFolderName: extensionName, templatePathNoExt: 'dist/templates/modify_schema_popup' }),
        ]);
        debugLog(settingsManager, 'Template availability checks', checks);
        (globalThis as any).zTrackerDiagnostics = { templateChecks: checks };
      }
      st_echo('error', 'zTracker failed to load the Modify Schema popup template. See console for diagnostics.');
      return;
    }

    await globalContext.callGenericPopup(popupContent, POPUP_TYPE.CONFIRM, '', {
      okButton: 'Save',
      onClose(popup: any) {
        if (popup.result === POPUP_RESULT.AFFIRMATIVE) {
          const selectElement = document.getElementById('ztracker-chat-schema-select') as HTMLSelectElement;
          if (selectElement) {
            const newPresetKey = selectElement.value;
            if (newPresetKey !== currentPresetKey) {
              chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY] = newPresetKey;
              context.saveMetadataDebounced();
              st_echo('success', `Chat schema preset updated to "${settings.schemaPresets[newPresetKey].name}".`);
            }
          }
        }
      },
    });
  }

  return {
    deleteTracker,
    editTracker,
    generateTracker,
    modifyChatMetadata,
    renderExtensionTemplates,
  };
}

export type TrackerActions = ReturnType<typeof createTrackerActions>;
