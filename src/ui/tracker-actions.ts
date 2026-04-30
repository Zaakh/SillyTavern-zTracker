import type { ExtensionSettings } from '../config.js';
import { PromptEngineeringMode, TrackerWorldInfoPolicyMode, EXTENSION_KEY, extensionName } from '../config.js';
import type { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import { buildPrompt, Generator, getWorldInfos, Message } from 'sillytavern-utils-lib';
import type { ExtractedData } from 'sillytavern-utils-lib/types';
import { characters, st_echo } from 'sillytavern-utils-lib/config';
import { POPUP_RESULT, POPUP_TYPE } from 'sillytavern-utils-lib/types/popup';
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
  CHAT_MESSAGE_PENDING_REDACTIONS_KEY,
  CHAT_MESSAGE_SCHEMA_PRESET_KEY,
  CHAT_MESSAGE_SCHEMA_VALUE_KEY,
  CHAT_MESSAGE_PARTS_ORDER_KEY,
  extractLeadingSystemPrompt,
  includeZTrackerMessages,
  normalizeTrackerGenerationConversationRoles,
  sanitizeMessagesForGeneration,
} from '../tracker.js';
import {
  buildArrayItemCleanupTarget,
  buildArrayItemFieldCleanupTarget,
  buildArrayItemFieldSchema,
  buildArrayItemSchema,
  buildTopLevelPartSchema,
  buildPendingRedactions,
  clearTrackerCleanupTargets,
  findArrayItemIndexByIdentity,
  findArrayItemIndexByName,
  getArrayItemIdentityKey,
  getPendingRedactionSchemaPresetKey,
  normalizeTrackerCleanupTargets,
  removePendingRedactionTargets,
  resolveTopLevelPartsOrder,
  mergeTrackerPart,
  redactTrackerArrayItemValue,
  redactTrackerPartValue,
  replaceTrackerArrayItem,
  replaceTrackerArrayItemField,
  redactTrackerArrayItemFieldValue,
  type TrackerCleanupTarget,
} from '../tracker-parts.js';
import { createPromptEngineeringHelpers } from './prompt-engineering.js';
import { checkTemplateUrl, getExtensionRoot, getTemplateUrl } from './templates.js';
import {
  appendCurrentTrackerSnapshot,
  buildPartsMeta,
  captureDetailsState,
  getPromptPresetSelections,
  restoreDetailsState,
  shouldSkipTrackerGeneration,
} from './tracker-action-helpers.js';
import { captureTrackerRequestDebugSnapshot, debugLog, isDebugLoggingEnabled } from './debug.js';
import {
  CONTEXT_MENU_STATUS_CLASS,
  FULL_TRACKER_STATUS_CLASS,
  withMessageStatusIndicator,
} from './message-status-indicator.js';
import {
  bindCleanupPopupSummary,
  buildCleanupPopupContent,
  buildCleanupPopupRows,
  getCurrentPendingRedactions,
  sortCleanupTargets,
} from './tracker-cleanup-ui.js';

interface TextCompletionStoryStringFormatter {
  renderStoryString: (
    params: Record<string, unknown>,
    options?: {
      customStoryString?: string | null;
      customInstructSettings?: Record<string, unknown> | null;
      customContextSettings?: Record<string, unknown> | null;
    },
  ) => string;
  formatInstructModeStoryString: (
    storyString: string,
    options?: {
      customContext?: Record<string, unknown> | null;
      customInstruct?: Record<string, unknown> | null;
    },
  ) => string;
  getInstructStoppingSequences: (
    options?: {
      customInstruct?: Record<string, unknown> | null;
      useStopStrings?: boolean;
    },
  ) => string[];
}

let textCompletionStoryStringFormatterPromise: Promise<TextCompletionStoryStringFormatter | undefined> | undefined;

// Mirrors the host's story-string helpers at runtime without bundling SillyTavern's internal modules.
async function loadTextCompletionStoryStringFormatter(): Promise<TextCompletionStoryStringFormatter | undefined> {
  if (textCompletionStoryStringFormatterPromise) {
    return textCompletionStoryStringFormatterPromise;
  }

  if (typeof window === 'undefined') {
    return undefined;
  }

  textCompletionStoryStringFormatterPromise = Promise.all([
    // @ts-expect-error SillyTavern serves this browser-only module at runtime.
    import(/* webpackIgnore: true */ '/scripts/power-user.js'),
    // @ts-expect-error SillyTavern serves this browser-only module at runtime.
    import(/* webpackIgnore: true */ '/scripts/instruct-mode.js'),
  ])
    .then(([powerUserModule, instructModeModule]) => {
      if (
        typeof powerUserModule.renderStoryString !== 'function' ||
        typeof instructModeModule.formatInstructModeStoryString !== 'function' ||
        typeof instructModeModule.getInstructStoppingSequences !== 'function'
      ) {
        return undefined;
      }

      return {
        renderStoryString: powerUserModule.renderStoryString,
        formatInstructModeStoryString: instructModeModule.formatInstructModeStoryString,
        getInstructStoppingSequences: instructModeModule.getInstructStoppingSequences,
      } satisfies TextCompletionStoryStringFormatter;
    })
    .catch((error) => {
      console.warn('zTracker: failed to load SillyTavern story-string helpers; falling back to direct prompt assembly.', error);
      return undefined;
    });

  return textCompletionStoryStringFormatterPromise;
}

function trimTextCompletionResponse(
  response: ExtractedData | undefined,
  stoppingStrings: string[] | undefined,
  instructSettings?: Record<string, unknown>,
): ExtractedData | undefined {
  if (!response || typeof response.content !== 'string') {
    return response;
  }

  let message = response.content.replace(/[^\S\r\n]+$/gm, '');

  for (const stoppingString of stoppingStrings ?? []) {
    if (!stoppingString.length) {
      continue;
    }

    for (let length = stoppingString.length; length > 0; length -= 1) {
      if (message.slice(-length) === stoppingString.slice(0, length)) {
        message = message.slice(0, -length);
        break;
      }
    }
  }

  for (const sequence of [instructSettings?.stop_sequence, instructSettings?.input_sequence]) {
    if (typeof sequence !== 'string' || !sequence.trim()) {
      continue;
    }

    const index = message.indexOf(sequence);
    if (index !== -1) {
      message = message.substring(0, index);
    }
  }

  for (const sequences of [instructSettings?.output_sequence, instructSettings?.last_output_sequence]) {
    if (typeof sequences !== 'string' || !sequences.length) {
      continue;
    }

    sequences
      .split('\n')
      .filter((line) => line.trim() !== '')
      .forEach((line) => {
        message = message.replaceAll(line, '');
      });
  }

  return {
    ...response,
    content: message,
  };
}

