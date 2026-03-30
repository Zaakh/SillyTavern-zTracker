import type { ExtensionSettings } from '../config.js';
import { PromptEngineeringMode, TrackerWorldInfoPolicyMode, EXTENSION_KEY, extensionName } from '../config.js';
import type { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import { buildPrompt, Generator, getWorldInfos, Message } from 'sillytavern-utils-lib';
import type { ChatMessage, ExtractedData } from 'sillytavern-utils-lib/types';
import { characters, selected_group, st_echo } from 'sillytavern-utils-lib/config';
import Handlebars from 'handlebars';
import { POPUP_RESULT, POPUP_TYPE } from 'sillytavern-utils-lib/types/popup';
import { parseResponse } from '../parser.js';
import { schemaToExample, schemaToPromptSchema } from '../schema-to-example.js';
import { shouldIgnoreWorldInfoDuringTrackerBuild } from '../world-info-policy.js';
import { buildAllowlistedWorldInfoText } from '../world-info-allowlist.js';
import { loadWorldInfoBookByName } from '../sillytavern-world-info.js';
import {
  hasSystemPromptPreset,
  getSystemPromptPresetContent,
  insertSystemPromptMessage,
  resolveTrackerSystemPromptName,
} from '../system-prompt.js';
import {
  applyTrackerUpdateAndRender,
  CHAT_METADATA_SCHEMA_PRESET_KEY,
  CHAT_MESSAGE_SCHEMA_HTML_KEY,
  CHAT_MESSAGE_SCHEMA_VALUE_KEY,
  CHAT_MESSAGE_PARTS_ORDER_KEY,
  includeZTrackerMessages,
  sanitizeMessagesForGeneration,
} from '../tracker.js';
import {
  buildArrayItemFieldSchema,
  buildArrayItemSchema,
  buildTopLevelPartSchema,
  findArrayItemIndexByIdentity,
  findArrayItemIndexByName,
  getArrayItemIdentityKey,
  resolveTopLevelPartsOrder,
  mergeTrackerPart,
  redactTrackerArrayItemValue,
  redactTrackerPartValue,
  replaceTrackerArrayItem,
  replaceTrackerArrayItemField,
  redactTrackerArrayItemFieldValue,
} from '../tracker-parts.js';
import { checkTemplateUrl, getExtensionRoot, getTemplateUrl } from './templates.js';
import { debugLog, isDebugLoggingEnabled } from './debug.js';

type PromptEngineeredFormat = 'json' | 'xml' | 'toon';

type PromptEngineeredPayloadRecord = {
  format: PromptEngineeredFormat;
  rawContent: string;
  parsedContent?: object;
};

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
  const promptEngineeredPayloads = new WeakMap<object, PromptEngineeredPayloadRecord>();

  // Stores array identity and dependency hints alongside rendered tracker parts for follow-up validation and UI actions.
  function buildPartsMeta(schema: any): Record<string, { idKey?: string; fields?: string[]; dependsOn?: string[] }> {
    const meta: Record<string, { idKey?: string; fields?: string[]; dependsOn?: string[] }> = {};
    const props = schema?.properties;
    if (!props || typeof props !== 'object') return meta;
    for (const key of Object.keys(props)) {
      const def = (props as any)[key];
      if (def?.type === 'array') {
        const idKey = getArrayItemIdentityKey(schema, key);
        const dependsOn = Array.isArray(def?.['x-ztracker-dependsOn'])
          ? def['x-ztracker-dependsOn'].filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
          : typeof def?.['x-ztracker-dependsOn'] === 'string' && def['x-ztracker-dependsOn'].trim().length > 0
            ? [def['x-ztracker-dependsOn'].trim()]
            : undefined;
        const itemProps = def?.items?.type === 'object' ? def?.items?.properties : undefined;
        const fields =
          itemProps && typeof itemProps === 'object'
            ? Object.keys(itemProps).filter((f) => f !== idKey && f !== 'name')
            : undefined;
        meta[key] = { idKey, ...(fields?.length ? { fields } : {}), ...(dependsOn?.length ? { dependsOn } : {}) };
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
        const sanitizedPrompt = sanitizeMessagesForGeneration(requestMessages);
        generator.generateRequest(
          {
            profileId: settings.profileId,
            prompt: sanitizedPrompt,
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

  function getPromptEngineeredFormat(mode: PromptEngineeringMode): PromptEngineeredFormat | undefined {
    switch (mode) {
      case PromptEngineeringMode.JSON:
        return 'json';
      case PromptEngineeringMode.XML:
        return 'xml';
      case PromptEngineeringMode.TOON:
        return 'toon';
      default:
        return undefined;
    }
  }

  function getPromptEngineeringTemplate(settings: ExtensionSettings, format: PromptEngineeredFormat): string {
    switch (format) {
      case 'xml':
        return settings.promptXml;
      case 'toon':
        return settings.promptToon;
      default:
        return settings.promptJson;
    }
  }

  // Captures raw prompt-engineered payloads so malformed replies can be inspected after parse or render failures.
  function logMalformedPromptEngineeredPayload(details: {
    format: PromptEngineeredFormat;
    reason: 'parse failure' | 'render rollback';
    rawContent: string;
    parsedContent?: object;
    error?: unknown;
  }): void {
    const { format, reason, rawContent, parsedContent, error } = details;
    console.warn('zTracker: malformed prompt-engineered payload', {
      format,
      reason,
      rawContent,
      ...(parsedContent ? { parsedContent } : {}),
      ...(error instanceof Error ? { error: error.message } : error ? { error: String(error) } : {}),
    });
  }

  function rememberPromptEngineeredPayload(parsedContent: object, payload: PromptEngineeredPayloadRecord): object {
    promptEngineeredPayloads.set(parsedContent, payload);
    return parsedContent;
  }

  function logPromptEngineeredRenderRollback(parsedContent: unknown, error: unknown): void {
    if (!parsedContent || typeof parsedContent !== 'object') {
      return;
    }

    const payload = promptEngineeredPayloads.get(parsedContent as object);
    if (!payload) {
      return;
    }

    logMalformedPromptEngineeredPayload({
      format: payload.format,
      reason: 'render rollback',
      rawContent: payload.rawContent,
      parsedContent: payload.parsedContent,
      error,
    });
  }

  async function requestPromptEngineeredResponse(
    makeRequest: (requestMessages: Message[], overideParams?: any) => Promise<ExtractedData | undefined>,
    requestMessages: Message[],
    settings: ExtensionSettings,
    schema: object,
    suffix = '',
  ): Promise<object> {
    const format = getPromptEngineeredFormat(settings.promptEngineeringMode);
    if (!format) {
      throw new Error(`Unsupported prompt-engineering mode: ${settings.promptEngineeringMode}`);
    }

    const promptTemplate = getPromptEngineeringTemplate(settings, format);
    const exampleResponse = schemaToExample(schema, format);
    const promptSchema = schemaToPromptSchema(schema, format);
    const finalPrompt = Handlebars.compile(promptTemplate, { noEscape: true, strict: true })({
      schema: promptSchema,
      example_response: exampleResponse,
    });
    requestMessages.push({ content: `${finalPrompt}${suffix}`, role: 'user' });

    const response = await makeRequest(requestMessages);
    if (!response?.content) throw new Error('No response content received.');
    try {
      const parsedContent = parseResponse(response.content as string, format, { schema });
      return rememberPromptEngineeredPayload(parsedContent, {
        format,
        rawContent: response.content as string,
        parsedContent,
      });
    } catch (error) {
      logMalformedPromptEngineeredPayload({
        format,
        reason: 'parse failure',
        rawContent: response.content as string,
        error,
      });
      throw error;
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

    const syspromptName = resolveTrackerSystemPromptName(settings, profile);
    let savedSystemPromptContent: string | undefined;
    if (settings.trackerSystemPromptMode === 'saved') {
      if (!syspromptName) {
        throw new Error('Please select a saved system prompt in zTracker settings.');
      }
      if (!hasSystemPromptPreset(syspromptName, context)) {
        throw new Error(`Saved system prompt not found: ${syspromptName}. Please select another one in zTracker settings.`);
      }
      savedSystemPromptContent = getSystemPromptPresetContent(syspromptName, context);
      if (!savedSystemPromptContent) {
        throw new Error(`Saved system prompt is empty: ${syspromptName}. Please edit it or select another one in zTracker settings.`);
      }
    }

    let promptResult;
    promptResult = await buildPrompt(apiMap.selected, {
      targetCharacterId: characterId,
      messageIndexesBetween: {
        end: messageId,
        start: settings.includeLastXMessages > 0 ? Math.max(0, messageId - settings.includeLastXMessages) : 0,
      },
      presetName: profile?.preset,
      contextName: profile?.context,
      instructName: profile?.instruct,
      syspromptName: settings.trackerSystemPromptMode === 'profile' ? syspromptName : undefined,
      includeNames: true,
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

    if (savedSystemPromptContent) {
      messages = insertSystemPromptMessage(messages, savedSystemPromptContent);
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
        messages.push({ content: settings.prompt, role: 'user' });
        const result = await makeRequest(messages, {
          json_schema: { name: 'SceneTracker', strict: true, value: chatJsonValue },
        });
        // @ts-ignore
        response = result?.content;
      } else {
        // @ts-ignore
        response = await requestPromptEngineeredResponse(makeRequest, messages, settings, chatJsonValue);
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
        logPromptEngineeredRenderRollback(response, new Error('Generated data failed to render with the current template. Not saved.'));
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
          partResponse = await requestPromptEngineeredResponse(makeRequest, requestMessages, settings, partSchema);
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
        logPromptEngineeredRenderRollback(trackerData, new Error('Generated data failed to render with the current template. Not saved.'));
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

      const redactedTracker = redactTrackerPartValue(currentTracker, partKey);
      appendCurrentTrackerSnapshot(
        messages as any,
        redactedTracker,
        'Current tracker for this message (target part omitted for freshness; keep everything else consistent):',
      );

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
        partResponse = await requestPromptEngineeredResponse(makeRequest, messages, settings, partSchema);
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
        logPromptEngineeredRenderRollback(nextTracker, new Error('Generated data failed to render with the current template. Not saved.'));
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

      const idKey = getArrayItemIdentityKey(chatJsonValue, partKey);
      const idValue =
        currentArr[index] && typeof currentArr[index] === 'object' && typeof (currentArr[index] as any)[idKey] === 'string'
          ? String((currentArr[index] as any)[idKey])
          : '';
      const redactedTracker = redactTrackerArrayItemValue(currentTracker, partKey, index);

      appendCurrentTrackerSnapshot(
        messages as any,
        redactedTracker,
        'Current tracker for this message (target item omitted for freshness; keep everything else consistent):',
      );
      appendCurrentTrackerSnapshot(
        messages as any,
        { part: partKey, index, ...(idKey && idValue ? { idKey, idValue } : {}) },
        'Regenerate ONLY this array item (previous item intentionally omitted):',
      );

      let itemResponse: any;
      if (settings.promptEngineeringMode === PromptEngineeringMode.NATIVE) {
        messages.push({
          role: 'user',
          content: `${settings.prompt}\n\nRegenerate ONLY ${partKey}[${index}] as an object under key "item". Return a single JSON object matching the provided schema. IMPORTANT: Generate a fresh item; the previous values have been intentionally omitted and must not be repeated.`,
        } as any);
        const result = await makeRequest(messages, {
          json_schema: { name: 'SceneTrackerItem', strict: true, value: itemSchema },
        });
        // @ts-ignore
        itemResponse = result?.content;
      } else {
        itemResponse = await requestPromptEngineeredResponse(makeRequest, messages, settings, itemSchema);
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
        logPromptEngineeredRenderRollback(nextTracker, new Error('Generated data failed to render with the current template. Not saved.'));
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

      const redactedTracker = redactTrackerArrayItemValue(currentTracker, partKey, index);
      appendCurrentTrackerSnapshot(
        messages as any,
        redactedTracker,
        'Current tracker for this message (target item omitted for freshness; keep everything else consistent):',
      );
      appendCurrentTrackerSnapshot(
        messages as any,
        { part: partKey, matchBy: 'name', name, index },
        'Regenerate ONLY this array item (matched by name; previous values intentionally omitted):',
      );

      let itemResponse: any;
      const preserveLine = shouldPreserveName
        ? `\n\nIMPORTANT: Preserve the item name exactly as "${name}".`
        : '';

      if (settings.promptEngineeringMode === PromptEngineeringMode.NATIVE) {
        messages.push({
          role: 'user',
          content: `${settings.prompt}\n\nRegenerate ONLY the ${partKey} item with name "${name}" as an object under key "item". Return a single JSON object matching the provided schema.${preserveLine}\n\nIMPORTANT: Generate a fresh item; the previous values have been intentionally omitted and must not be repeated.`,
        } as any);
        const result = await makeRequest(messages, {
          json_schema: { name: 'SceneTrackerItem', strict: true, value: itemSchema },
        });
        // @ts-ignore
        itemResponse = result?.content;
      } else {
        itemResponse = await requestPromptEngineeredResponse(
          makeRequest,
          messages,
          settings,
          itemSchema,
          preserveLine,
        );
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
        logPromptEngineeredRenderRollback(nextTracker, new Error('Generated data failed to render with the current template. Not saved.'));
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

      const redactedTracker = redactTrackerArrayItemValue(currentTracker, partKey, index);
      appendCurrentTrackerSnapshot(
        messages as any,
        redactedTracker,
        'Current tracker for this message (target item omitted for freshness; keep everything else consistent):',
      );
      appendCurrentTrackerSnapshot(
        messages as any,
        { part: partKey, matchBy: idKey, idValue, index },
        'Regenerate ONLY this array item (matched by identity; previous values intentionally omitted):',
      );

      let itemResponse: any;
      const preserveLine = shouldPreserveIdentity
        ? `\n\nIMPORTANT: Preserve the identity field ${idKey} exactly as "${idValue}".`
        : '';

      if (settings.promptEngineeringMode === PromptEngineeringMode.NATIVE) {
        messages.push({
          role: 'user',
          content: `${settings.prompt}\n\nRegenerate ONLY the ${partKey} item with ${idKey} "${idValue}" as an object under key "item". Return a single JSON object matching the provided schema.${preserveLine}\n\nIMPORTANT: Generate a fresh item; the previous values have been intentionally omitted and must not be repeated.`,
        } as any);
        const result = await makeRequest(messages, {
          json_schema: { name: 'SceneTrackerItem', strict: true, value: itemSchema },
        });
        // @ts-ignore
        itemResponse = result?.content;
      } else {
        itemResponse = await requestPromptEngineeredResponse(
          makeRequest,
          messages,
          settings,
          itemSchema,
          preserveLine,
        );
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
        logPromptEngineeredRenderRollback(nextTracker, new Error('Generated data failed to render with the current template. Not saved.'));
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

  async function generateTrackerArrayItemField(id: number, partKey: string, index: number, fieldKey: string) {
    if (cancelIfPending(id)) return;

    const { saveChat } = globalContext;
    const messageBlock = document.querySelector(`.mes[mesid="${id}"]`);
    const fieldButton = messageBlock?.querySelector(
      `.ztracker-array-item-field-regenerate-button[data-ztracker-part="${CSS.escape(partKey)}"][data-ztracker-index="${index}"][data-ztracker-field="${CSS.escape(fieldKey)}"]`,
    );

    const detailsState = captureDetailsState(id);

    try {
      fieldButton?.classList.add('spinning');

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

      const currentItem = currentArr[index];
      if (!currentItem || typeof currentItem !== 'object' || Array.isArray(currentItem)) {
        throw new Error(`Array item is not an object at ${partKey}[${index}]`);
      }

      const idKey = getArrayItemIdentityKey(chatJsonValue, partKey);
      const idValue = typeof (currentItem as any)?.[idKey] === 'string' ? String((currentItem as any)[idKey]) : '';

      const itemContext = structuredClone(currentItem);
      if (fieldKey in (itemContext as any)) {
        delete (itemContext as any)[fieldKey];
      }

      const redactedTracker = redactTrackerArrayItemFieldValue(currentTracker, partKey, index, fieldKey);

      const partsOrder = resolveTopLevelPartsOrder(chatJsonValue);
      const partsMeta = buildPartsMeta(chatJsonValue);
      const fieldSchema = buildArrayItemFieldSchema(chatJsonValue, partKey, fieldKey);
      const makeRequest = makeRequestFactory(id, settings);

      appendCurrentTrackerSnapshot(
        messages as any,
        redactedTracker,
        'Current tracker for this message (target field omitted for freshness; keep everything else consistent):',
      );
      appendCurrentTrackerSnapshot(
        messages as any,
        {
          part: partKey,
          index,
          ...(idKey && idValue ? { idKey, idValue } : {}),
          field: fieldKey,
          itemContext,
        },
        'Regenerate ONLY this field within this array item (field value intentionally omitted):',
      );

      let fieldResponse: any;

      if (settings.promptEngineeringMode === PromptEngineeringMode.NATIVE) {
        messages.push({
          role: 'user',
          content: `${settings.prompt}\n\nRegenerate ONLY ${partKey}[${index}].${fieldKey}. Return a single JSON object with key "value" that matches the provided schema. Do not change or rename the array item; only update that field. IMPORTANT: Generate a fresh value; the previous value has been intentionally omitted and must not be repeated.`,
        } as any);
        const result = await makeRequest(messages, {
          json_schema: { name: 'SceneTrackerItemField', strict: true, value: fieldSchema },
        });
        // @ts-ignore
        fieldResponse = result?.content;
      } else {
        fieldResponse = await requestPromptEngineeredResponse(makeRequest, messages, settings, fieldSchema);
      }

      const value = fieldResponse?.value;
      if (value === undefined) {
        throw new Error('Field response missing key: value');
      }

      const nextTracker = replaceTrackerArrayItemField(currentTracker, partKey, index, fieldKey, value);

      try {
        applyTrackerUpdateAndRender(message as any, {
          trackerData: nextTracker,
          trackerHtml: chatHtmlValue,
          extensionData: { [CHAT_MESSAGE_PARTS_ORDER_KEY]: partsOrder, partsMeta },
          render: () => renderTrackerWithDeps(id),
        });
        restoreDetailsState(id, detailsState);
        await saveChat();
        st_echo('success', `Updated: ${partKey}[${index}].${fieldKey}`);
      } catch {
        logPromptEngineeredRenderRollback(nextTracker, new Error('Generated data failed to render with the current template. Not saved.'));
        renderTrackerWithDeps(id);
        throw new Error(`Generated data failed to render with the current template. Not saved.`);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error generating tracker array item field:', error);
        st_echo('error', `Tracker generation failed: ${(error as Error).message}`);
      }
    } finally {
      fieldButton?.classList.remove('spinning');
    }
  }

  async function generateTrackerArrayItemFieldByName(id: number, partKey: string, name: string, fieldKey: string) {
    const message = globalContext.chat[id];
    const currentTracker = message?.extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY];
    const currentArr = (currentTracker as any)?.[partKey];
    if (!Array.isArray(currentArr)) {
      st_echo('error', `Tracker field is not an array: ${partKey}`);
      return;
    }
    const index = findArrayItemIndexByName(currentArr, name);
    if (index === -1) {
      st_echo('error', `No array item found by name in ${partKey}: ${name}`);
      return;
    }
    return generateTrackerArrayItemField(id, partKey, index, fieldKey);
  }

  async function generateTrackerArrayItemFieldByIdentity(
    id: number,
    partKey: string,
    idKey: string,
    idValue: string,
    fieldKey: string,
  ) {
    const message = globalContext.chat[id];
    const currentTracker = message?.extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY];
    const currentArr = (currentTracker as any)?.[partKey];
    if (!Array.isArray(currentArr)) {
      st_echo('error', `Tracker field is not an array: ${partKey}`);
      return;
    }
    const index = findArrayItemIndexByIdentity(currentArr, idKey, idValue);
    if (index === -1) {
      st_echo('error', `No array item found by ${idKey} in ${partKey}: ${idValue}`);
      return;
    }
    return generateTrackerArrayItemField(id, partKey, index, fieldKey);
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
    generateTrackerArrayItemField,
    generateTrackerArrayItemFieldByName,
    generateTrackerArrayItemFieldByIdentity,
    modifyChatMetadata,
    renderExtensionTemplates,
  };
}

export type TrackerActions = ReturnType<typeof createTrackerActions>;
