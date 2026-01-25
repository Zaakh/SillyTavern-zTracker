import React from 'react';
import { createRoot } from 'react-dom/client';
import { settingsManager, ZTrackerSettings } from './components/Settings.js';

import { buildPrompt, Message, Generator, getWorldInfos } from 'sillytavern-utils-lib';
import { ChatMessage, EventNames, ExtractedData } from 'sillytavern-utils-lib/types';
import { characters, selected_group, st_echo } from 'sillytavern-utils-lib/config';
import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import {
  ExtensionSettings,
  PromptEngineeringMode,
  TrackerWorldInfoPolicyMode,
  EXTENSION_KEY,
  extensionName,
} from './config.js';
import { parseResponse } from './parser.js';
import { schemaToExample } from './schema-to-example.js';
import Handlebars from 'handlebars';
import { POPUP_RESULT, POPUP_TYPE } from 'sillytavern-utils-lib/types/popup';
import { shouldIgnoreWorldInfoDuringTrackerBuild } from './world-info-policy.js';
import { buildAllowlistedWorldInfoText } from './world-info-allowlist.js';
import { loadWorldInfoBookByName } from './sillytavern-world-info.js';
import {
  renderTracker,
  includeZTrackerMessages,
  CHAT_METADATA_SCHEMA_PRESET_KEY,
  CHAT_MESSAGE_SCHEMA_VALUE_KEY,
  CHAT_MESSAGE_SCHEMA_HTML_KEY,
  applyTrackerUpdateAndRender,
} from './tracker.js';

// --- Constants and Globals ---
const globalContext = SillyTavern.getContext();
const generator = new Generator();
const pendingRequests = new Map<number, string>();
const incomingTypes = [AutoModeOptions.RESPONSES, AutoModeOptions.BOTH];
const outgoingTypes = [AutoModeOptions.INPUT, AutoModeOptions.BOTH];
const renderTrackerWithDeps = (messageId: number) =>
  renderTracker(messageId, { context: globalContext, document, handlebars: Handlebars });

function isDebugLoggingEnabled(): boolean {
  try {
    return !!settingsManager.getSettings().debugLogging;
  } catch {
    return false;
  }
}

function debugLog(...args: unknown[]) {
  if (!isDebugLoggingEnabled()) return;
  // eslint-disable-next-line no-console
  console.debug('zTracker:', ...args);
}

function getTemplateUrl(templatePathNoExt: string): string {
  const basePath = `/scripts/extensions/third-party/${extensionName}`;
  return new URL(`${basePath}/${templatePathNoExt}.html`, window.location.origin).toString();
}

