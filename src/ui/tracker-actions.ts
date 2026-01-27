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
  CHAT_MESSAGE_PARTS_ORDER_KEY,
  includeZTrackerMessages,
} from '../tracker.js';
import {
  buildArrayItemSchema,
  buildTopLevelPartSchema,
  findArrayItemIndexByIdentity,
  findArrayItemIndexByName,
  getArrayItemIdentityKey,
  resolveTopLevelPartsOrder,
  mergeTrackerPart,
  replaceTrackerArrayItem,
} from '../tracker-parts.js';
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
  const pendingSequences = new Map<number, { cancelled: boolean }>();

  function buildPartsMeta(schema: any): Record<string, { idKey?: string }> {
    const meta: Record<string, { idKey?: string }> = {};
    const props = schema?.properties;
    if (!props || typeof props !== 'object') return meta;
    for (const key of Object.keys(props)) {
      const def = (props as any)[key];
      if (def?.type === 'array') {
        meta[key] = { idKey: getArrayItemIdentityKey(schema, key) };
      }
    }
    return meta;
  }

  function captureDetailsState(messageId: number): boolean[] {
    const messageBlock = document.querySelector(`.mes[mesid="${messageId}"]`);
    const existingTracker = messageBlock?.querySelector('.mes_ztracker');
    if (!existingTracker) return [];
    const detailsElements = existingTracker.querySelectorAll('details');
    return Array.from(detailsElements).map((detail) => (detail as HTMLDetailsElement).open);
  }

  function restoreDetailsState(messageId: number, detailsState: boolean[]): void {
    if (!detailsState.length) return;
    const messageBlock = document.querySelector(`.mes[mesid="${messageId}"]`);
    const newTracker = messageBlock?.querySelector('.mes_ztracker');
    if (!newTracker) return;

    const newDetailsElements = newTracker.querySelectorAll('details');
    newDetailsElements.forEach((detail, index) => {
      if (detailsState[index] !== undefined) {
        (detail as HTMLDetailsElement).open = detailsState[index];
      }
    });
  }

  function cancelIfPending(messageId: number): boolean {
    if (!pendingRequests.has(messageId)) return false;
    const requestId = pendingRequests.get(messageId)!;
    generator.abortRequest(requestId);
    const token = pendingSequences.get(messageId);
    if (token) token.cancelled = true;
    st_echo('info', 'Tracker generation cancelled.');
    return true;
  }

  function makeRequestFactory(messageId: number, settings: ExtensionSettings) {
    return (requestMessages: Message[], overideParams?: any): Promise<ExtractedData | undefined> => {
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
              pendingRequests.set(messageId, requestId);
            },
            onFinish: (requestId: string, data: unknown, error: unknown) => {
              pendingRequests.delete(messageId);
              if (error) return reject(error);
              if (!data) return reject(new DOMException('Request aborted by user', 'AbortError'));
              resolve(data as ExtractedData | undefined);
            },
          },
        );
      });
    };
  }

  function appendCurrentTrackerSnapshot(messages: Message[], tracker: unknown, label: string): void {
    if (!tracker || typeof tracker !== 'object') return;
    try {
      const text = JSON.stringify(tracker, null, 2);
      messages.push({
        role: 'system',
        content: `${label}\n\n\`\`\`json\n${text}\n\`\`\``,
      } as Message);
    } catch {
      // ignore
    }
  }

  async function prepareTrackerGeneration(messageId: number) {
    const message = globalContext.chat[messageId];
    if (!message) {
      throw new Error(`Message with ID ${messageId} not found.`);
    }

    const settings = settingsManager.getSettings();
    if (!settings.profileId) {
      throw new Error('Please select a connection profile in settings.');
    }

    const context = SillyTavern.getContext();
    const chatMetadata = context.chatMetadata;
    const { extensionSettings, CONNECT_API_MAP } = globalContext;

    chatMetadata[EXTENSION_KEY] = chatMetadata[EXTENSION_KEY] || {};
    chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY] =
      chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY] || settings.schemaPreset;

    const chatJsonValue = settings.schemaPresets[settings.schemaPreset].value;
    const chatHtmlValue = settings.schemaPresets[settings.schemaPreset].html;

    const profile = extensionSettings.connectionManager?.profiles?.find((p: any) => p.id === settings.profileId);
    if (!profile) {
      throw new Error('Selected connection profile not found. Please re-select a profile in zTracker settings.');
    }
    if (!profile.api) {
      throw new Error('Selected connection profile is missing an API. Please edit the profile in SillyTavern settings.');
    }

    const apiMap = CONNECT_API_MAP[profile.api];
    if (!apiMap?.selected) {
      throw new Error(`Unsupported or unknown API for prompt building: ${String(profile.api)}`);
    }

    let characterId = characters.findIndex((char: any) => char.avatar === message.original_avatar);
    characterId = characterId !== -1 ? characterId : undefined;

    const trackerWorldInfoMode = settings.trackerWorldInfoPolicyMode ?? TrackerWorldInfoPolicyMode.INCLUDE_ALL;
    const ignoreWorldInfo = shouldIgnoreWorldInfoDuringTrackerBuild(trackerWorldInfoMode);

    const promptResult = await buildPrompt(apiMap.selected, {
      targetCharacterId: characterId,
      messageIndexesBetween: {
        end: messageId,
        start: settings.includeLastXMessages > 0 ? Math.max(0, messageId - settings.includeLastXMessages) : 0,
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

    const existingTracker = message?.extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY];

    return {
      message,
      settings,
      chatJsonValue,
      chatHtmlValue,
      messages,
      existingTracker,
    };
  }

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

  async function generateTrackerFull(id: number) {
    if (cancelIfPending(id)) return;

    const { saveChat } = globalContext;

    debugLog(settingsManager, 'generateTracker start', {
      mesId: id,
      mode: settingsManager.getSettings().promptEngineeringMode,
    });

    const messageBlock = document.querySelector(`.mes[mesid="${id}"]`);
    const mainButton = messageBlock?.querySelector('.mes_ztracker_button');
    const regenerateButton = messageBlock?.querySelector('.ztracker-regenerate-button');
    const detailsState = captureDetailsState(id);

    try {
      mainButton?.classList.add('spinning');
      regenerateButton?.classList.add('spinning');

      const { message, settings, chatJsonValue, chatHtmlValue, messages, existingTracker } = await prepareTrackerGeneration(id);
      const partsOrder = resolveTopLevelPartsOrder(chatJsonValue);
      const partsMeta = buildPartsMeta(chatJsonValue);
      const makeRequest = makeRequestFactory(id, settings);

      let response: ExtractedData['content'];

      if (settings.promptEngineeringMode === PromptEngineeringMode.NATIVE) {
        appendCurrentTrackerSnapshot(messages as any, existingTracker, 'Current tracker for this message (use as reference):');
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
        appendCurrentTrackerSnapshot(messages as any, existingTracker, 'Current tracker for this message (use as reference):');
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
          extensionData: { [CHAT_MESSAGE_PARTS_ORDER_KEY]: partsOrder, partsMeta },
          render: () => renderTrackerWithDeps(id),
        });
        restoreDetailsState(id, detailsState);
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

  async function generateTrackerSequential(id: number) {
    if (cancelIfPending(id)) return;

    const { saveChat } = globalContext;
    const messageBlock = document.querySelector(`.mes[mesid="${id}"]`);
    const mainButton = messageBlock?.querySelector('.mes_ztracker_button');
    const regenerateButton = messageBlock?.querySelector('.ztracker-regenerate-button');
    const detailsState = captureDetailsState(id);

    const token = { cancelled: false };
    pendingSequences.set(id, token);

    try {
      mainButton?.classList.add('spinning');
      regenerateButton?.classList.add('spinning');

      const { message, settings, chatJsonValue, chatHtmlValue, messages, existingTracker } = await prepareTrackerGeneration(id);
      const partsOrder = resolveTopLevelPartsOrder(chatJsonValue);
      const partsMeta = buildPartsMeta(chatJsonValue);
      if (partsOrder.length === 0) {
        throw new Error('Schema has no top-level properties to generate.');
      }

      const makeRequest = makeRequestFactory(id, settings);
      const baseMessages = structuredClone(messages) as Message[];
      appendCurrentTrackerSnapshot(baseMessages, existingTracker, 'Current tracker for this message (use as reference):');
      let trackerData: any = {};

      for (const partKey of partsOrder) {
        if (token.cancelled) break;

        const partSchema = buildTopLevelPartSchema(chatJsonValue, partKey);
        const requestMessages = structuredClone(baseMessages) as Message[];

        // Provide current partial state so parts can depend on previously generated parts.
        if (trackerData && Object.keys(trackerData).length > 0) {
          appendCurrentTrackerSnapshot(
            requestMessages,
            trackerData,
            'Tracker so far in this sequential run (keep consistent and build on it):',
          );
        }

        let partResponse: any;
        if (settings.promptEngineeringMode === PromptEngineeringMode.NATIVE) {
          requestMessages.push({
            role: 'user',
            content: `${settings.prompt}\n\nGenerate ONLY the field "${partKey}". Return a single JSON object matching the provided schema.`,
          } as any);
          const result = await makeRequest(requestMessages, {
            json_schema: { name: 'SceneTrackerPart', strict: true, value: partSchema },
          });
          // @ts-ignore
          partResponse = result?.content;
        } else {
          const format = settings.promptEngineeringMode as 'json' | 'xml';
          const promptTemplate = format === 'json' ? settings.promptJson : settings.promptXml;
          const exampleResponse = schemaToExample(partSchema, format);
          const finalPrompt = Handlebars.compile(promptTemplate, { noEscape: true, strict: true })({
            schema: JSON.stringify(partSchema, null, 2),
            example_response: exampleResponse,
          });
          requestMessages.push({ content: finalPrompt, role: 'user' });
          const rest = await makeRequest(requestMessages);
          if (!rest?.content) throw new Error('No response content received.');
          partResponse = parseResponse(rest.content as string, format, { schema: partSchema });
        }

        if (!partResponse || Object.keys(partResponse as any).length === 0) {
          throw new Error(`Empty response while generating part: ${partKey}`);
        }

        trackerData = mergeTrackerPart(trackerData, partKey, partResponse);
      }

      if (token.cancelled) {
        return;
      }

      if (!trackerData || Object.keys(trackerData).length === 0) {
        throw new Error('Empty response from zTracker.');
      }

      try {
        applyTrackerUpdateAndRender(message as any, {
          trackerData,
          trackerHtml: chatHtmlValue,
          extensionData: { [CHAT_MESSAGE_PARTS_ORDER_KEY]: partsOrder, partsMeta },
          render: () => renderTrackerWithDeps(id),
        });
        restoreDetailsState(id, detailsState);
        await saveChat();
      } catch {
        renderTrackerWithDeps(id);
        throw new Error(`Generated data failed to render with the current template. Not saved.`);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error generating tracker (sequential):', error);
        st_echo('error', `Tracker generation failed: ${(error as Error).message}`);
      }
    } finally {
      pendingSequences.delete(id);
      mainButton?.classList.remove('spinning');
      regenerateButton?.classList.remove('spinning');
    }
  }

  async function generateTrackerPart(id: number, partKey: string) {
    if (cancelIfPending(id)) return;

    const { saveChat } = globalContext;
    const messageBlock = document.querySelector(`.mes[mesid="${id}"]`);
    const partButton = messageBlock?.querySelector(
      `.ztracker-part-regenerate-button[data-ztracker-part="${CSS.escape(partKey)}"]`,
    );

    const detailsState = captureDetailsState(id);

    try {
      partButton?.classList.add('spinning');

      const { message, settings, chatJsonValue, chatHtmlValue, messages } = await prepareTrackerGeneration(id);

      const currentTracker = message?.extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY];
      if (!currentTracker || typeof currentTracker !== 'object') {
        throw new Error('No existing tracker found for this message. Generate a full tracker first.');
      }

      const partsOrder = resolveTopLevelPartsOrder(chatJsonValue);
      const partsMeta = buildPartsMeta(chatJsonValue);
      const partSchema = buildTopLevelPartSchema(chatJsonValue, partKey);
      const makeRequest = makeRequestFactory(id, settings);

      appendCurrentTrackerSnapshot(messages as any, currentTracker, 'Current tracker for this message (keep consistent):');

      let partResponse: any;
      if (settings.promptEngineeringMode === PromptEngineeringMode.NATIVE) {
        messages.push({
          role: 'user',
          content: `${settings.prompt}\n\nGenerate ONLY the field "${partKey}". Return a single JSON object matching the provided schema.`,
        } as any);
        const result = await makeRequest(messages, {
          json_schema: { name: 'SceneTrackerPart', strict: true, value: partSchema },
        });
        // @ts-ignore
        partResponse = result?.content;
      } else {
        const format = settings.promptEngineeringMode as 'json' | 'xml';
        const promptTemplate = format === 'json' ? settings.promptJson : settings.promptXml;
        const exampleResponse = schemaToExample(partSchema, format);
        const finalPrompt = Handlebars.compile(promptTemplate, { noEscape: true, strict: true })({
          schema: JSON.stringify(partSchema, null, 2),
          example_response: exampleResponse,
        });
        messages.push({ content: finalPrompt, role: 'user' });
        const rest = await makeRequest(messages);
        if (!rest?.content) throw new Error('No response content received.');
        partResponse = parseResponse(rest.content as string, format, { schema: partSchema });
      }

      if (!partResponse || Object.keys(partResponse as any).length === 0) {
        throw new Error(`Empty response while generating part: ${partKey}`);
      }

      const nextTracker = mergeTrackerPart(currentTracker, partKey, partResponse);

      try {
        applyTrackerUpdateAndRender(message as any, {
          trackerData: nextTracker,
          trackerHtml: chatHtmlValue,
          extensionData: { [CHAT_MESSAGE_PARTS_ORDER_KEY]: partsOrder, partsMeta },
          render: () => renderTrackerWithDeps(id),
        });
        restoreDetailsState(id, detailsState);
        await saveChat();
        st_echo('success', `Updated: ${partKey}`);
      } catch {
        renderTrackerWithDeps(id);
        throw new Error(`Generated data failed to render with the current template. Not saved.`);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error generating tracker part:', error);
        st_echo('error', `Tracker generation failed: ${(error as Error).message}`);
      }
    } finally {
      partButton?.classList.remove('spinning');
    }
  }

  async function generateTrackerArrayItem(id: number, partKey: string, index: number) {
    if (cancelIfPending(id)) return;

    const { saveChat } = globalContext;
    const messageBlock = document.querySelector(`.mes[mesid="${id}"]`);
    const itemButton = messageBlock?.querySelector(
      `.ztracker-array-item-regenerate-button[data-ztracker-part="${CSS.escape(partKey)}"][data-ztracker-index="${index}"]`,
    );

    const detailsState = captureDetailsState(id);

    try {
      itemButton?.classList.add('spinning');

      const { message, settings, chatJsonValue, chatHtmlValue, messages } = await prepareTrackerGeneration(id);
      const currentTracker = message?.extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY];
      if (!currentTracker || typeof currentTracker !== 'object') {
        throw new Error('No existing tracker found for this message. Generate a full tracker first.');
      }

      const currentArr = (currentTracker as any)?.[partKey];
      if (!Array.isArray(currentArr)) {
        throw new Error(`Tracker field is not an array: ${partKey}`);
      }
      if (index < 0 || index >= currentArr.length) {
        throw new Error(`Array index out of range for ${partKey}: ${index}`);
      }

      const partsOrder = resolveTopLevelPartsOrder(chatJsonValue);
      const partsMeta = buildPartsMeta(chatJsonValue);
      const itemSchema = buildArrayItemSchema(chatJsonValue, partKey);
      const makeRequest = makeRequestFactory(id, settings);

      appendCurrentTrackerSnapshot(messages as any, currentTracker, 'Current tracker for this message (keep consistent):');
      appendCurrentTrackerSnapshot(
        messages as any,
        { part: partKey, index, currentItem: currentArr[index] },
        'Regenerate ONLY this array item:',
      );

      let itemResponse: any;
      if (settings.promptEngineeringMode === PromptEngineeringMode.NATIVE) {
        messages.push({
          role: 'user',
          content: `${settings.prompt}\n\nRegenerate ONLY ${partKey}[${index}] as an object under key "item". Return a single JSON object matching the provided schema.`,
        } as any);
        const result = await makeRequest(messages, {
          json_schema: { name: 'SceneTrackerItem', strict: true, value: itemSchema },
        });
        // @ts-ignore
        itemResponse = result?.content;
      } else {
        const format = settings.promptEngineeringMode as 'json' | 'xml';
        const promptTemplate = format === 'json' ? settings.promptJson : settings.promptXml;
        const exampleResponse = schemaToExample(itemSchema, format);
        const finalPrompt = Handlebars.compile(promptTemplate, { noEscape: true, strict: true })({
          schema: JSON.stringify(itemSchema, null, 2),
          example_response: exampleResponse,
        });
        messages.push({ content: finalPrompt, role: 'user' });
        const rest = await makeRequest(messages);
        if (!rest?.content) throw new Error('No response content received.');
        itemResponse = parseResponse(rest.content as string, format, { schema: itemSchema });
      }

      const item = itemResponse?.item;
      if (item === undefined) {
        throw new Error('Item response missing key: item');
      }

      const nextTracker = replaceTrackerArrayItem(currentTracker, partKey, index, item);

      try {
        applyTrackerUpdateAndRender(message as any, {
          trackerData: nextTracker,
          trackerHtml: chatHtmlValue,
          extensionData: { [CHAT_MESSAGE_PARTS_ORDER_KEY]: partsOrder, partsMeta },
          render: () => renderTrackerWithDeps(id),
        });
        restoreDetailsState(id, detailsState);
        await saveChat();
        st_echo('success', `Updated: ${partKey}[${index}]`);
      } catch {
        renderTrackerWithDeps(id);
        throw new Error(`Generated data failed to render with the current template. Not saved.`);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error generating tracker array item:', error);
        st_echo('error', `Tracker generation failed: ${(error as Error).message}`);
      }
    } finally {
      itemButton?.classList.remove('spinning');
    }
  }

  async function generateTrackerArrayItemByName(id: number, partKey: string, name: string) {
    if (cancelIfPending(id)) return;

    const { saveChat } = globalContext;
    const messageBlock = document.querySelector(`.mes[mesid="${id}"]`);
    const itemButton = messageBlock?.querySelector(
      `.ztracker-array-item-regenerate-button[data-ztracker-part="${CSS.escape(partKey)}"][data-ztracker-name="${CSS.escape(name)}"]`,
    );

    const detailsState = captureDetailsState(id);

    try {
      itemButton?.classList.add('spinning');

      const { message, settings, chatJsonValue, chatHtmlValue, messages } = await prepareTrackerGeneration(id);
      const currentTracker = message?.extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY];
      if (!currentTracker || typeof currentTracker !== 'object') {
        throw new Error('No existing tracker found for this message. Generate a full tracker first.');
      }

      const currentArr = (currentTracker as any)?.[partKey];
      if (!Array.isArray(currentArr)) {
        throw new Error(`Tracker field is not an array: ${partKey}`);
      }

      const index = findArrayItemIndexByName(currentArr, name);
      if (index === -1) {
        throw new Error(`No array item found by name in ${partKey}: ${name}`);
      }

      const currentItem = currentArr[index];
      const shouldPreserveName =
        currentItem && typeof currentItem === 'object' && typeof (currentItem as any).name === 'string';

      const partsOrder = resolveTopLevelPartsOrder(chatJsonValue);
      const partsMeta = buildPartsMeta(chatJsonValue);
      const itemSchema = buildArrayItemSchema(chatJsonValue, partKey);
      const makeRequest = makeRequestFactory(id, settings);

      appendCurrentTrackerSnapshot(messages as any, currentTracker, 'Current tracker for this message (keep consistent):');
      appendCurrentTrackerSnapshot(
        messages as any,
        { part: partKey, matchBy: 'name', name, index, currentItem },
        'Regenerate ONLY this array item (matched by name):',
      );

      let itemResponse: any;
      const preserveLine = shouldPreserveName
        ? `\n\nIMPORTANT: Preserve the item name exactly as "${name}".`
        : '';

      if (settings.promptEngineeringMode === PromptEngineeringMode.NATIVE) {
        messages.push({
          role: 'user',
          content: `${settings.prompt}\n\nRegenerate ONLY the ${partKey} item with name "${name}" as an object under key "item". Return a single JSON object matching the provided schema.${preserveLine}`,
        } as any);
        const result = await makeRequest(messages, {
          json_schema: { name: 'SceneTrackerItem', strict: true, value: itemSchema },
        });
        // @ts-ignore
        itemResponse = result?.content;
      } else {
        const format = settings.promptEngineeringMode as 'json' | 'xml';
        const promptTemplate = format === 'json' ? settings.promptJson : settings.promptXml;
        const exampleResponse = schemaToExample(itemSchema, format);
        const finalPrompt = Handlebars.compile(promptTemplate, { noEscape: true, strict: true })({
          schema: JSON.stringify(itemSchema, null, 2),
          example_response: exampleResponse,
        });
        messages.push({ content: `${finalPrompt}${preserveLine}`, role: 'user' });
        const rest = await makeRequest(messages);
        if (!rest?.content) throw new Error('No response content received.');
        itemResponse = parseResponse(rest.content as string, format, { schema: itemSchema });
      }

      let item = itemResponse?.item;
      if (item === undefined) {
        throw new Error('Item response missing key: item');
      }

      if (shouldPreserveName && item && typeof item === 'object') {
        (item as any).name = name;
      }

      const nextTracker = replaceTrackerArrayItem(currentTracker, partKey, index, item);

      try {
        applyTrackerUpdateAndRender(message as any, {
          trackerData: nextTracker,
          trackerHtml: chatHtmlValue,
          extensionData: { [CHAT_MESSAGE_PARTS_ORDER_KEY]: partsOrder, partsMeta },
          render: () => renderTrackerWithDeps(id),
        });
        restoreDetailsState(id, detailsState);
        await saveChat();
        st_echo('success', `Updated: ${partKey} (${name})`);
      } catch {
        renderTrackerWithDeps(id);
        throw new Error(`Generated data failed to render with the current template. Not saved.`);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error generating tracker array item (by name):', error);
        st_echo('error', `Tracker generation failed: ${(error as Error).message}`);
      }
    } finally {
      itemButton?.classList.remove('spinning');
    }
  }

  async function generateTrackerArrayItemByIdentity(id: number, partKey: string, idKey: string, idValue: string) {
    if (cancelIfPending(id)) return;

    const { saveChat } = globalContext;
    const messageBlock = document.querySelector(`.mes[mesid="${id}"]`);
    const itemButton = messageBlock?.querySelector(
      `.ztracker-array-item-regenerate-button[data-ztracker-part="${CSS.escape(partKey)}"][data-ztracker-idkey="${CSS.escape(idKey)}"][data-ztracker-idvalue="${CSS.escape(idValue)}"]`,
    );

    const detailsState = captureDetailsState(id);

    try {
      itemButton?.classList.add('spinning');

      const { message, settings, chatJsonValue, chatHtmlValue, messages } = await prepareTrackerGeneration(id);
      const currentTracker = message?.extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY];
      if (!currentTracker || typeof currentTracker !== 'object') {
        throw new Error('No existing tracker found for this message. Generate a full tracker first.');
      }

      const currentArr = (currentTracker as any)?.[partKey];
      if (!Array.isArray(currentArr)) {
        throw new Error(`Tracker field is not an array: ${partKey}`);
      }

      const index = findArrayItemIndexByIdentity(currentArr, idKey, idValue);
      if (index === -1) {
        throw new Error(`No array item found by ${idKey} in ${partKey}: ${idValue}`);
      }

      const currentItem = currentArr[index];
      const shouldPreserveIdentity =
        currentItem && typeof currentItem === 'object' && typeof (currentItem as any)[idKey] === 'string';

      const partsOrder = resolveTopLevelPartsOrder(chatJsonValue);
      const partsMeta = buildPartsMeta(chatJsonValue);
      const itemSchema = buildArrayItemSchema(chatJsonValue, partKey);
      const makeRequest = makeRequestFactory(id, settings);

      appendCurrentTrackerSnapshot(messages as any, currentTracker, 'Current tracker for this message (keep consistent):');
      appendCurrentTrackerSnapshot(
        messages as any,
        { part: partKey, matchBy: idKey, idValue, index, currentItem },
        'Regenerate ONLY this array item (matched by identity):',
      );

      let itemResponse: any;
      const preserveLine = shouldPreserveIdentity
        ? `\n\nIMPORTANT: Preserve the identity field ${idKey} exactly as "${idValue}".`
        : '';

      if (settings.promptEngineeringMode === PromptEngineeringMode.NATIVE) {
        messages.push({
          role: 'user',
          content: `${settings.prompt}\n\nRegenerate ONLY the ${partKey} item with ${idKey} "${idValue}" as an object under key "item". Return a single JSON object matching the provided schema.${preserveLine}`,
        } as any);
        const result = await makeRequest(messages, {
          json_schema: { name: 'SceneTrackerItem', strict: true, value: itemSchema },
        });
        // @ts-ignore
        itemResponse = result?.content;
      } else {
        const format = settings.promptEngineeringMode as 'json' | 'xml';
        const promptTemplate = format === 'json' ? settings.promptJson : settings.promptXml;
        const exampleResponse = schemaToExample(itemSchema, format);
        const finalPrompt = Handlebars.compile(promptTemplate, { noEscape: true, strict: true })({
          schema: JSON.stringify(itemSchema, null, 2),
          example_response: exampleResponse,
        });
        messages.push({ content: `${finalPrompt}${preserveLine}`, role: 'user' });
        const rest = await makeRequest(messages);
        if (!rest?.content) throw new Error('No response content received.');
        itemResponse = parseResponse(rest.content as string, format, { schema: itemSchema });
      }

      let item = itemResponse?.item;
      if (item === undefined) {
        throw new Error('Item response missing key: item');
      }

      if (shouldPreserveIdentity && item && typeof item === 'object') {
        (item as any)[idKey] = idValue;
      }

      const nextTracker = replaceTrackerArrayItem(currentTracker, partKey, index, item);

      try {
        applyTrackerUpdateAndRender(message as any, {
          trackerData: nextTracker,
          trackerHtml: chatHtmlValue,
          extensionData: { [CHAT_MESSAGE_PARTS_ORDER_KEY]: partsOrder, partsMeta },
          render: () => renderTrackerWithDeps(id),
        });
        restoreDetailsState(id, detailsState);
        await saveChat();
        st_echo('success', `Updated: ${partKey} (${idKey}=${idValue})`);
      } catch {
        renderTrackerWithDeps(id);
        throw new Error(`Generated data failed to render with the current template. Not saved.`);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error generating tracker array item (by identity):', error);
        st_echo('error', `Tracker generation failed: ${(error as Error).message}`);
      }
    } finally {
      itemButton?.classList.remove('spinning');
    }
  }

  async function generateTracker(id: number) {
    const settings = settingsManager.getSettings();
    if (settings.sequentialPartGeneration) {
      return generateTrackerSequential(id);
    }
    return generateTrackerFull(id);
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
    generateTrackerPart,
    generateTrackerArrayItem,
    generateTrackerArrayItemByName,
    generateTrackerArrayItemByIdentity,
    modifyChatMetadata,
    renderExtensionTemplates,
  };
}

export type TrackerActions = ReturnType<typeof createTrackerActions>;