async function buildStoryStringWrappedTextCompletionPrompt(options: {
  requestMessages: Message[];
  bodyRequestMessages?: Message[];
  context: {
    powerUserSettings?: {
      instruct?: Record<string, unknown>;
      context?: Record<string, unknown>;
    };
  };
  textCompletionService: {
    constructPrompt?: (
      prompt: Message[],
      instructPreset?: string | Record<string, unknown>,
      instructSettings?: Record<string, unknown>,
    ) => string;
  };
  formatterLoader?: () => Promise<TextCompletionStoryStringFormatter | undefined>;
}): Promise<{ prompt: string; stoppingStrings: string[]; instructSettings: Record<string, unknown> } | undefined> {
  const activeInstructSettings = options.context.powerUserSettings?.instruct;
  const activeContextSettings = options.context.powerUserSettings?.context;
  if (!activeInstructSettings || !activeContextSettings || typeof options.textCompletionService.constructPrompt !== 'function') {
    return undefined;
  }

  const formatter = await (options.formatterLoader ?? loadTextCompletionStoryStringFormatter)();
  if (!formatter) {
    return undefined;
  }

  const { systemPrompt, remainingMessages } = extractLeadingSystemPrompt(options.requestMessages);
  if (!systemPrompt) {
    return undefined;
  }

  const promptParts: string[] = [];
  const storyString = formatter.renderStoryString(
    { system: systemPrompt },
    {
      customInstructSettings: activeInstructSettings,
      customContextSettings: activeContextSettings,
    },
  );
  const wrappedStoryString = formatter.formatInstructModeStoryString(storyString, {
    customContext: activeContextSettings,
    customInstruct: activeInstructSettings,
  });
  if (wrappedStoryString.length > 0) {
    promptParts.push(wrappedStoryString);
  }

  const bodyMessages = options.bodyRequestMessages
    ? extractLeadingSystemPrompt(options.bodyRequestMessages).remainingMessages
    : remainingMessages;
  if (bodyMessages.length > 0) {
    const promptBody = options.textCompletionService.constructPrompt(bodyMessages, activeInstructSettings, {});
    if (promptBody.length > 0) {
      promptParts.push(promptBody);
    }
  }

  return {
    prompt: promptParts.join('\n'),
    stoppingStrings: formatter.getInstructStoppingSequences({
      customInstruct: activeInstructSettings,
      useStopStrings: false,
    }),
    instructSettings: activeInstructSettings,
  };
}

