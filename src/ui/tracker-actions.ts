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
  buildTopLevelPartSchema,
  buildPendingRedactions,
  clearTrackerCleanupTargets,
  getPendingRedactionSchemaPresetKey,
  normalizeTrackerCleanupTargets,
  removePendingRedactionTargets,
  resolveTopLevelPartsOrder,
  mergeTrackerPart,
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
  FULL_TRACKER_STATUS_CLASS,
  withMessageStatusIndicator,
} from './message-status-indicator.js';
import { createContextMenuTrackerActions } from './tracker-context-menu-actions.js';
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

/** Describes the shared full-generation status-indicator options used by manual tracker runs. */
type GenerateTrackerOptions = {
  silent?: boolean;
  showStatusIndicator?: boolean;
};

/** Carries one persisted tracker update through render validation, save, and rollback handling. */
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

/** Describes the prepared runtime state reused by targeted context-menu regeneration actions. */
export type PrepareExistingTrackerGenerationResult = {
  message: unknown;
  settings: ExtensionSettings;
  schemaPresetKey: string;
  currentTracker: unknown;
  chatJsonValue: any;
  chatHtmlValue: string;
  messages: Message[];
  partsOrder: string[];
  partsMeta: unknown;
  makeRequest: (messages: Message[], overrideParams?: any) => Promise<ExtractedData | undefined>;
};

/** Describes one structured tracker request issued by targeted context-menu regeneration actions. */
export type RequestStructuredTrackerContentOptions = {
  messages: Message[];
  settings: ExtensionSettings;
  schema: any;
  schemaName: string;
  prompt: string;
  makeRequest: (messages: Message[], overrideParams?: any) => Promise<ExtractedData | undefined>;
  promptEngineeringInstruction?: string;
};

/** Describes one targeted tracker update that also clears any resolved pending cleanup markers. */
export type PersistResolvedTrackerUpdateOptions = Omit<PersistTrackerUpdateOptions, 'extensionData'> & {
  resolvedTargets: TrackerCleanupTarget[];
};