async function checkTemplateUrl(templatePathNoExt: string) {
  const url = getTemplateUrl(templatePathNoExt);
  try {
    const response = await fetch(url, { cache: 'no-store' });
    return { templatePathNoExt, url, ok: response.ok, status: response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { templatePathNoExt, url, ok: false, status: null as number | null, error: message };
  }
}

// --- Handlebars Helper ---
if (!Handlebars.helpers['join']) {
  Handlebars.registerHelper('join', function (array: any, separator: any) {
    if (Array.isArray(array)) {
      return array.join(typeof separator === 'string' ? separator : ', ');
    }
    return '';
  });
}

// --- Core Logic Functions (ported from original index.ts) ---

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
    renderTrackerWithDeps(messageId); // This will remove the rendered tracker
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
    onClose: async (popup) => {
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
              detailsState = Array.from(detailsElements).map((detail) => detail.open);
            }
            renderTrackerWithDeps(messageId);
            if (detailsState.length > 0) {
              const newTracker = messageBlock?.querySelector('.mes_ztracker');
              if (newTracker) {
                const newDetailsElements = newTracker.querySelectorAll('details');
                newDetailsElements.forEach((detail, index) => {
                  // Safety check: only apply if a state for this index exists
                  if (detailsState[index] !== undefined) {
                    detail.open = detailsState[index];
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
  // Ensure chat metadata is initialized
  chatMetadata[EXTENSION_KEY] = chatMetadata[EXTENSION_KEY] || {};
  chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY] =
    chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY] || settings.schemaPreset;

  const chatJsonValue = settings.schemaPresets[settings.schemaPreset].value;
  const chatHtmlValue = settings.schemaPresets[settings.schemaPreset].html;

  const profile = extensionSettings.connectionManager?.profiles?.find((p) => p.id === settings.profileId);
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

  debugLog('generateTracker start', {
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
    detailsState = Array.from(detailsElements).map((detail) => detail.open);
  }
  try {
    mainButton?.classList.add('spinning');
    regenerateButton?.classList.add('spinning');

    const trackerWorldInfoMode =
      settings.trackerWorldInfoPolicyMode ?? TrackerWorldInfoPolicyMode.INCLUDE_ALL;
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
    debugLog('prompt built', {
      ignoreWorldInfo,
      messageCount: messages.length,
      roles: messages.map((m) => m.role),
    });

    if (trackerWorldInfoMode === TrackerWorldInfoPolicyMode.ALLOWLIST) {
      const allowlistBookNames = settings.trackerWorldInfoAllowlistBookNames ?? [];
      const allowlistEntryIds = settings.trackerWorldInfoAllowlistEntryIds ?? [];
      if (allowlistBookNames.length > 0 || allowlistEntryIds.length > 0) {
        try {
          debugLog('allowlist injection starting', {
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
            const firstNonSystem = messages.findIndex((m) => m.role !== 'system');
            const insertAt = firstNonSystem === -1 ? messages.length : firstNonSystem;
            messages.splice(insertAt, 0, { role: 'system', content: worldInfoText } as Message);

            debugLog('allowlist injected', {
              insertAt,
              systemCount: messages.filter((m) => m.role === 'system').length,
              injectedLength: worldInfoText.length,
              allowlistBookNames,
              preview: worldInfoText.slice(0, 200),
            });
          } else {
            debugLog('allowlist produced empty worldInfoText', {
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
            onStart: (requestId) => {
              pendingRequests.set(id, requestId);
            },
            onFinish: (requestId, data, error) => {
              pendingRequests.delete(id);
              if (error) {
                return reject(error);
              }
              if (!data) {
                // This is how Generator signals cancellation without an error object
                return reject(new DOMException('Request aborted by user', 'AbortError'));
              }
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
      response = parseResponse(rest.content, format, { schema: chatJsonValue });
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
            // Safety check: only apply if a state for this index exists
            if (detailsState[index] !== undefined) {
              detail.open = detailsState[index];
            }
          });
        }
      }

      // If render succeeds, save the chat
      await saveChat();
    } catch (renderError) {
      // Ensure DOM reflects rolled-back message state
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

// --- UI Initialization (Non-React parts) ---

async function initializeGlobalUI() {
  // Add zTracker icon to message buttons
  const zTrackerIcon = document.createElement('div');
  zTrackerIcon.title = 'zTracker';
  zTrackerIcon.className = 'mes_button mes_ztracker_button fa-solid fa-truck-moving interactable';
  zTrackerIcon.tabIndex = 0;
  document.querySelector('#message_template .mes_buttons .extraMesButtons')?.prepend(zTrackerIcon);

  // Add global click listener for various tracker-related buttons on messages
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const messageEl = target.closest('.mes');

    if (!messageEl) return;
    const messageId = Number(messageEl.getAttribute('mesid'));
    if (isNaN(messageId)) return;

    if (target.classList.contains('mes_ztracker_button')) {
      generateTracker(messageId);
    } else if (target.classList.contains('ztracker-edit-button')) {
      editTracker(messageId);
    } else if (target.classList.contains('ztracker-regenerate-button')) {
      generateTracker(messageId);
    } else if (target.classList.contains('ztracker-delete-button')) {
      deleteTracker(messageId);
    }
  });

  const extensionsMenu = document.querySelector('#extensionsMenu');
  const buttonContainer = document.createElement('div');
  buttonContainer.id = 'ztracker_menu_buttons';
  buttonContainer.className = 'extension_container';
  extensionsMenu?.appendChild(buttonContainer);
  const extensionRoot = `third-party/${extensionName}`;
  const buttonsTemplatePath = 'dist/templates/buttons';
  debugLog('Initializing UI', {
    extensionName,
    extensionRoot,
    buttonsTemplatePath,
    buttonsTemplateUrl: getTemplateUrl(buttonsTemplatePath),
  });

  try {
    const buttonHtml = await globalContext.renderExtensionTemplateAsync(extensionRoot, buttonsTemplatePath);
    buttonContainer.insertAdjacentHTML('beforeend', buttonHtml);
  } catch (error) {
    console.error('zTracker: failed to render extension menu buttons template', {
      extensionName,
      extensionRoot,
      templatePath: buttonsTemplatePath,
      expectedUrl: getTemplateUrl(buttonsTemplatePath),
      error,
    });

    if (isDebugLoggingEnabled()) {
      const checks = await Promise.all([
        checkTemplateUrl('templates/buttons'),
        checkTemplateUrl('dist/templates/buttons'),
        checkTemplateUrl('templates/modify_schema_popup'),
        checkTemplateUrl('dist/templates/modify_schema_popup'),
      ]);
      debugLog('Template availability checks', checks);
      (globalThis as any).zTrackerDiagnostics = { templateChecks: checks };
    }

    st_echo('error', 'zTracker failed to load one or more HTML templates. See console for diagnostics.');
  }
  extensionsMenu?.querySelector('#ztracker_modify_schema_preset')?.addEventListener('click', async () => {
    await modifyChatMetadata();
  });

  // Set up event listeners for auto-mode and chat changes
  const settings = settingsManager.getSettings();
  globalContext.eventSource.on(
    EventNames.CHARACTER_MESSAGE_RENDERED,
    (messageId: number) => incomingTypes.includes(settings.autoMode) && generateTracker(messageId),
  );
  globalContext.eventSource.on(
    EventNames.USER_MESSAGE_RENDERED,
    (messageId: number) => outgoingTypes.includes(settings.autoMode) && generateTracker(messageId),
  );
  globalContext.eventSource.on(EventNames.CHAT_CHANGED, () => {
    const { saveChat } = globalContext;
    let chatModified = false;
    globalContext.chat.forEach((message, i) => {
      try {
        renderTrackerWithDeps(i);
      } catch (error) {
        console.error(`Error rendering zTracker on message ${i}, removing data:`, error);
        st_echo('error', 'A zTracker template failed to render. Removing tracker from the message.');
        if (message?.extra?.[EXTENSION_KEY]) {
          delete message.extra[EXTENSION_KEY];
          chatModified = true;
        }
      }
    });
    if (chatModified) {
      saveChat();
    }
  });

  // Register the global generation interceptor
  (globalThis as any).ztrackerGenerateInterceptor = (chat: ChatMessage[]) => {
    const newChat = includeZTrackerMessages(chat, settingsManager.getSettings());
    chat.length = 0;
    chat.push(...newChat);
  };
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

  // Prepare data for the Handlebars template
  const templateData = {
    presets: Object.entries(settings.schemaPresets).map(([key, preset]) => ({
      key: key,
      name: preset.name,
      selected: key === currentPresetKey,
    })),
  };

  // Render the popup content from the template file
  const extensionRoot = `third-party/${extensionName}`;
  const popupTemplatePath = 'dist/templates/modify_schema_popup';
  let popupContent: string;
  try {
    popupContent = await globalContext.renderExtensionTemplateAsync(extensionRoot, popupTemplatePath, templateData);
  } catch (error) {
    console.error('zTracker: failed to render modify schema popup template', {
      extensionName,
      extensionRoot,
      templatePath: popupTemplatePath,
      expectedUrl: getTemplateUrl(popupTemplatePath),
      error,
    });
    if (isDebugLoggingEnabled()) {
      const checks = await Promise.all([
        checkTemplateUrl('templates/modify_schema_popup'),
        checkTemplateUrl('dist/templates/modify_schema_popup'),
      ]);
      debugLog('Template availability checks', checks);
      (globalThis as any).zTrackerDiagnostics = { templateChecks: checks };
    }
    st_echo('error', 'zTracker failed to load the Modify Schema popup template. See console for diagnostics.');
    return;
  }

  await globalContext.callGenericPopup(popupContent, POPUP_TYPE.CONFIRM, '', {
    okButton: 'Save',
    onClose(popup) {
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

// --- Main Application Entry ---

function renderReactSettings() {
  const settingsContainer = document.getElementById('extensions_settings');
  if (!settingsContainer) {
    console.error('zTracker: Extension settings container not found.');
    return;
  }

  let reactRootEl = document.getElementById('ztracker-react-settings-root');
  if (!reactRootEl) {
    reactRootEl = document.createElement('div');
    reactRootEl.id = 'ztracker-react-settings-root';
    settingsContainer.appendChild(reactRootEl);
  }

  const root = createRoot(reactRootEl);
  root.render(
    <React.StrictMode>
      <ZTrackerSettings />
    </React.StrictMode>,
  );
}

function main() {
  renderReactSettings();
  initializeGlobalUI();
}

settingsManager
  .initializeSettings()
  .then(main)
  .catch((error) => {
    console.error(error);
    st_echo('error', 'zTracker data migration failed. Check console for details.');
  });