export function createTrackerActions(options: {
  globalContext: any;
  settingsManager: ExtensionSettingsManager<ExtensionSettings>;
  generator: Generator;
  pendingRequests: Map<number, string>;
  renderTrackerWithDeps: (messageId: number) => void;
  importMetaUrl: string;
  beforeRequestStartHook?: () => void;
  textCompletionStoryStringFormatterLoader?: () => Promise<TextCompletionStoryStringFormatter | undefined>;
}) {
  const { globalContext, settingsManager, generator, pendingRequests, renderTrackerWithDeps, importMetaUrl } = options;
  const pendingSequences = new Map<number, { cancelled: boolean }>();
  const localPendingRequestAborters = new Map<string, AbortController>();
  let nextLocalRequestId = 0;
  let beforeRequestStartHook = options.beforeRequestStartHook;
  const textCompletionStoryStringFormatterLoader = options.textCompletionStoryStringFormatterLoader;
  const { logPromptEngineeredRenderRollback, requestPromptEngineeredResponse } = createPromptEngineeringHelpers();
  const contextMenuIndicatorText = 'Updating tracker from menu';
  const fullTrackerIndicatorText = 'Updating tracker';

  type GenerateTrackerOptions = {
    silent?: boolean;
    showStatusIndicator?: boolean;
  };

  type PersistTrackerUpdateOptions = {
    messageId: number;
    message: unknown;
    schemaPresetKey: string;
    trackerData: unknown;
    trackerHtml: string;
    partsOrder: string[];
    partsMeta: unknown;
    detailsState: boolean[];
    successMessage?: string;
    extensionData?: Record<string, unknown>;
  };

  function resolveSchemaPreset(settings: ExtensionSettings, requestedKey?: string) {
    const presetKeys = Object.keys(settings.schemaPresets ?? {});
    if (presetKeys.length === 0) {
      throw new Error('No schema presets are configured.');
    }

    const fallbackKey = settings.schemaPresets[settings.schemaPreset] ? settings.schemaPreset : presetKeys[0];
    const schemaPresetKey = requestedKey && settings.schemaPresets[requestedKey] ? requestedKey : fallbackKey;
    return {
      schemaPresetKey,
      schemaPreset: settings.schemaPresets[schemaPresetKey],
    };
  }

  function getMessageSchemaPresetKey(message: any): string | undefined {
    const messageSchemaPresetKey = message?.extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_PRESET_KEY];
    if (typeof messageSchemaPresetKey === 'string' && messageSchemaPresetKey.trim().length > 0) {
      return messageSchemaPresetKey;
    }

    return getPendingRedactionSchemaPresetKey(message?.extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_PENDING_REDACTIONS_KEY]);
  }

  function buildPendingRedactionExtensionData(
    message: any,
    options: {
      clearAll?: boolean;
      nextPending?: unknown;
      resolvedTargets?: TrackerCleanupTarget[];
    } = {},
  ): Record<string, unknown> {
    const hasExplicitNextPending = Object.prototype.hasOwnProperty.call(options, 'nextPending');
    let pendingRedactions = hasExplicitNextPending
      ? options.nextPending
      : message?.extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_PENDING_REDACTIONS_KEY];

    if (options.clearAll) {
      pendingRedactions = undefined;
    } else if (!hasExplicitNextPending && options.resolvedTargets) {
      pendingRedactions = removePendingRedactionTargets(pendingRedactions, options.resolvedTargets);
    }

    return {
      [CHAT_MESSAGE_PENDING_REDACTIONS_KEY]: pendingRedactions,
    };
  }

  function getSchemaRenderMetadata(chatJsonValue: any) {
    return {
      partsOrder: resolveTopLevelPartsOrder(chatJsonValue),
      partsMeta: buildPartsMeta(chatJsonValue),
    };
  }

  async function prepareExistingTrackerGeneration(messageId: number) {
    const { schemaPresetKey: messageSchemaPresetKey, currentTracker } = getTrackerSchemaAndRenderState(messageId);
    const prepared = await prepareTrackerGeneration(messageId, { schemaPresetKey: messageSchemaPresetKey });

    return {
      ...prepared,
      currentTracker,
      ...getSchemaRenderMetadata(prepared.chatJsonValue),
      makeRequest: makeRequestFactory(messageId, prepared.settings, { instructName: prepared.transportInstructName }),
    };
  }

  type ArrayItemLocator =
    | { kind: 'index'; index: number }
    | { kind: 'name'; name: string }
    | { kind: 'identity'; idKey: string; idValue: string };

  function getTrackerArrayValue(currentTracker: any, partKey: string): any[] {
    const currentArr = currentTracker?.[partKey];
    if (!Array.isArray(currentArr)) {
      throw new Error(`Tracker field is not an array: ${partKey}`);
    }

    return currentArr;
  }

  function resolveArrayItemIndex(currentArr: any[], partKey: string, locator: ArrayItemLocator): number {
    if (locator.kind === 'index') {
      if (locator.index < 0 || locator.index >= currentArr.length) {
        throw new Error(`Array index out of range for ${partKey}: ${locator.index}`);
      }
      return locator.index;
    }

    if (locator.kind === 'name') {
      const index = findArrayItemIndexByName(currentArr, locator.name);
      if (index === -1) {
        throw new Error(`No array item found by name in ${partKey}: ${locator.name}`);
      }
      return index;
    }

    const index = findArrayItemIndexByIdentity(currentArr, locator.idKey, locator.idValue);
    if (index === -1) {
      throw new Error(`No array item found by ${locator.idKey} in ${partKey}: ${locator.idValue}`);
    }
    return index;
  }

  function resolveArrayItemRegeneration(
    chatJsonValue: any,
    partKey: string,
    currentArr: any[],
    locator: ArrayItemLocator,
  ): {
    index: number;
    promptContext: Record<string, unknown>;
    promptContextLabel: string;
    prompt: string;
    promptEngineeringInstruction?: string;
    successMessage: string;
    resolvedTarget: TrackerCleanupTarget;
    finalizeItem: (item: unknown) => unknown;
  } {
    const index = resolveArrayItemIndex(currentArr, partKey, locator);
    const currentItem = currentArr[index];

    if (locator.kind === 'name') {
      const preserveName = currentItem && typeof currentItem === 'object' && typeof (currentItem as any).name === 'string';
      const preserveLine = preserveName ? `\n\nIMPORTANT: Preserve the item name exactly as "${locator.name}".` : '';
      return {
        index,
        promptContext: { part: partKey, matchBy: 'name', name: locator.name, index },
        promptContextLabel: 'Regenerate ONLY this array item (matched by name; previous values intentionally omitted):',
        prompt:
          `${settingsManager.getSettings().prompt}\n\nRegenerate ONLY the ${partKey} item with name "${locator.name}" as an object under key "item". Return a single JSON object matching the provided schema.${preserveLine}\n\nIMPORTANT: Generate a fresh item; the previous values have been intentionally omitted and must not be repeated.`,
        promptEngineeringInstruction: preserveLine,
        successMessage: `Updated: ${partKey} (${locator.name})`,
        resolvedTarget: buildArrayItemCleanupTarget(partKey, index, { idKey: 'name', idValue: locator.name }),
        finalizeItem: (item) => {
          if (preserveName && item && typeof item === 'object') {
            (item as any).name = locator.name;
          }
          return item;
        },
      };
    }

    if (locator.kind === 'identity') {
      const preserveIdentity = currentItem && typeof currentItem === 'object' && typeof (currentItem as any)[locator.idKey] === 'string';
      const preserveLine = preserveIdentity
        ? `\n\nIMPORTANT: Preserve the identity field ${locator.idKey} exactly as "${locator.idValue}".`
        : '';
      return {
        index,
        promptContext: { part: partKey, matchBy: locator.idKey, idValue: locator.idValue, index },
        promptContextLabel: 'Regenerate ONLY this array item (matched by identity; previous values intentionally omitted):',
        prompt:
          `${settingsManager.getSettings().prompt}\n\nRegenerate ONLY the ${partKey} item with ${locator.idKey} "${locator.idValue}" as an object under key "item". Return a single JSON object matching the provided schema.${preserveLine}\n\nIMPORTANT: Generate a fresh item; the previous values have been intentionally omitted and must not be repeated.`,
        promptEngineeringInstruction: preserveLine,
        successMessage: `Updated: ${partKey} (${locator.idKey}=${locator.idValue})`,
        resolvedTarget: buildArrayItemCleanupTarget(partKey, index, { idKey: locator.idKey, idValue: locator.idValue }),
        finalizeItem: (item) => {
          if (preserveIdentity && item && typeof item === 'object') {
            (item as any)[locator.idKey] = locator.idValue;
          }
          return item;
        },
      };
    }

    const idKey = getArrayItemIdentityKey(chatJsonValue, partKey);
    const idValue =
      currentItem && typeof currentItem === 'object' && typeof (currentItem as any)[idKey] === 'string'
        ? String((currentItem as any)[idKey])
        : '';
    return {
      index,
      promptContext: { part: partKey, index, ...(idKey && idValue ? { idKey, idValue } : {}) },
      promptContextLabel: 'Regenerate ONLY this array item (previous item intentionally omitted):',
      prompt:
        `${settingsManager.getSettings().prompt}\n\nRegenerate ONLY ${partKey}[${index}] as an object under key "item". Return a single JSON object matching the provided schema. IMPORTANT: Generate a fresh item; the previous values have been intentionally omitted and must not be repeated.`,
      successMessage: `Updated: ${partKey}[${index}]`,
      resolvedTarget: buildArrayItemCleanupTarget(partKey, index, idKey && idValue ? { idKey, idValue } : undefined),
      finalizeItem: (item) => item,
    };
  }

  function resolveArrayItemFieldRegeneration(
    chatJsonValue: any,
    partKey: string,
    fieldKey: string,
    currentArr: any[],
    locator: ArrayItemLocator,
  ): {
    index: number;
    promptContext: Record<string, unknown>;
    prompt: string;
    successMessage: string;
    resolvedTarget: TrackerCleanupTarget;
  } {
    const index = resolveArrayItemIndex(currentArr, partKey, locator);
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

    return {
      index,
      promptContext: {
        part: partKey,
        index,
        ...(idKey && idValue ? { idKey, idValue } : {}),
        field: fieldKey,
        itemContext,
      },
      prompt:
        `${settingsManager.getSettings().prompt}\n\nRegenerate ONLY ${partKey}[${index}].${fieldKey}. Return a single JSON object with key "value" that matches the provided schema. Do not change or rename the array item; only update that field. IMPORTANT: Generate a fresh value; the previous value has been intentionally omitted and must not be repeated.`,
      successMessage: `Updated: ${partKey}[${index}].${fieldKey}`,
      resolvedTarget: buildArrayItemFieldCleanupTarget(
        partKey,
        index,
        fieldKey,
        idKey && idValue ? { idKey, idValue } : undefined,
      ),
    };
  }

  async function requestStructuredTrackerContent(options: {
    messages: Message[];
    settings: ExtensionSettings;
    schema: any;
    schemaName: string;
    prompt: string;
    makeRequest: ReturnType<typeof makeRequestFactory>;
    promptEngineeringInstruction?: string;
  }) {
    if (options.settings.promptEngineeringMode === PromptEngineeringMode.NATIVE) {
      insertTrackerInstructionMessage(options.messages, options.prompt);
      const result = await options.makeRequest(options.messages, {
        json_schema: { name: options.schemaName, strict: true, value: options.schema },
      });
      return result?.content;
    }

    return requestPromptEngineeredResponse(
      options.makeRequest,
      options.messages,
      options.settings,
      options.schema,
      options.promptEngineeringInstruction,
    );
  }

  const persistResolvedTrackerUpdate = async (
    options: Omit<PersistTrackerUpdateOptions, 'extensionData'> & { resolvedTargets: TrackerCleanupTarget[] },
  ) => {
    await persistTrackerUpdate({
      ...options,
      extensionData: buildPendingRedactionExtensionData(options.message, {
        resolvedTargets: options.resolvedTargets,
      }),
    });
  };

  /** Shows the full-tracker badge only when the caller explicitly opts into that manual UI. */
  const runWithFullTrackerStatusIndicator = <T>(
    messageId: number,
    options: GenerateTrackerOptions | undefined,
    callback: () => Promise<T>,
  ) => {
    const shouldShowStatusIndicator = options?.showStatusIndicator ?? false;
    if (!shouldShowStatusIndicator) {
      return callback();
    }

    return withMessageStatusIndicator(
      { messageId, text: fullTrackerIndicatorText, statusClassName: FULL_TRACKER_STATUS_CLASS },
      callback,
    );
  };

  /** Persists a generated tracker update and restores the rendered tracker state if the save can complete. */
  const persistTrackerUpdate = async (options: PersistTrackerUpdateOptions) => {
    try {
      applyTrackerUpdateAndRender(options.message as any, {
        trackerData: options.trackerData,
        trackerHtml: options.trackerHtml,
        extensionData: {
          [CHAT_MESSAGE_SCHEMA_PRESET_KEY]: options.schemaPresetKey,
          [CHAT_MESSAGE_PARTS_ORDER_KEY]: options.partsOrder,
          partsMeta: options.partsMeta,
          ...(options.extensionData ?? {}),
        },
        render: () => renderTrackerWithDeps(options.messageId),
      });
      restoreDetailsState(options.messageId, options.detailsState);
      await globalContext.saveChat();
      if (options.successMessage) {
        st_echo('success', options.successMessage);
      }
    } catch {
      logPromptEngineeredRenderRollback(
        options.trackerData,
        new Error('Generated data failed to render with the current template. Not saved.'),
      );
      renderTrackerWithDeps(options.messageId);
      throw new Error('Generated data failed to render with the current template. Not saved.');
    }
  };

  /** Runs one context-menu regeneration action with the shared badge, spinner, and error handling. */
  const runContextMenuTrackerUpdate = async (
    options: {
      messageId: number;
      button: Element | null | undefined;
      errorContext: string;
      callback: () => Promise<void>;
    },
  ): Promise<boolean> => {
    try {
      options.button?.classList.add('spinning');
      await withMessageStatusIndicator(
        { messageId: options.messageId, text: contextMenuIndicatorText, statusClassName: CONTEXT_MENU_STATUS_CLASS },
        options.callback,
      );
      return true;
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error(`Error ${options.errorContext}:`, error);
        st_echo('error', `Tracker generation failed: ${(error as Error).message}`);
      }
      return false;
    } finally {
      options.button?.classList.remove('spinning');
    }
  };

  function getTrackerSchemaAndRenderState(messageId: number) {
    const message = globalContext.chat[messageId];
    if (!message?.extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY]) {
      throw new Error('No existing tracker found for this message. Generate a full tracker first.');
    }

    const settings = settingsManager.getSettings();
    const { schemaPresetKey, schemaPreset } = resolveSchemaPreset(settings, getMessageSchemaPresetKey(message));
    const currentTracker = message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_VALUE_KEY];
    const chatJsonValue = schemaPreset.value;
    const trackerHtml = message.extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_HTML_KEY] ?? schemaPreset.html;
    const partsOrder =
      message.extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_PARTS_ORDER_KEY] ?? resolveTopLevelPartsOrder(chatJsonValue);
    const partsMeta = buildPartsMeta(chatJsonValue);
    const pendingTargets = getCurrentPendingRedactions(message);

    return {
      message,
      schemaPresetKey,
      currentTracker,
      chatJsonValue,
      trackerHtml,
      partsOrder,
      partsMeta,
      pendingTargets,
    };
  }

  function createLocalRequestId(messageId: number): string {
    nextLocalRequestId += 1;
    return `ztracker-local-${messageId}-${nextLocalRequestId}`;
  }

  // Keep tracker instructions as trailing system messages so they stay non-dialogue and remain at the end of the prompt.
  function insertTrackerInstructionMessage(messages: Message[], content: string): void {
    messages.push({ role: 'system', content } as Message);
  }

  /**
   * Sends text-completion tracker requests with a request-local instruct preset.
   * This currently depends on SillyTavern's internal TextCompletionService because
   * the public request service does not expose an instruct-name override yet.
   * Keep this path isolated so it can move back to the stable request service once
   * upstream surfaces that override.
   */
  async function sendTextCompletionTrackerRequest(options: {
    messageId: number;
    profile: any;
    selectedApiType: string | undefined;
    requestMessages: Message[];
    wrappedRequestMessages?: Message[];
    instructName?: string;
    overridePayload?: Record<string, any>;
    maxTokens: number;
  }): Promise<ExtractedData | undefined> {
    const context = SillyTavern.getContext() as {
      TextCompletionService?: {
        constructPrompt?: (
          prompt: Message[],
          instructPreset?: string | Record<string, unknown>,
          instructSettings?: Record<string, unknown>,
        ) => string;
        createRequestData?: (requestData: Record<string, any>) => Record<string, any>;
        processRequest?: (
          requestData: Record<string, any>,
          requestOptions: { presetName?: string; instructName?: string; instructSettings?: Record<string, any> },
          extractData?: boolean,
          signal?: AbortSignal,
        ) => Promise<ExtractedData | undefined>;
        sendRequest?: (
          requestData: Record<string, any>,
          extractData?: boolean,
          signal?: AbortSignal,
        ) => Promise<ExtractedData | undefined>;
      };
      powerUserSettings?: {
        instruct?: Record<string, unknown>;
        context?: Record<string, unknown>;
      };
    };
    const textCompletionService = context?.TextCompletionService;
    if (typeof textCompletionService?.processRequest !== 'function') {
      throw new Error('SillyTavern text-completion request API is unavailable.');
    }

    const abortController = new AbortController();
    const requestId = createLocalRequestId(options.messageId);
    pendingRequests.set(options.messageId, requestId);
    localPendingRequestAborters.set(requestId, abortController);

    try {
      const wrappedPrompt = await buildStoryStringWrappedTextCompletionPrompt({
        requestMessages: options.requestMessages,
        bodyRequestMessages: options.wrappedRequestMessages,
        context,
        textCompletionService,
        formatterLoader: textCompletionStoryStringFormatterLoader,
      });
      if (
        wrappedPrompt &&
        typeof textCompletionService.createRequestData === 'function' &&
        typeof textCompletionService.sendRequest === 'function'
      ) {
        beforeRequestStartHook?.();

        const requestData = textCompletionService.createRequestData.call(textCompletionService, {
          stream: false,
          prompt: wrappedPrompt.prompt,
          max_tokens: options.maxTokens,
          model: options.profile?.model,
          api_type: options.selectedApiType ?? options.profile?.api,
          api_server: options.profile?.['api-url'],
          ...(wrappedPrompt.stoppingStrings.length > 0
            ? {
                stop: wrappedPrompt.stoppingStrings,
                stopping_strings: wrappedPrompt.stoppingStrings,
              }
            : {}),
          ...(options.overridePayload ?? {}),
        });

        const response = await textCompletionService.sendRequest.call(
          textCompletionService,
          requestData,
          true,
          abortController.signal,
        );

        return trimTextCompletionResponse(
          response,
          requestData.stopping_strings,
          wrappedPrompt.instructSettings,
        );
      }

      beforeRequestStartHook?.();
      const requestOptions = {
        instructSettings: {},
        ...(options.instructName ? { instructName: options.instructName } : {}),
      };

      return await textCompletionService.processRequest.call(
        textCompletionService,
        {
          stream: false,
          prompt: options.requestMessages,
          max_tokens: options.maxTokens,
          model: options.profile?.model,
          api_type: options.selectedApiType ?? options.profile?.api,
          api_server: options.profile?.['api-url'],
          ...(options.overridePayload ?? {}),
        },
        requestOptions,
        true,
        abortController.signal,
      );
    } finally {
      localPendingRequestAborters.delete(requestId);
      pendingRequests.delete(options.messageId);
    }
  }

  function cancelIfPending(messageId: number): boolean {
    const token = pendingSequences.get(messageId);
    let cancelled = false;

    if (token) {
      token.cancelled = true;
      cancelled = true;
    }

    if (pendingRequests.has(messageId)) {
      const requestId = pendingRequests.get(messageId)!;
      const localAbortController = localPendingRequestAborters.get(requestId);
      if (localAbortController) {
        localAbortController.abort();
      } else {
        generator.abortRequest(requestId);
      }
      cancelled = true;
    }

    if (!cancelled) {
      return false;
    }

    st_echo('info', 'Tracker generation cancelled.');
    return true;
  }

  /** Cancels the currently pending tracker run for a message, if one exists. */
  function cancelTracker(messageId: number): boolean {
    return cancelIfPending(messageId);
  }

  function makeRequestFactory(messageId: number, settings: ExtensionSettings, options: { instructName?: string } = {}) {
    return (requestMessages: Message[], overideParams?: any): Promise<ExtractedData | undefined> => {
      return new Promise((resolve, reject) => {
        const abortController = new AbortController();
        const profile = globalContext.extensionSettings?.connectionManager?.profiles?.find((p: any) => p.id === settings.profileId);
        const selectedApiMap = profile?.api ? globalContext.CONNECT_API_MAP?.[profile.api] : undefined;
        const selectedApi = selectedApiMap?.selected;
        const context = SillyTavern.getContext() as {
        name1?: string;
        powerUserSettings?: {
          preset?: string;
          instruct?: {
            user_alignment_message?: string;
          };
        };
        };
        const textCompletionPromptBody = selectedApi === 'textgenerationwebui'
          ? sanitizeMessagesForGeneration(requestMessages, {
              userAlignmentMessage: context?.powerUserSettings?.instruct?.user_alignment_message,
              userName: context?.name1,
            })
          : undefined;
        const sanitizedPrompt = sanitizeMessagesForGeneration(requestMessages, {
          inlineNamesIntoContent: selectedApi === 'textgenerationwebui',
          userAlignmentMessage:
            selectedApi === 'textgenerationwebui'
              ? context?.powerUserSettings?.instruct?.user_alignment_message
              : undefined,
          userName: selectedApi === 'textgenerationwebui' ? context?.name1 : undefined,
        });
        captureTrackerRequestDebugSnapshot(settingsManager, {
          messageId,
          profileId: settings.profileId,
          promptEngineeringMode: settings.promptEngineeringMode,
          maxTokens: settings.maxResponseToken,
          overridePayload: overideParams ?? {},
          requestMessages: requestMessages as any,
          sanitizedPrompt,
        });
        try {
          if (selectedApi === 'textgenerationwebui') {
            void sendTextCompletionTrackerRequest({
              messageId,
              profile,
              selectedApiType: selectedApiMap?.type,
              requestMessages: sanitizedPrompt,
              wrappedRequestMessages: textCompletionPromptBody,
              instructName: options.instructName,
              overridePayload: overideParams ?? {},
              maxTokens: settings.maxResponseToken,
            }).then(resolve, reject);
            return;
          }

          beforeRequestStartHook?.();
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
        } catch (error) {
          reject(error);
        }
      });
    };
  }

  async function prepareTrackerGeneration(messageId: number, options?: { schemaPresetKey?: string }) {
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

    const { schemaPresetKey, schemaPreset } = resolveSchemaPreset(settings, options?.schemaPresetKey ?? settings.schemaPreset);
    const chatJsonValue = schemaPreset.value;
    const chatHtmlValue = schemaPreset.html;

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
    const skipCharacterCardInTrackerGeneration = settings.skipCharacterCardInTrackerGeneration ?? false;

    const syspromptName = resolveTrackerSystemPromptName(settings, context, profile);
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

    const trackerInstructName = settings.trackerSystemPromptMode === 'selected' ? profile.instruct : undefined;
    const trackerContextName = settings.trackerSystemPromptMode === 'selected' ? profile.context : undefined;
    const trackerPresetName = settings.trackerSystemPromptMode === 'selected' ? profile.preset : undefined;

    const promptPresetSelections = getPromptPresetSelections(apiMap.selected, {
      context,
      trackerSystemPromptMode: settings.trackerSystemPromptMode,
      trackerSystemPromptName: syspromptName,
      trackerInstructName,
      trackerContextName,
      trackerPresetName,
    });
    const includePromptNames = apiMap.selected !== 'textgenerationwebui';

    let promptResult;
    promptResult = await buildPrompt(apiMap.selected, {
      targetCharacterId: characterId,
      messageIndexesBetween: {
        end: messageId,
        start: settings.includeLastXMessages > 0 ? Math.max(0, messageId - settings.includeLastXMessages) : 0,
      },
      ...promptPresetSelections,
      includeNames: includePromptNames,
      ignoreWorldInfo,
      ...(skipCharacterCardInTrackerGeneration ? { ignoreCharacterFields: true } : {}),
    });

    let messages = includeZTrackerMessages(promptResult.result, settings);
    messages = normalizeTrackerGenerationConversationRoles(messages, settings);
    debugLog(settingsManager, 'prompt built', {
      trackerGenerationConversationRoleMode: settings.trackerGenerationConversationRoleMode ?? 'preserve',
      skipCharacterCardInTrackerGeneration,
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

    // Text-completion prompt assembly can consume saved sysprompt presets directly.
    // Chat-completion paths still need the tracker prompt injected as a standalone system message.
    if (savedSystemPromptContent && apiMap.selected !== 'textgenerationwebui') {
      messages = insertSystemPromptMessage(messages, savedSystemPromptContent);
    }

    const existingTracker = message?.extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY];

    return {
      message,
      settings,
      schemaPresetKey,
      chatJsonValue,
      chatHtmlValue,
      messages,
      transportInstructName: promptPresetSelections.instructName,
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

  async function generateTrackerFull(id: number, options?: GenerateTrackerOptions) {
    if (cancelIfPending(id)) return false;

    debugLog(settingsManager, 'generateTracker start', {
      mesId: id,
      mode: settingsManager.getSettings().promptEngineeringMode,
    });

    const messageBlock = document.querySelector(`.mes[mesid="${id}"]`);
    const mainButton = messageBlock?.querySelector('.mes_ztracker_button');
    const regenerateButton = messageBlock?.querySelector('.ztracker-regenerate-button');
    const detailsState = captureDetailsState(id);
    const token = { cancelled: false };

    pendingSequences.set(id, token);

    try {
      mainButton?.classList.add('spinning');
      regenerateButton?.classList.add('spinning');

      return await runWithFullTrackerStatusIndicator(id, options, async () => {
        const { message, settings, schemaPresetKey, chatJsonValue, chatHtmlValue, messages, transportInstructName } = await prepareTrackerGeneration(id);
        if (token.cancelled) {
          return false;
        }

        const { partsOrder, partsMeta } = getSchemaRenderMetadata(chatJsonValue);
        const makeRequest = makeRequestFactory(id, settings, { instructName: transportInstructName });
        const response = (await requestStructuredTrackerContent({
          messages,
          settings,
          schema: chatJsonValue,
          schemaName: 'SceneTracker',
          prompt: settings.prompt,
          makeRequest,
        })) as ExtractedData['content'];

        if (token.cancelled) {
          return false;
        }

        if (!response || Object.keys(response as any).length === 0) throw new Error('Empty response from zTracker.');

        await persistTrackerUpdate({
          messageId: id,
          message,
          schemaPresetKey,
          trackerData: response,
          trackerHtml: chatHtmlValue,
          partsOrder,
          partsMeta,
          detailsState,
          extensionData: buildPendingRedactionExtensionData(message, { clearAll: true }),
        });
        return true;
      });
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error generating tracker:', error);
        st_echo('error', `Tracker generation failed: ${(error as Error).message}`);
      }
      return false;
    } finally {
      pendingSequences.delete(id);
      mainButton?.classList.remove('spinning');
      regenerateButton?.classList.remove('spinning');
    }
  }

  async function generateTrackerSequential(id: number, options?: GenerateTrackerOptions) {
    if (cancelIfPending(id)) return false;
    const messageBlock = document.querySelector(`.mes[mesid="${id}"]`);
    const mainButton = messageBlock?.querySelector('.mes_ztracker_button');
    const regenerateButton = messageBlock?.querySelector('.ztracker-regenerate-button');
    const detailsState = captureDetailsState(id);

    const token = { cancelled: false };
    pendingSequences.set(id, token);

    try {
      mainButton?.classList.add('spinning');
      regenerateButton?.classList.add('spinning');

      return await runWithFullTrackerStatusIndicator(id, options, async () => {
        const { message, settings, schemaPresetKey, chatJsonValue, chatHtmlValue, messages, transportInstructName } = await prepareTrackerGeneration(id);
        if (token.cancelled) {
          return false;
        }

        const { partsOrder, partsMeta } = getSchemaRenderMetadata(chatJsonValue);
        if (partsOrder.length === 0) {
          throw new Error('Schema has no top-level properties to generate.');
        }

        const makeRequest = makeRequestFactory(id, settings, { instructName: transportInstructName });
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

          const partResponse = await requestStructuredTrackerContent({
            messages: requestMessages,
            settings,
            schema: partSchema,
            schemaName: 'SceneTrackerPart',
            prompt: `${settings.prompt}\n\nGenerate ONLY the field "${partKey}". Return a single JSON object matching the provided schema.`,
            makeRequest,
          });

          if (!partResponse || Object.keys(partResponse as any).length === 0) {
            throw new Error(`Empty response while generating part: ${partKey}`);
          }

          trackerData = mergeTrackerPart(trackerData, partKey, partResponse);
        }

        if (token.cancelled) {
          return false;
        }

        if (!trackerData || Object.keys(trackerData).length === 0) {
          throw new Error('Empty response from zTracker.');
        }

        await persistTrackerUpdate({
          messageId: id,
          message,
          schemaPresetKey,
          trackerData,
          trackerHtml: chatHtmlValue,
          partsOrder,
          partsMeta,
          detailsState,
          extensionData: buildPendingRedactionExtensionData(message, { clearAll: true }),
        });
        return true;
      });
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error generating tracker (sequential):', error);
        st_echo('error', `Tracker generation failed: ${(error as Error).message}`);
      }
      return false;
    } finally {
      pendingSequences.delete(id);
      mainButton?.classList.remove('spinning');
      regenerateButton?.classList.remove('spinning');
    }
  }

  async function generateTrackerPart(id: number, partKey: string) {
    if (cancelIfPending(id)) return false;

    const messageBlock = document.querySelector(`.mes[mesid="${id}"]`);
    const partButton = messageBlock?.querySelector(
      `.ztracker-part-regenerate-button[data-ztracker-part="${CSS.escape(partKey)}"]`,
    );

    const detailsState = captureDetailsState(id);

    return runContextMenuTrackerUpdate({
      messageId: id,
      button: partButton,
      errorContext: 'generating tracker part',
      callback: async () => {
          const { message, settings, schemaPresetKey, currentTracker, chatJsonValue, chatHtmlValue, messages, partsOrder, partsMeta, makeRequest } =
            await prepareExistingTrackerGeneration(id);
          if (!currentTracker || typeof currentTracker !== 'object') {
            throw new Error('No existing tracker found for this message. Generate a full tracker first.');
          }

          const partSchema = buildTopLevelPartSchema(chatJsonValue, partKey);

          const redactedTracker = redactTrackerPartValue(currentTracker, partKey);
          appendCurrentTrackerSnapshot(
            messages as any,
            redactedTracker,
            'Current tracker for this message (target part omitted for freshness; keep everything else consistent):',
          );

          const partResponse = await requestStructuredTrackerContent({
            messages,
            settings,
            schema: partSchema,
            schemaName: 'SceneTrackerPart',
            prompt: `${settings.prompt}\n\nGenerate ONLY the field "${partKey}". Return a single JSON object matching the provided schema.`,
            makeRequest,
          });

          if (!partResponse || Object.keys(partResponse as any).length === 0) {
            throw new Error(`Empty response while generating part: ${partKey}`);
          }

          const nextTracker = mergeTrackerPart(currentTracker, partKey, partResponse);
          await persistResolvedTrackerUpdate({
            messageId: id,
            message,
            schemaPresetKey,
            trackerData: nextTracker,
            trackerHtml: chatHtmlValue,
            partsOrder,
            partsMeta,
            detailsState,
            successMessage: `Updated: ${partKey}`,
            resolvedTargets: [{ kind: 'part', partKey }],
          });
        },
    });
  }

  async function generateTrackerArrayItem(id: number, partKey: string, index: number) {
    const messageBlock = document.querySelector(`.mes[mesid="${id}"]`);
    const itemButton = messageBlock?.querySelector(
      `.ztracker-array-item-regenerate-button[data-ztracker-part="${CSS.escape(partKey)}"][data-ztracker-index="${index}"]`,
    );

    return generateTrackerArrayItemForLocator(id, partKey, { kind: 'index', index }, {
      button: itemButton,
      errorContext: 'generating tracker array item',
    });
  }

  async function generateTrackerArrayItemForLocator(
    id: number,
    partKey: string,
    locator: ArrayItemLocator,
    options: { button: Element | null | undefined; errorContext: string },
  ) {
    if (cancelIfPending(id)) return false;

    const detailsState = captureDetailsState(id);

    return runContextMenuTrackerUpdate({
      messageId: id,
      button: options.button,
      errorContext: options.errorContext,
      callback: async () => {
          const { message, settings, schemaPresetKey, currentTracker, chatJsonValue, chatHtmlValue, messages, partsOrder, partsMeta, makeRequest } =
            await prepareExistingTrackerGeneration(id);
          if (!currentTracker || typeof currentTracker !== 'object') {
            throw new Error('No existing tracker found for this message. Generate a full tracker first.');
          }

          const currentArr = getTrackerArrayValue(currentTracker, partKey);
          const itemRequest = resolveArrayItemRegeneration(chatJsonValue, partKey, currentArr, locator);

          const itemSchema = buildArrayItemSchema(chatJsonValue, partKey);
          const redactedTracker = redactTrackerArrayItemValue(currentTracker, partKey, itemRequest.index);

          appendCurrentTrackerSnapshot(
            messages as any,
            redactedTracker,
            'Current tracker for this message (target item omitted for freshness; keep everything else consistent):',
          );
          appendCurrentTrackerSnapshot(
            messages as any,
            itemRequest.promptContext,
            itemRequest.promptContextLabel,
          );

          const itemResponse = (await requestStructuredTrackerContent({
            messages,
            settings,
            schema: itemSchema,
            schemaName: 'SceneTrackerItem',
            prompt: itemRequest.prompt,
            makeRequest,
            promptEngineeringInstruction: itemRequest.promptEngineeringInstruction,
          })) as Record<string, unknown> | undefined;

          const item = itemRequest.finalizeItem(itemResponse?.item);
          if (item === undefined) {
            throw new Error('Item response missing key: item');
          }

          const nextTracker = replaceTrackerArrayItem(currentTracker, partKey, itemRequest.index, item);
          await persistResolvedTrackerUpdate({
            messageId: id,
            message,
            schemaPresetKey,
            trackerData: nextTracker,
            trackerHtml: chatHtmlValue,
            partsOrder,
            partsMeta,
            detailsState,
            successMessage: itemRequest.successMessage,
            resolvedTargets: [itemRequest.resolvedTarget],
          });
        },
    });
  }

  async function generateTrackerArrayItemByName(id: number, partKey: string, name: string) {
    const messageBlock = document.querySelector(`.mes[mesid="${id}"]`);
    const itemButton = messageBlock?.querySelector(
      `.ztracker-array-item-regenerate-button[data-ztracker-part="${CSS.escape(partKey)}"][data-ztracker-name="${CSS.escape(name)}"]`,
    );

    return generateTrackerArrayItemForLocator(id, partKey, { kind: 'name', name }, {
      button: itemButton,
      errorContext: 'generating tracker array item (by name)',
    });
  }

  async function generateTrackerArrayItemByIdentity(id: number, partKey: string, idKey: string, idValue: string) {
    const messageBlock = document.querySelector(`.mes[mesid="${id}"]`);
    const itemButton = messageBlock?.querySelector(
      `.ztracker-array-item-regenerate-button[data-ztracker-part="${CSS.escape(partKey)}"][data-ztracker-idkey="${CSS.escape(idKey)}"][data-ztracker-idvalue="${CSS.escape(idValue)}"]`,
    );

    return generateTrackerArrayItemForLocator(id, partKey, { kind: 'identity', idKey, idValue }, {
      button: itemButton,
      errorContext: 'generating tracker array item (by identity)',
    });
  }

  async function generateTrackerArrayItemField(id: number, partKey: string, index: number, fieldKey: string) {
    const messageBlock = document.querySelector(`.mes[mesid="${id}"]`);
    const fieldButton = messageBlock?.querySelector(
      `.ztracker-array-item-field-regenerate-button[data-ztracker-part="${CSS.escape(partKey)}"][data-ztracker-index="${index}"][data-ztracker-field="${CSS.escape(fieldKey)}"]`,
    );

    return generateTrackerArrayItemFieldForLocator(id, partKey, fieldKey, { kind: 'index', index }, {
      button: fieldButton,
      errorContext: 'generating tracker array item field',
    });
  }

  async function generateTrackerArrayItemFieldForLocator(
    id: number,
    partKey: string,
    fieldKey: string,
    locator: ArrayItemLocator,
    options: { button: Element | null | undefined; errorContext: string },
  ) {
    if (cancelIfPending(id)) return false;

    const detailsState = captureDetailsState(id);

    return runContextMenuTrackerUpdate({
      messageId: id,
      button: options.button,
      errorContext: options.errorContext,
      callback: async () => {
          const { message, settings, schemaPresetKey, currentTracker, chatJsonValue, chatHtmlValue, messages, partsOrder, partsMeta, makeRequest } =
            await prepareExistingTrackerGeneration(id);
          if (!currentTracker || typeof currentTracker !== 'object') {
            throw new Error('No existing tracker found for this message. Generate a full tracker first.');
          }

          const currentArr = getTrackerArrayValue(currentTracker, partKey);
          const fieldRequest = resolveArrayItemFieldRegeneration(chatJsonValue, partKey, fieldKey, currentArr, locator);
          const redactedTracker = redactTrackerArrayItemFieldValue(currentTracker, partKey, fieldRequest.index, fieldKey);

          const fieldSchema = buildArrayItemFieldSchema(chatJsonValue, partKey, fieldKey);

          appendCurrentTrackerSnapshot(
            messages as any,
            redactedTracker,
            'Current tracker for this message (target field omitted for freshness; keep everything else consistent):',
          );
          appendCurrentTrackerSnapshot(
            messages as any,
            fieldRequest.promptContext,
            'Regenerate ONLY this field within this array item (field value intentionally omitted):',
          );

          const fieldResponse = (await requestStructuredTrackerContent({
            messages,
            settings,
            schema: fieldSchema,
            schemaName: 'SceneTrackerItemField',
            prompt: fieldRequest.prompt,
            makeRequest,
          })) as Record<string, unknown> | undefined;

          const value = fieldResponse?.value;
          if (value === undefined) {
            throw new Error('Field response missing key: value');
          }

          const nextTracker = replaceTrackerArrayItemField(currentTracker, partKey, fieldRequest.index, fieldKey, value);
          await persistResolvedTrackerUpdate({
            messageId: id,
            message,
            schemaPresetKey,
            trackerData: nextTracker,
            trackerHtml: chatHtmlValue,
            partsOrder,
            partsMeta,
            detailsState,
            successMessage: fieldRequest.successMessage,
            resolvedTargets: [fieldRequest.resolvedTarget],
          });
        },
    });
  }

  async function generateTrackerArrayItemFieldByName(id: number, partKey: string, name: string, fieldKey: string) {
    const messageBlock = document.querySelector(`.mes[mesid="${id}"]`);
    const fieldButton = messageBlock?.querySelector(
      `.ztracker-array-item-field-regenerate-button[data-ztracker-part="${CSS.escape(partKey)}"][data-ztracker-name="${CSS.escape(name)}"][data-ztracker-field="${CSS.escape(fieldKey)}"]`,
    );

    return generateTrackerArrayItemFieldForLocator(id, partKey, fieldKey, { kind: 'name', name }, {
      button: fieldButton,
      errorContext: 'generating tracker array item field (by name)',
    });
  }

  async function generateTrackerArrayItemFieldByIdentity(
    id: number,
    partKey: string,
    idKey: string,
    idValue: string,
    fieldKey: string,
  ) {
    const messageBlock = document.querySelector(`.mes[mesid="${id}"]`);
    const fieldButton = messageBlock?.querySelector(
      `.ztracker-array-item-field-regenerate-button[data-ztracker-part="${CSS.escape(partKey)}"][data-ztracker-idkey="${CSS.escape(idKey)}"][data-ztracker-idvalue="${CSS.escape(idValue)}"][data-ztracker-field="${CSS.escape(fieldKey)}"]`,
    );

    return generateTrackerArrayItemFieldForLocator(id, partKey, fieldKey, { kind: 'identity', idKey, idValue }, {
      button: fieldButton,
      errorContext: 'generating tracker array item field (by identity)',
    });
  }

  /** Dispatches full tracker generation while enforcing the shared skip-first-messages guard for manual and auto flows. */
  async function generateTracker(id: number, options?: GenerateTrackerOptions) {
    const settings = settingsManager.getSettings();
    if (shouldSkipTrackerGeneration(id, settings, (message) => st_echo('info', message), options?.silent)) {
      return false;
    }

    if (settings.sequentialPartGeneration) {
      return generateTrackerSequential(id, options);
    }
    return generateTrackerFull(id, options);
  }

  async function clearTrackerTargetsOnly(messageId: number, targets: TrackerCleanupTarget[]): Promise<TrackerCleanupTarget[]> {
    const normalizedTargets = normalizeTrackerCleanupTargets(targets);
    if (normalizedTargets.length === 0) {
      return [];
    }

    const { message, schemaPresetKey, currentTracker, chatJsonValue, trackerHtml, partsOrder, partsMeta, pendingTargets } =
      getTrackerSchemaAndRenderState(messageId);
    const detailsState = captureDetailsState(messageId);
    const nextTracker = clearTrackerCleanupTargets(currentTracker, chatJsonValue, normalizedTargets);
    const nextPending = buildPendingRedactions([...pendingTargets, ...normalizedTargets], { schemaPresetKey });

    await persistTrackerUpdate({
      messageId,
      message,
      schemaPresetKey,
      trackerData: nextTracker,
      trackerHtml,
      partsOrder,
      partsMeta,
      detailsState,
      successMessage: `Cleared ${normalizedTargets.length} tracker ${normalizedTargets.length === 1 ? 'target' : 'targets'}.`,
      extensionData: buildPendingRedactionExtensionData(message, { nextPending }),
    });

    return normalizedTargets;
  }

  async function recreateCleanupTarget(messageId: number, target: TrackerCleanupTarget): Promise<boolean> {
    if (target.kind === 'part') {
      return !!(await generateTrackerPart(messageId, target.partKey));
    }
    if (target.kind === 'array-item') {
      if (typeof target.idKey === 'string' && target.idKey && typeof target.idValue === 'string' && target.idValue) {
        return !!(await generateTrackerArrayItemByIdentity(messageId, target.partKey, target.idKey, target.idValue));
      }
      return !!(await generateTrackerArrayItem(messageId, target.partKey, target.index));
    }
    if (typeof target.idKey === 'string' && target.idKey && typeof target.idValue === 'string' && target.idValue) {
      return !!(await generateTrackerArrayItemFieldByIdentity(messageId, target.partKey, target.idKey, target.idValue, target.fieldKey));
    }
    return !!(await generateTrackerArrayItemField(messageId, target.partKey, target.index, target.fieldKey));
  }

  async function clearAndRecreateTrackerTargets(messageId: number, targets: TrackerCleanupTarget[]): Promise<void> {
    const normalizedTargets = await clearTrackerTargetsOnly(messageId, targets);
    if (normalizedTargets.length === 0) {
      return;
    }

    let successCount = 0;
    for (const target of sortCleanupTargets(normalizedTargets)) {
      if (await recreateCleanupTarget(messageId, target)) {
        successCount += 1;
      }
    }

    if (successCount === normalizedTargets.length) {
      st_echo('success', `Recreated ${successCount} cleared tracker ${successCount === 1 ? 'target' : 'targets'}.`);
      return;
    }

    st_echo(
      'info',
      `Recreated ${successCount}/${normalizedTargets.length} cleared tracker ${normalizedTargets.length === 1 ? 'target' : 'targets'}. Remaining targets stay pending.`,
    );
  }

  async function openTrackerCleanup(messageId: number) {
    const { currentTracker, chatJsonValue, partsOrder, partsMeta, pendingTargets } = getTrackerSchemaAndRenderState(messageId);
    const rows = buildCleanupPopupRows({
      trackerData: currentTracker,
      schema: chatJsonValue,
      partsOrder,
      partsMeta,
      pendingTargets,
    });

    if (rows.length === 0) {
      st_echo('info', 'No cleanup targets are available for this tracker.');
      return;
    }

    const popupContent = buildCleanupPopupContent(rows);
    globalContext.callGenericPopup(popupContent, POPUP_TYPE.CONFIRM, 'Tracker Cleanup', {
      okButton: 'Apply',
      onClose: async (popup: any) => {
        if (popup.result !== POPUP_RESULT.AFFIRMATIVE) {
          return;
        }

        const selectedTargets = Array.from(
          popup.content.querySelectorAll('[data-ztracker-cleanup-target-index]:checked') as NodeListOf<HTMLInputElement>,
        )
          .map((input) => rows[Number(input.getAttribute('data-ztracker-cleanup-target-index') ?? '-1')]?.target)
          .filter((target): target is TrackerCleanupTarget => !!target);
        const normalizedTargets = normalizeTrackerCleanupTargets(selectedTargets);
        if (normalizedTargets.length === 0) {
          st_echo('error', 'Select at least one tracker target to clear.');
          return;
        }

        const mode =
          (popup.content.querySelector('input[name="ztracker-cleanup-mode"]:checked') as HTMLInputElement | null)?.value ??
          'clear-and-recreate';

        if (mode === 'clear-only') {
          await clearTrackerTargetsOnly(messageId, normalizedTargets);
          return;
        }

        await clearAndRecreateTrackerTargets(messageId, normalizedTargets);
      },
    });

    bindCleanupPopupSummary(rows);
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
    cancelTracker,
    deleteTracker,
    editTracker,
    generateTracker,
    openTrackerCleanup,
    generateTrackerPart,
    generateTrackerArrayItem,
    generateTrackerArrayItemByName,
    generateTrackerArrayItemByIdentity,
    generateTrackerArrayItemField,
    generateTrackerArrayItemFieldByName,
    generateTrackerArrayItemFieldByIdentity,
    modifyChatMetadata,
    renderExtensionTemplates,
    /** Lets outgoing auto mode tag zTracker-owned request starts without affecting manual generation flows. */
    setBeforeRequestStartHook(callback?: () => void) {
      beforeRequestStartHook = callback;
    },
  };
}

export type TrackerActions = ReturnType<typeof createTrackerActions>;