/** Defines the callback contract consumed by the extracted context-menu tracker actions module. */
export type ContextMenuTrackerActionsDependencies = {
  cancelIfPending: (messageId: number) => boolean;
  getTrackerPrompt: () => string;
  prepareExistingTrackerGeneration: (
    messageId: number,
    notifySchemaMismatch?: boolean,
  ) => Promise<PrepareExistingTrackerGenerationResult>;
  requestStructuredTrackerContent: (options: RequestStructuredTrackerContentOptions) => Promise<unknown>;
  persistResolvedTrackerUpdate: (options: PersistResolvedTrackerUpdateOptions) => Promise<void>;
};

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
  const fullTrackerIndicatorText = 'Updating tracker';

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

  function getActiveChatSchemaPreset(settings: ExtensionSettings) {
    const chatMetadata = SillyTavern.getContext().chatMetadata;
    const extensionMetadata = chatMetadata?.[EXTENSION_KEY];

    return resolveSchemaPreset(
      settings,
      typeof extensionMetadata?.[CHAT_METADATA_SCHEMA_PRESET_KEY] === 'string'
        ? extensionMetadata[CHAT_METADATA_SCHEMA_PRESET_KEY]
        : undefined,
    );
  }

  type ResolvedTrackerConnection = {
    source: 'active' | 'saved';
    profile: any;
    profileId: string;
    apiMap: any;
  };

  /** Normalizes one optional runtime string before using it as a preset or connection selector. */
  function normalizeRuntimeString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  }

  /** Resolves the concrete active backend key while preserving generic text-completion profile families. */
  function resolveActiveRuntimeApi(context: any, selectedProfile: any): string | undefined {
    const textCompletionType = normalizeRuntimeString(context?.textCompletionSettings?.type);
    const selectedApi = normalizeRuntimeString(selectedProfile?.api);
    if (selectedApi) {
      return selectedApi === 'textgenerationwebui' ? textCompletionType ?? selectedApi : selectedApi;
    }

    const mainApi = normalizeRuntimeString(context?.mainApi);
    return mainApi === 'textgenerationwebui' ? textCompletionType ?? mainApi : mainApi;
  }

  /** Resolves one CONNECT_API_MAP entry from either its key or the selected/type aliases the host exposes. */
  function resolveApiMap(api: unknown, connectApiMap: Record<string, any> | undefined): any {
    const normalizedApi = normalizeRuntimeString(api);
    if (!normalizedApi || !connectApiMap || typeof connectApiMap !== 'object') {
      return undefined;
    }

    const directMatch = connectApiMap[normalizedApi];
    if (directMatch?.selected) {
      return directMatch;
    }

    if (
      directMatch
      && typeof directMatch === 'object'
      && normalizeRuntimeString((directMatch as Record<string, unknown>).type) === normalizedApi
    ) {
      return {
        ...directMatch,
        selected: normalizedApi,
      };
    }

    const apiMapEntries = Object.entries(connectApiMap).filter(
      (entry): entry is [string, Record<string, unknown>] => !!entry[1] && typeof entry[1] === 'object',
    );
    const selectedMatches = apiMapEntries.filter(([, entry]) => normalizeRuntimeString(entry.selected) === normalizedApi);
    if (selectedMatches[0]) {
      const matchingTypes = [...new Set(selectedMatches.map(([, entry]) => normalizeRuntimeString(entry.type)).filter(Boolean))];
      if (matchingTypes.length > 1) {
        throw new Error(
          `Conflicting SillyTavern API mapping types for tracker connection API: ${normalizedApi}. Matching selected entries: ${selectedMatches.map(([key, entry]) => `${key} (${normalizeRuntimeString(entry.type) ?? 'unknown'})`).join(', ')}`,
        );
      }

      return {
        ...selectedMatches[0][1],
        selected: normalizedApi,
        ...(matchingTypes.length === 1 ? { type: matchingTypes[0] } : {}),
      };
    }

    const typeMatches = apiMapEntries.filter(([, entry]) => normalizeRuntimeString(entry.type) === normalizedApi);
    if (typeMatches.length > 1) {
      throw new Error(
        `Ambiguous SillyTavern API mapping for tracker connection API: ${normalizedApi}. Matching type entries: ${typeMatches.map(([key]) => key).join(', ')}`,
      );
    }
    if (typeMatches[0]) {
      return typeMatches[0][1];
    }

    return undefined;
  }

  /** Builds a minimal active-connection snapshot from SillyTavern's current runtime state. */
  function getActiveRuntimeConnection(context: any): any {
    const connectionManager = context?.extensionSettings?.connectionManager;
    const rawSelectedProfile = typeof connectionManager?.getSelectedProfile === 'function'
      ? connectionManager.getSelectedProfile()
      : connectionManager?.selectedProfile ?? connectionManager?.activeProfile ?? connectionManager?.currentProfile;
    const selectedProfileId = normalizeRuntimeString(rawSelectedProfile);
    const selectedProfile = rawSelectedProfile && typeof rawSelectedProfile === 'object'
      ? rawSelectedProfile
      : Array.isArray(connectionManager?.profiles)
        ? connectionManager.profiles.find((profile: any) => normalizeRuntimeString(profile?.id) === selectedProfileId)
        : undefined;
    const activePresetName = normalizeRuntimeString(context?.getPresetManager?.()?.getSelectedPresetName?.());
    const activeInstructName = normalizeRuntimeString(context?.powerUserSettings?.instruct?.preset);
    const activeContextName = normalizeRuntimeString(context?.powerUserSettings?.context?.preset);
    const activeSystemPromptName = normalizeRuntimeString(context?.powerUserSettings?.sysprompt?.name);
    const activeApi = resolveActiveRuntimeApi(context, selectedProfile);

    return {
      ...(selectedProfile && typeof selectedProfile === 'object' ? selectedProfile : {}),
      ...(activeApi ? { resolvedApi: activeApi } : {}),
      ...(activePresetName ? { preset: activePresetName } : {}),
      ...(activeInstructName ? { instruct: activeInstructName } : {}),
      ...(activeContextName ? { context: activeContextName } : {}),
      ...(activeSystemPromptName ? { sysprompt: activeSystemPromptName } : {}),
    };
  }

  /** Resolves the effective text-generation API server URL across saved and live SillyTavern profile shapes. */
  function getProfileApiServer(profile: any, source: 'active' | 'saved'): string | undefined {
    const candidateValues = source === 'active'
      ? [
          profile?.api_server,
          profile?.apiServer,
          profile?.server_url,
          profile?.serverUrl,
          profile?.['api-url'],
        ]
      : [
          profile?.['api-url'],
          profile?.api_server,
          profile?.apiServer,
          profile?.server_url,
          profile?.serverUrl,
        ];

    for (const value of candidateValues) {
      const normalized = normalizeRuntimeString(value);
      if (normalized) {
        return normalized;
      }
    }

    return undefined;
  }

  /** Resolves the effective tracker-generation connection from either saved settings or live host state. */
  function resolveTrackerConnection(settings: ExtensionSettings, context: any): ResolvedTrackerConnection {
    const connectionSource = settings.connectionSource ?? 'saved';
    const { extensionSettings, CONNECT_API_MAP } = globalContext;

    if (connectionSource === 'active') {
      const profile = getActiveRuntimeConnection(context);
      const profileId = normalizeRuntimeString(profile?.id) ?? '';
      const profileApi = normalizeRuntimeString(profile?.resolvedApi) ?? normalizeRuntimeString(profile?.api);
      const activeTextCompletionType = normalizeRuntimeString(context?.textCompletionSettings?.type);
      const lacksConcreteActiveTextCompletionType = !activeTextCompletionType || activeTextCompletionType === 'textgenerationwebui';
      const usesGenericTextCompletionFamily = profileApi === 'textgenerationwebui'
        && (
          normalizeRuntimeString(profile?.api) === 'textgenerationwebui'
          || normalizeRuntimeString(context?.mainApi) === 'textgenerationwebui'
        );
      if (!profileApi) {
        throw new Error('No active SillyTavern connection could be resolved for tracker generation.');
      }

      let apiMap;
      try {
        apiMap = resolveApiMap(profileApi, CONNECT_API_MAP);
      } catch (error) {
        if (usesGenericTextCompletionFamily && lacksConcreteActiveTextCompletionType) {
          throw new Error(
            'Could not resolve the active SillyTavern text-generation backend. The live runtime only exposed the generic textgenerationwebui family without a concrete backend type. Select a saved zTracker connection profile or switch the active SillyTavern backend to one with a concrete runtime type.',
          );
        }
        throw error;
      }

      if (!apiMap?.selected) {
        throw new Error(`Unsupported or unknown API for prompt building: ${String(profileApi)}`);
      }

      return {
        source: 'active',
        profile,
        profileId,
        apiMap,
      };
    }

    if (!settings.profileId) {
      throw new Error('Please select a connection profile in settings or switch Connection Source to the active SillyTavern connection.');
    }

    const profile = extensionSettings.connectionManager?.profiles?.find((p: any) => p.id === settings.profileId);
    if (!profile) {
      throw new Error('Selected connection profile not found. Please re-select a profile in zTracker settings.');
    }
    if (!profile.api) {
      throw new Error('Selected connection profile is missing an API. Please edit the profile in SillyTavern settings.');
    }

    const apiMap = resolveApiMap(profile.api, CONNECT_API_MAP);
    if (!apiMap?.selected) {
      throw new Error(`Unsupported or unknown API for prompt building: ${String(profile.api)}`);
    }

    return {
      source: 'saved',
      profile,
      profileId: settings.profileId,
      apiMap,
    };
  }

  function hasStoredTracker(messageId: number) {
    return Boolean(globalContext.chat[messageId]?.extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY]);
  }

  function notifyIfExistingTrackerUsesOlderSchema(settings: ExtensionSettings, messageSchemaPresetKey: string) {
    const { schemaPresetKey: activeChatSchemaPresetKey, schemaPreset: activeChatSchemaPreset } = getActiveChatSchemaPreset(settings);
    if (activeChatSchemaPresetKey === messageSchemaPresetKey) {
      return;
    }

    const messageSchemaPreset = settings.schemaPresets[messageSchemaPresetKey];
    const messageSchemaLabel = messageSchemaPreset?.name ?? messageSchemaPresetKey;
    const activeChatSchemaLabel = activeChatSchemaPreset?.name ?? activeChatSchemaPresetKey;
    st_echo(
      'info',
      `This tracker still uses the older schema "${messageSchemaLabel}". Run a full tracker regeneration for this message to move it onto the current chat schema "${activeChatSchemaLabel}".`,
    );
  }

  const prepareExistingTrackerGeneration: ContextMenuTrackerActionsDependencies['prepareExistingTrackerGeneration'] = async (
    messageId,
    notifySchemaMismatch = true,
  ) => {
    const { schemaPresetKey: messageSchemaPresetKey, currentTracker } = getTrackerSchemaAndRenderState(messageId);
    const prepared = await prepareTrackerGeneration(messageId, { schemaPresetKey: messageSchemaPresetKey });
    if (notifySchemaMismatch) {
      notifyIfExistingTrackerUsesOlderSchema(prepared.settings, messageSchemaPresetKey);
    }

    return {
      ...prepared,
      currentTracker,
      ...getSchemaRenderMetadata(prepared.chatJsonValue),
      makeRequest: makeRequestFactory(messageId, prepared.settings, {
        instructName: prepared.transportInstructName,
        resolvedConnection: prepared.resolvedConnection,
      }),
    };
  };

  async function requestStructuredTrackerContent(options: RequestStructuredTrackerContentOptions) {
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

  const persistResolvedTrackerUpdate: ContextMenuTrackerActionsDependencies['persistResolvedTrackerUpdate'] = async (options) => {
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
    let rollbackTrackerUpdate: (() => void) | undefined;

    try {
      rollbackTrackerUpdate = applyTrackerUpdateAndRender(options.message as any, {
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
    } catch {
      logPromptEngineeredRenderRollback(
        options.trackerData,
        new Error('Generated data failed to render with the current template. Not saved.'),
      );
      renderTrackerWithDeps(options.messageId);
      throw new Error('Generated data failed to render with the current template. Not saved.');
    }

    try {
      await globalContext.saveChat();
      if (options.successMessage) {
        st_echo('success', options.successMessage);
      }
    } catch (error) {
      console.error('Error saving tracker update:', error);
      rollbackTrackerUpdate?.();
      renderTrackerWithDeps(options.messageId);
      restoreDetailsState(options.messageId, options.detailsState);
      throw new Error('Tracker changes could not be saved. Changes were rolled back.');
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
    connectionSource: 'active' | 'saved';
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
          api_server: getProfileApiServer(options.profile, options.connectionSource),
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
          api_server: getProfileApiServer(options.profile, options.connectionSource),
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

  const {
    generateTrackerPart,
    generateTrackerArrayItem,
    generateTrackerArrayItemByName,
    generateTrackerArrayItemByIdentity,
    generateTrackerArrayItemField,
    generateTrackerArrayItemFieldByName,
    generateTrackerArrayItemFieldByIdentity,
    recreateCleanupTarget,
  } = createContextMenuTrackerActions({
    cancelIfPending,
    getTrackerPrompt: () => settingsManager.getSettings().prompt,
    prepareExistingTrackerGeneration,
    requestStructuredTrackerContent,
    persistResolvedTrackerUpdate,
  });

  function makeRequestFactory(
    messageId: number,
    settings: ExtensionSettings,
    options: { instructName?: string; resolvedConnection?: ResolvedTrackerConnection } = {},
  ) {
    return (requestMessages: Message[], overideParams?: any): Promise<ExtractedData | undefined> => {
      return new Promise((resolve, reject) => {
        const abortController = new AbortController();
        const context = SillyTavern.getContext() as {
          name1?: string;
          mainApi?: string;
          powerUserSettings?: {
            preset?: string;
            instruct?: {
              user_alignment_message?: string;
            };
          };
        };
        const resolvedConnection = options.resolvedConnection ?? resolveTrackerConnection(settings, context);
        const profile = resolvedConnection.profile;
        const selectedApiMap = resolvedConnection.apiMap;
        const selectedApi = selectedApiMap?.selected;
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
          connectionSource: resolvedConnection.source,
          profileId: resolvedConnection.profileId || '[active connection]',
          api: selectedApi,
          apiType: selectedApiMap?.type,
          model: typeof profile?.model === 'string' ? profile.model : undefined,
          apiServer: getProfileApiServer(profile, resolvedConnection.source),
          presetName: typeof profile?.preset === 'string' ? profile.preset : undefined,
          instructName: options.instructName,
          contextName: typeof profile?.context === 'string' ? profile.context : undefined,
          syspromptName: typeof profile?.sysprompt === 'string' ? profile.sysprompt : undefined,
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
              connectionSource: resolvedConnection.source,
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
          const requestParams: any = {
            prompt: sanitizedPrompt,
            maxTokens: settings.maxResponseToken,
            custom: { signal: abortController.signal },
            overridePayload: {
              ...overideParams,
            },
          };
          if (resolvedConnection.profileId) {
            requestParams.profileId = resolvedConnection.profileId;
          }
          generator.generateRequest(
            requestParams,
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
    const context = SillyTavern.getContext();
    const chatMetadata = context.chatMetadata;
    const resolvedConnection = resolveTrackerConnection(settings, context);
    const { profile, apiMap } = resolvedConnection;

    chatMetadata[EXTENSION_KEY] = chatMetadata[EXTENSION_KEY] || {};
    const storedChatSchemaPresetKey = chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY];
    const shouldPersistChatSchemaPreset = options?.schemaPresetKey === undefined;
    const { schemaPresetKey, schemaPreset } = resolveSchemaPreset(
      settings,
      options?.schemaPresetKey ?? (typeof storedChatSchemaPresetKey === 'string' ? storedChatSchemaPresetKey : undefined),
    );
    if (shouldPersistChatSchemaPreset && storedChatSchemaPresetKey !== schemaPresetKey) {
      chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY] = schemaPresetKey;
      if (typeof (context as any).saveMetadataDebounced === 'function') {
        (context as any).saveMetadataDebounced();
      }
    }
    const chatJsonValue = schemaPreset.value;
    const chatHtmlValue = schemaPreset.html;

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
      resolvedConnection,
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
    const trackerHtml = message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_HTML_KEY];

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
            let newData: unknown;
            try {
              newData = JSON.parse(textarea.value);
            } catch (e) {
              console.error('Error parsing new tracker data:', e);
              st_echo('error', 'Invalid JSON. Changes were not saved.');
              return;
            }

            const detailsState = captureDetailsState(messageId);
            let rollbackTrackerUpdate: (() => void) | undefined;

            try {
              rollbackTrackerUpdate = applyTrackerUpdateAndRender(message as any, {
                trackerData: newData,
                trackerHtml,
                render: () => renderTrackerWithDeps(messageId),
              });
              restoreDetailsState(messageId, detailsState);
            } catch (e) {
              console.error('Error validating updated tracker data:', e);
              renderTrackerWithDeps(messageId);
              restoreDetailsState(messageId, detailsState);
              st_echo('error', 'Tracker data failed to render. Changes were not saved.');
              return;
            }

            try {
              await globalContext.saveChat();
              st_echo('success', 'Tracker data updated.');
            } catch (e) {
              console.error('Error saving updated tracker data:', e);
              rollbackTrackerUpdate?.();
              renderTrackerWithDeps(messageId);
              restoreDetailsState(messageId, detailsState);
              st_echo('error', 'Tracker changes could not be saved. Changes were rolled back.');
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
        const {
          message,
          settings,
          resolvedConnection,
          schemaPresetKey,
          chatJsonValue,
          chatHtmlValue,
          messages,
          transportInstructName,
        } = await prepareTrackerGeneration(id);
        if (token.cancelled) {
          return false;
        }

        const { partsOrder, partsMeta } = getSchemaRenderMetadata(chatJsonValue);
        const makeRequest = makeRequestFactory(id, settings, {
          instructName: transportInstructName,
          resolvedConnection,
        });
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
        const {
          message,
          settings,
          resolvedConnection,
          schemaPresetKey,
          chatJsonValue,
          chatHtmlValue,
          messages,
          transportInstructName,
        } = await prepareTrackerGeneration(id);
        if (token.cancelled) {
          return false;
        }

        const { partsOrder, partsMeta } = getSchemaRenderMetadata(chatJsonValue);
        if (partsOrder.length === 0) {
          throw new Error('Schema has no top-level properties to generate.');
        }

        const makeRequest = makeRequestFactory(id, settings, {
          instructName: transportInstructName,
          resolvedConnection,
        });
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

  /** Dispatches full tracker generation while enforcing the shared skip-first-messages guard for manual and auto flows. */
  async function generateTracker(id: number, options?: GenerateTrackerOptions) {
    const settings = settingsManager.getSettings();
    const shouldRespectSkipFirstMessages = options?.silent || !hasStoredTracker(id);
    if (shouldRespectSkipFirstMessages && shouldSkipTrackerGeneration(id, settings, (message) => st_echo('info', message), options?.silent)) {
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

  async function clearAndRecreateTrackerTargets(messageId: number, targets: TrackerCleanupTarget[]): Promise<void> {
    const normalizedTargets = await clearTrackerTargetsOnly(messageId, targets);
    if (normalizedTargets.length === 0) {
      return;
    }

    const settings = settingsManager.getSettings();
    const { schemaPresetKey: messageSchemaPresetKey } = getTrackerSchemaAndRenderState(messageId);
    notifyIfExistingTrackerUsesOlderSchema(settings, messageSchemaPresetKey);

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
    let buttonContainer = document.querySelector('#ztracker_menu_buttons') as HTMLElement | null;
    if (!buttonContainer) {
      buttonContainer = document.createElement('div');
      buttonContainer.id = 'ztracker_menu_buttons';
      buttonContainer.className = 'extension_container';
      extensionsMenu?.appendChild(buttonContainer);
    } else {
      buttonContainer.replaceChildren();
    }

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

    extensionsMenu?.querySelector('#ztracker_modify_schema_preset')?.addEventListener('click', modifyChatMetadata);
  }

  async function modifyChatMetadata() {
    const settings = settingsManager.getSettings();
    const context = SillyTavern.getContext();
    const chatMetadata = context.chatMetadata;
    if (!chatMetadata[EXTENSION_KEY]) {
      chatMetadata[EXTENSION_KEY] = {};
    }
    const { schemaPresetKey: currentPresetKey } = resolveSchemaPreset(
      settings,
      typeof chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY] === 'string'
        ? chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY]
        : undefined,
    );
    if (chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY] !== currentPresetKey) {
      chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY] = currentPresetKey;
      context.saveMetadataDebounced();
    }

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
              st_echo(
                'success',
                `Current chat schema preset updated to "${settings.schemaPresets[newPresetKey].name}". Existing trackers keep their saved message schema until you run a full tracker regeneration for those messages.`,
              );
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
