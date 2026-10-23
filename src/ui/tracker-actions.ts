import type { ExtensionSettings, TrackerModuleSettings } from '../config.js';
import {
  PromptEngineeringMode,
  TrackerWorldInfoPolicyMode,
  DEFAULT_MODULE_ID,
  EXTENSION_KEY,
  extensionName,
  getOrderedTrackerModules,
  getSettingsForTrackerModule,
  getTrackerModule,
  getModuleChatMetadataRecord,
  readModuleChatSchemaPresetKey,
  writeModuleChatSchemaPresetKey,
} from '../config.js';
import { applyTrackerModuleIncludeList, resolveTrackerModuleIncludeEntries } from '../tracker-module-chaining.js';
import type { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import { buildPrompt, Generator, getWorldInfos, Message } from 'sillytavern-utils-lib';
import type { ExtractedData } from 'sillytavern-utils-lib/types';
import { characters, st_echo, st_formatWorldInfo, st_getMaxContextSize } from 'sillytavern-utils-lib/config';
import { POPUP_RESULT, POPUP_TYPE } from 'sillytavern-utils-lib/types/popup';
import { createLorebookActions } from './lorebook-actions.js';
import { buildTrackerWorldInfo } from '../world-info-allowlist.js';
import type { TrackerWorldInfoReport } from '../world-info-policy.js';
import { buildWorldInfoScanChat, buildWorldInfoScanData, scanWorldInfo } from '../world-info-scan.js';
import { createHostWorldInfoScopeDeps, resolveWorldInfoScopeSources } from '../world-info-scope.js';
import { loadFullWorldInfoEntries, loadWorldInfoBookByName } from '../sillytavern-world-info.js';
import { parseResponse } from '../parser.js';
import {
  applyPrefill,
  finishTrackerReply,
  isUnclosedReasoningReply,
  lookupFormattingObjects,
  markUnclosedReasoningReply,
  resolveEffectiveConnectionSettings,
  UNCLOSED_REASONING_ERROR,
  type ConnectionSettingsHost,
  type EffectiveConnectionSettings,
} from '../connection-settings.js';
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
  findRenderedModuleBlock,
  getTrackerModuleRecord,
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
import { buildWorldInfoReportElement } from './world-info-report-popup.js';
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

/** Lets a run report its phase and "part N/M" to its badge. */
type RunProgress = { setPhase: (phase: string) => void; setPart: (part?: string) => void };

const NO_PROGRESS: RunProgress = { setPhase: () => undefined, setPart: () => undefined };
const PREPARING_PHASE = 'preparing';
const WAITING_FOR_MODEL_PHASE = 'waiting for the model';

/** Shared stop flag of one multi-Module trigger; the badge cancel sets it so later Modules never start. */
type TriggerToken = { cancelled: boolean };

/** Describes the options shared by every full tracker run (manual, auto and per-Module). */
type GenerateTrackerOptions = {
  moduleId?: string;
  silent?: boolean;
  /** The outgoing auto-mode hold badge already represents this run, so no tracker badge is shown. */
  ownedByHold?: boolean;
  /** "module N/M" label when the run is one of several Modules in one trigger. */
  moduleStep?: string;
  trigger?: TriggerToken;
};

type GenerateTrackersForMessageOptions = Omit<GenerateTrackerOptions, 'moduleId' | 'moduleStep' | 'trigger'> & {
  autoOnly?: boolean;
  moduleIds?: string[];
};

/** Carries one persisted tracker update through render validation, save, and rollback handling. */
type PersistTrackerUpdateOptions = {
  messageId: number;
  moduleId?: string;
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
  settings: TrackerModuleSettings;
  schemaPresetKey: string;
  currentTracker: unknown;
  chatJsonValue: any;
  chatHtmlValue: string;
  messages: Message[];
  /** What World Info this regeneration's prompt was built from; stored with the updated tracker. */
  worldInfo: TrackerWorldInfoReport;
  partsOrder: string[];
  partsMeta: unknown;
  makeRequest: (messages: Message[], overrideParams?: any) => Promise<ExtractedData | undefined>;
};

/** Describes one structured tracker request issued by targeted context-menu regeneration actions. */
export type RequestStructuredTrackerContentOptions = {
  messages: Message[];
  settings: TrackerModuleSettings;
  schema: any;
  schemaName: string;
  prompt: string;
  makeRequest: (messages: Message[], overrideParams?: any) => Promise<ExtractedData | undefined>;
  promptEngineeringInstruction?: string;
};

/** Describes one targeted tracker update that also clears any resolved pending cleanup markers. */
export type PersistResolvedTrackerUpdateOptions = Omit<PersistTrackerUpdateOptions, 'extensionData'> & {
  resolvedTargets: TrackerCleanupTarget[];
  worldInfo?: TrackerWorldInfoReport;
};

const TRACKER_RENDER_FAILURE_MESSAGE = 'Generated data failed to render with the current template. Not saved.';
const TRACKER_MODULE_RECORDS_KEY = 'byId';
const TRACKER_PARTS_META_KEY = 'partsMeta';
/** Per-Module record of the World Info a generation used; lives only under `byId[moduleId]`. */
const WORLD_INFO_RECORD_KEY = 'worldInfo';

/** Defines the callback contract consumed by the extracted context-menu tracker actions module. */
export type ContextMenuTrackerActionsDependencies = {
  cancelIfPending: (messageId: number, moduleId?: string) => boolean;
  prepareExistingTrackerGeneration: (
    messageId: number,
    notifySchemaMismatch?: boolean,
    moduleId?: string,
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

/**
 * Builds the wrapped Text Completion prompt from the effective instruct/context objects. With instruct
 * mode off the messages are joined as plain text (matching the host's no-instruct behaviour).
 * Returns undefined when the wrapped path cannot be used, so the caller can fall back to the host's
 * own request processing.
 */
async function buildStoryStringWrappedTextCompletionPrompt(options: {
  requestMessages: Message[];
  instructEnabled: boolean;
  instructSettings?: Record<string, unknown>;
  contextSettings?: Record<string, unknown>;
  textCompletionService: {
    constructPrompt?: (
      prompt: Message[],
      instructPreset?: string | Record<string, unknown>,
      instructSettings?: Record<string, unknown>,
    ) => string;
  };
  formatterLoader?: () => Promise<TextCompletionStoryStringFormatter | undefined>;
}): Promise<{ prompt: string; stoppingStrings: string[]; instructSettings: Record<string, unknown> } | undefined> {
  if (!options.instructEnabled) {
    return {
      prompt: options.requestMessages.map((message) => message.content).join('\n\n'),
      stoppingStrings: [],
      instructSettings: {},
    };
  }

  const activeInstructSettings = options.instructSettings;
  const activeContextSettings = options.contextSettings;
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

  if (remainingMessages.length > 0) {
    // SillyTavern's wrapped text-completion prompt builder can drop `message.name`
    // for dialogue turns, so reuse the canonical sanitizer before delegating the body.
    const wrappedBodyMessages = sanitizeMessagesForGeneration(remainingMessages as Array<{
      role: string;
      content: string;
      name?: string;
      ignoreInstruct?: boolean;
      source?: { name?: string };
    }>, {
      inlineNamesIntoContent: true,
    }) as Message[];
    const promptBody = options.textCompletionService.constructPrompt(wrappedBodyMessages, activeInstructSettings, {});
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
  renderTrackerWithDeps: (messageId: number, moduleId?: string) => void;
  importMetaUrl: string;
  beforeRequestStartHook?: () => void;
  textCompletionStoryStringFormatterLoader?: () => Promise<TextCompletionStoryStringFormatter | undefined>;
}) {
  const { globalContext, settingsManager, generator, pendingRequests, renderTrackerWithDeps, importMetaUrl } = options;
  const pendingSequences = new Map<string, { cancelled: boolean }>();
  const pendingRequestsByRun = new Map<string, string>();
  const localPendingRequestAborters = new Map<string, AbortController>();
  let nextLocalRequestId = 0;
  let beforeRequestStartHook = options.beforeRequestStartHook;
  const textCompletionStoryStringFormatterLoader = options.textCompletionStoryStringFormatterLoader;
  const { logPromptEngineeredRenderRollback, requestPromptEngineeredResponse } = createPromptEngineeringHelpers();
  const fullTrackerIndicatorText = 'Updating tracker';

  function makeTrackerRunKey(messageId: number, moduleId = DEFAULT_MODULE_ID) {
    return `${messageId}:${moduleId}`;
  }

  function getModuleDebugName(moduleId = DEFAULT_MODULE_ID) {
    return getOrderedTrackerModules(settingsManager.getSettings(), { includeDisabled: true })
      .find((candidate) => candidate.id === moduleId)?.name;
  }

  function getModuleStatusText(moduleId = DEFAULT_MODULE_ID) {
    const moduleName = getModuleDebugName(moduleId);
    return moduleName ? `${fullTrackerIndicatorText}: ${moduleName}` : fullTrackerIndicatorText;
  }

  function resolveSchemaPreset(settings: TrackerModuleSettings, requestedKey?: string) {
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

  function getMessageSchemaPresetKey(message: any, moduleId = DEFAULT_MODULE_ID): string | undefined {
    const trackerRecord = getTrackerModuleRecord(message, moduleId);
    const messageSchemaPresetKey = trackerRecord?.[CHAT_MESSAGE_SCHEMA_PRESET_KEY];
    if (typeof messageSchemaPresetKey === 'string' && messageSchemaPresetKey.trim().length > 0) {
      return messageSchemaPresetKey;
    }

    return getPendingRedactionSchemaPresetKey(trackerRecord?.[CHAT_MESSAGE_PENDING_REDACTIONS_KEY]);
  }

  function buildPendingRedactionExtensionData(
    message: any,
    options: {
      moduleId?: string;
      clearAll?: boolean;
      nextPending?: unknown;
      resolvedTargets?: TrackerCleanupTarget[];
    } = {},
  ): Record<string, unknown> {
    const hasExplicitNextPending = Object.prototype.hasOwnProperty.call(options, 'nextPending');
    const trackerRecord = getTrackerModuleRecord(message, options.moduleId ?? DEFAULT_MODULE_ID);
    let pendingRedactions = hasExplicitNextPending
      ? options.nextPending
      : trackerRecord?.[CHAT_MESSAGE_PENDING_REDACTIONS_KEY];

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

  function getActiveChatSchemaPreset(settings: TrackerModuleSettings, moduleId = DEFAULT_MODULE_ID) {
    const chatMetadata = SillyTavern.getContext().chatMetadata;

    return resolveSchemaPreset(
      settings,
      readModuleChatSchemaPresetKey(chatMetadata, moduleId),
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
    const activeSystemPromptName = normalizeRuntimeString(context?.powerUserSettings?.sysprompt?.name);
    const activeApi = resolveActiveRuntimeApi(context, selectedProfile);

    return {
      ...(selectedProfile && typeof selectedProfile === 'object' ? selectedProfile : {}),
      ...(activeApi ? { resolvedApi: activeApi } : {}),
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
  function resolveTrackerConnection(settings: TrackerModuleSettings, context: any): ResolvedTrackerConnection {
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

  function hasStoredTracker(messageId: number, moduleId = DEFAULT_MODULE_ID) {
    return Boolean(getTrackerModuleRecord(globalContext.chat[messageId], moduleId)?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY]);
  }

  function notifyIfExistingTrackerUsesOlderSchema(settings: TrackerModuleSettings, messageSchemaPresetKey: string, moduleId = DEFAULT_MODULE_ID) {
    const { schemaPresetKey: activeChatSchemaPresetKey, schemaPreset: activeChatSchemaPreset } = getActiveChatSchemaPreset(settings, moduleId);
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
    moduleId = DEFAULT_MODULE_ID,
  ) => {
    const { schemaPresetKey: messageSchemaPresetKey, currentTracker } = getTrackerSchemaAndRenderState(messageId, moduleId);
    const prepared = await prepareTrackerGeneration(messageId, { schemaPresetKey: messageSchemaPresetKey, moduleId });
    if (notifySchemaMismatch) {
      notifyIfExistingTrackerUsesOlderSchema(prepared.settings, messageSchemaPresetKey, moduleId);
    }

    return {
      ...prepared,
      currentTracker,
      ...getSchemaRenderMetadata(prepared.chatJsonValue),
      makeRequest: makeRequestFactory(messageId, prepared.settings, {
        resolvedConnection: prepared.resolvedConnection,
        moduleId,
        moduleName: getModuleDebugName(moduleId),
      }),
    };
  };

  async function requestStructuredTrackerContent(options: RequestStructuredTrackerContentOptions) {
    if (options.settings.promptEngineeringMode === PromptEngineeringMode.NATIVE) {
      insertTrackerInstructionMessage(options.messages, options.prompt);
      const result = await options.makeRequest(options.messages, {
        json_schema: { name: options.schemaName, strict: true, value: options.schema },
      });
      if (isUnclosedReasoningReply(result) && typeof result?.content === 'string') {
        // A reply that opened a reasoning block and never closed it is only usable if the rest parses.
        try {
          return parseResponse(result.content, 'json', { schema: options.schema });
        } catch {
          throw new Error(UNCLOSED_REASONING_ERROR);
        }
      }
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
      extensionData: {
        ...buildPendingRedactionExtensionData(options.message, {
          moduleId: options.moduleId,
          resolvedTargets: options.resolvedTargets,
        }),
        ...(options.worldInfo ? { [WORLD_INFO_RECORD_KEY]: options.worldInfo } : {}),
      },
    });
  };

  /** Shows a per-run badge (phase, timer, cancel) for every full tracker run, unless the outgoing hold already shows one. */
  const runWithFullTrackerStatusIndicator = <T>(
    messageId: number,
    options: GenerateTrackerOptions | undefined,
    callback: (progress: RunProgress) => Promise<T>,
  ) => {
    if (options?.ownedByHold) {
      return callback(NO_PROGRESS);
    }

    const moduleId = options?.moduleId ?? DEFAULT_MODULE_ID;
    return withMessageStatusIndicator(
      {
        messageId,
        text: getModuleStatusText(moduleId),
        statusClassName: FULL_TRACKER_STATUS_CLASS,
        runKey: makeTrackerRunKey(messageId, moduleId),
        onCancel: () => {
          if (options?.trigger) options.trigger.cancelled = true;
          cancelIfPending(messageId, moduleId);
        },
      },
      (handle) => {
        handle.setPhase(PREPARING_PHASE);
        handle.setStep(options?.moduleStep ?? '');
        return callback({
          setPhase: handle.setPhase,
          setPart: (part) => handle.setStep([options?.moduleStep, part].filter(Boolean).join(' - ')),
        });
      },
    );
  };

  /** Persists a generated tracker update and restores the rendered tracker state if the save can complete. */
  const persistTrackerUpdate = async (options: PersistTrackerUpdateOptions) => {
    let rollbackTrackerUpdate: (() => void) | undefined;

    try {
      rollbackTrackerUpdate = applyTrackerUpdateAndRender(options.message as any, {
        moduleId: options.moduleId,
        trackerData: options.trackerData,
        trackerHtml: options.trackerHtml,
        extensionData: {
          [CHAT_MESSAGE_SCHEMA_PRESET_KEY]: options.schemaPresetKey,
          [CHAT_MESSAGE_PARTS_ORDER_KEY]: options.partsOrder,
          partsMeta: options.partsMeta,
          ...(options.extensionData ?? {}),
        },
        render: (moduleId) => renderTrackerWithDeps(options.messageId, moduleId),
      });
      restoreDetailsState(options.messageId, options.detailsState);
    } catch {
      logPromptEngineeredRenderRollback(
        options.trackerData,
        new Error(TRACKER_RENDER_FAILURE_MESSAGE),
      );
      renderTrackerWithDeps(options.messageId);
      throw new Error(TRACKER_RENDER_FAILURE_MESSAGE);
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

  const formatTrackerGenerationErrorMessage = (error: unknown, activeSchemaPresetLabel?: string) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return errorMessage === TRACKER_RENDER_FAILURE_MESSAGE && activeSchemaPresetLabel
      ? `Generated data failed to render with schema preset "${activeSchemaPresetLabel}". Not saved.`
      : errorMessage;
  };

  function getTrackerSchemaAndRenderState(messageId: number, moduleId = DEFAULT_MODULE_ID) {
    const message = globalContext.chat[messageId];
    const trackerRecord = getTrackerModuleRecord(message, moduleId);
    if (!trackerRecord?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY]) {
      throw new Error('No existing tracker found for this message. Generate a full tracker first.');
    }

    const settings = getSettingsForTrackerModule(settingsManager.getSettings(), moduleId);
    const { schemaPresetKey, schemaPreset } = resolveSchemaPreset(settings, getMessageSchemaPresetKey(message, moduleId));
    const currentTracker = trackerRecord[CHAT_MESSAGE_SCHEMA_VALUE_KEY];
    const chatJsonValue = schemaPreset.value;
    const trackerHtml = trackerRecord[CHAT_MESSAGE_SCHEMA_HTML_KEY] ?? schemaPreset.html;
    const partsOrder =
      trackerRecord[CHAT_MESSAGE_PARTS_ORDER_KEY] ?? resolveTopLevelPartsOrder(chatJsonValue);
    const partsMeta = buildPartsMeta(chatJsonValue);
    const pendingTargets = getCurrentPendingRedactions(message, moduleId);

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
   * Sends text-completion tracker requests formatted with the effective instruct/context templates,
   * sampler preset, stop strings and secret of the Module's connection.
   * This currently depends on SillyTavern's internal TextCompletionService because
   * the public request service does not expose an instruct-name override yet.
   * Keep this path isolated so it can move back to the stable request service once
   * upstream surfaces that override.
   */
  async function sendTextCompletionTrackerRequest(options: {
    messageId: number;
    runKey: string;
    profile: any;
    connectionSource: 'active' | 'saved';
    selectedApiType: string | undefined;
    requestMessages: Message[];
    effective: EffectiveConnectionSettings;
    formatting: Pick<ReturnType<typeof lookupFormattingObjects>, 'instruct' | 'context'>;
    overridePayload?: Record<string, any>;
    maxTokens: number;
  }): Promise<ExtractedData | undefined> {
    const context = SillyTavern.getContext() as ConnectionSettingsHost & {
      TextCompletionService?: {
        constructPrompt?: (
          prompt: Message[],
          instructPreset?: string | Record<string, unknown>,
          instructSettings?: Record<string, unknown>,
        ) => string;
        createRequestData?: (requestData: Record<string, any>) => Record<string, any>;
        presetToGeneratePayload?: (
          preset: Record<string, unknown>,
          overridePreset?: Record<string, unknown>,
          overridePayload?: Record<string, any>,
        ) => Record<string, any>;
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
    };
    const { effective } = options;
    const secretId = options.connectionSource === 'saved' ? options.profile?.['secret-id'] : undefined;
    const textCompletionService = context?.TextCompletionService;
    if (typeof textCompletionService?.processRequest !== 'function') {
      throw new Error('SillyTavern text-completion request API is unavailable.');
    }

    const abortController = new AbortController();
    const requestId = createLocalRequestId(options.messageId);
    pendingRequests.set(options.messageId, requestId);
    pendingRequestsByRun.set(options.runKey, requestId);
    localPendingRequestAborters.set(requestId, abortController);

    try {
      const { formatting } = options;
      const wrappedPrompt = await buildStoryStringWrappedTextCompletionPrompt({
        requestMessages: options.requestMessages,
        instructEnabled: effective.instructEnabled,
        instructSettings: formatting.instruct,
        contextSettings: formatting.context,
        textCompletionService,
        formatterLoader: textCompletionStoryStringFormatterLoader,
      });
      if (
        wrappedPrompt &&
        typeof textCompletionService.createRequestData === 'function' &&
        typeof textCompletionService.sendRequest === 'function'
      ) {
        beforeRequestStartHook?.();

        // Always sent, even when empty: the sampler-preset merge below would otherwise fill in the
        // host's live-derived stop list (live custom strings, single-line mode, names-as-stop).
        const stoppingStrings = [...new Set([...wrappedPrompt.stoppingStrings, ...effective.stopStrings])];
        let requestData = textCompletionService.createRequestData.call(textCompletionService, {
          stream: false,
          prompt: wrappedPrompt.prompt,
          max_tokens: options.maxTokens,
          model: options.profile?.model,
          api_type: options.selectedApiType ?? options.profile?.api,
          api_server: getProfileApiServer(options.profile, options.connectionSource),
          ...(secretId ? { secret_id: secretId } : {}),
          stop: stoppingStrings,
          stopping_strings: stoppingStrings,
          ...(options.overridePayload ?? {}),
        });

        // The same mechanism the host's processRequest uses to merge a sampler preset into a payload.
        if (effective.presetName && typeof textCompletionService.presetToGeneratePayload === 'function') {
          const samplerPreset = context.getPresetManager?.('textgenerationwebui')?.getCompletionPresetByName?.(effective.presetName);
          if (samplerPreset && typeof samplerPreset === 'object') {
            requestData = textCompletionService.presetToGeneratePayload.call(
              textCompletionService,
              samplerPreset as Record<string, unknown>,
              {},
              requestData,
            );
          } else {
            console.warn(`zTracker: sampler preset "${effective.presetName}" was not found; continuing with default sampler settings.`);
          }
        }

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
        ...(effective.presetName ? { presetName: effective.presetName } : {}),
        ...(effective.instructEnabled && effective.instructName ? { instructName: effective.instructName } : {}),
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
          ...(secretId ? { secret_id: secretId } : {}),
          stop: effective.stopStrings,
          stopping_strings: effective.stopStrings,
          ...(options.overridePayload ?? {}),
        },
        requestOptions,
        true,
        abortController.signal,
      );
    } finally {
      localPendingRequestAborters.delete(requestId);
      pendingRequestsByRun.delete(options.runKey);
      pendingRequests.delete(options.messageId);
    }
  }

  function cancelRequestId(requestId: string) {
    const localAbortController = localPendingRequestAborters.get(requestId);
    if (localAbortController) {
      localAbortController.abort();
    } else {
      generator.abortRequest(requestId);
    }
  }

  function cancelIfPending(messageId: number, moduleId?: string): boolean {
    const runKeys = moduleId
      ? [makeTrackerRunKey(messageId, moduleId)]
      : [...pendingSequences.keys(), ...pendingRequestsByRun.keys()]
        .filter((key, index, keys) => key.startsWith(`${messageId}:`) && keys.indexOf(key) === index);
    let cancelled = false;

    for (const runKey of runKeys) {
      const token = pendingSequences.get(runKey);
      const requestId = pendingRequestsByRun.get(runKey);

      if (requestId) {
        cancelRequestId(requestId);
        cancelled = true;
      }

      if (!token) {
        continue;
      }

      token.cancelled = true;
      cancelled = true;
    }

    if (!moduleId && pendingRequests.has(messageId)) {
      const requestId = pendingRequests.get(messageId)!;
      cancelRequestId(requestId);
      cancelled = true;
    }

    if (!cancelled) {
      return false;
    }

    st_echo('info', 'Tracker generation cancelled.');
    return true;
  }

  /** Cancels the currently pending tracker run for a message, if one exists. */
  function cancelTracker(messageId: number, moduleId?: string): boolean {
    return cancelIfPending(messageId, moduleId);
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
    prepareExistingTrackerGeneration,
    requestStructuredTrackerContent,
    persistResolvedTrackerUpdate,
  });

  /** Resolves the saved-profile-or-live effective connection/formatting settings for one connection. */
  function resolveEffectiveSettings(resolvedConnection: ResolvedTrackerConnection, context: unknown) {
    return resolveEffectiveConnectionSettings({
      connectionSource: resolvedConnection.source,
      profile: resolvedConnection.profile,
      isTextCompletion: resolvedConnection.apiMap?.selected === 'textgenerationwebui',
      host: context as ConnectionSettingsHost,
    });
  }

  /**
   * Builds the request function for one tracker run. Unless `rawReply` is set it also applies the
   * effective Start Reply With as an assistant prefill and finishes every reply (prefill restore,
   * reasoning stripping) before the parsers see it.
   */
  function makeRequestFactory(
    messageId: number,
    settings: TrackerModuleSettings,
    options: { resolvedConnection?: ResolvedTrackerConnection; moduleId?: string; moduleName?: string; rawReply?: boolean } = {},
  ) {
    return (rawRequestMessages: Message[], overideParams?: any): Promise<ExtractedData | undefined> => {
      return new Promise((resolve, reject) => {
        const abortController = new AbortController();
        const context = SillyTavern.getContext() as ConnectionSettingsHost & {
          name1?: string;
          mainApi?: string;
          parseReasoningFromString?: Parameters<typeof finishTrackerReply>[1]['parseReasoning'];
        };
        const resolvedConnection = options.resolvedConnection ?? resolveTrackerConnection(settings, context);
        const runKey = makeTrackerRunKey(messageId, options.moduleId);
        const profile = resolvedConnection.profile;
        const selectedApiMap = resolvedConnection.apiMap;
        const selectedApi = selectedApiMap?.selected;
        const effective = resolveEffectiveSettings(resolvedConnection, context);
        // Resolved here (not at send time) so a missing profile template shows up in Diagnostics.
        const formatting = selectedApi === 'textgenerationwebui' ? lookupFormattingObjects(effective, context) : undefined;
        const fallbackFields = [...new Set([...effective.fallbackFields, ...(formatting?.fallbackFields ?? [])])];
        const jsonSchemaSent = Boolean(overideParams?.json_schema);
        const startReplyWith = typeof context.substituteParams === 'function' && effective.startReplyWith
          ? context.substituteParams(effective.startReplyWith)
          : effective.startReplyWith;
        const prefilled = options.rawReply
          ? { messages: rawRequestMessages, prefill: '', omitted: false }
          : applyPrefill(rawRequestMessages, { prefill: startReplyWith, jsonSchemaSent, reasoningTemplate: effective.reasoningTemplate });
        const requestMessages = prefilled.messages;
        if (prefilled.omitted) {
          console.warn('zTracker: Start Reply With was omitted because it leaves a reasoning block open and a structured-output schema is sent.');
          debugLog(settingsManager, 'start reply with omitted', { startReplyWith });
        }
        // Puts the sent prefill back and strips reasoning; a no-op for probe requests and non-text replies.
        // Callers chain it before `resolve` so a throw rejects the request instead of leaving it pending.
        const finishReply = (data: ExtractedData | undefined): ExtractedData | undefined => {
          if (options.rawReply || !data || typeof data.content !== 'string') return data;
          const finished = finishTrackerReply(data as { content: string; reasoning?: unknown }, {
            prefill: prefilled.prefill,
            jsonSchemaSent,
            reasoningTemplate: effective.reasoningTemplate,
            parseReasoning: context.parseReasoningFromString,
          });
          if (finished.content === data.content && !finished.unclosedReasoning) return data;
          const result = { ...data, content: finished.content };
          if (finished.unclosedReasoning) markUnclosedReasoningReply(result);
          return result;
        };
        // The alignment message belongs to the effective instruct template, not necessarily the live one.
        const alignmentMessage = formatting?.instruct?.user_alignment_message;
        const sanitizedPrompt = sanitizeMessagesForGeneration(requestMessages, {
          inlineNamesIntoContent: selectedApi === 'textgenerationwebui',
          userAlignmentMessage: typeof alignmentMessage === 'string' ? alignmentMessage : undefined,
          userName: selectedApi === 'textgenerationwebui' ? context?.name1 : undefined,
        });
        captureTrackerRequestDebugSnapshot(settingsManager, {
          messageId,
          moduleId: options.moduleId,
          moduleName: options.moduleName,
          connectionSource: resolvedConnection.source,
          profileId: resolvedConnection.profileId || '[active connection]',
          api: selectedApi,
          apiType: selectedApiMap?.type,
          model: typeof profile?.model === 'string' ? profile.model : undefined,
          apiServer: getProfileApiServer(profile, resolvedConnection.source),
          presetName: effective.presetName,
          instructName: effective.instructName,
          contextName: effective.contextName,
          syspromptName: selectedApi === 'textgenerationwebui' ? resolveTrackerSystemPromptName(settings, context as any, profile) : undefined,
          settingsSource: effective.source,
          fallbackFields,
          instructEnabled: selectedApi === 'textgenerationwebui' ? effective.instructEnabled : undefined,
          startReplyWith: prefilled.prefill,
          startReplyWithOmitted: prefilled.omitted,
          reasoningTemplateName: effective.reasoningTemplate?.name,
          promptEngineeringMode: settings.promptEngineeringMode,
          maxTokens: settings.maxResponseToken,
          embedSnapshotHeader: settings.embedZTrackerSnapshotHeader,
          overridePayload: overideParams ?? {},
          requestMessages: requestMessages as any,
          sanitizedPrompt,
        });
        try {
          if (selectedApi === 'textgenerationwebui') {
            void sendTextCompletionTrackerRequest({
              messageId,
              runKey,
              profile,
              connectionSource: resolvedConnection.source,
              selectedApiType: selectedApiMap?.type,
              requestMessages: sanitizedPrompt,
              effective,
              formatting: formatting ?? {},
              overridePayload: overideParams ?? {},
              maxTokens: settings.maxResponseToken,
            }).then(finishReply).then(resolve, reject);
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
                pendingRequestsByRun.set(runKey, requestId);
              },
              onFinish: (requestId: string, data: unknown, error: unknown) => {
                pendingRequestsByRun.delete(runKey);
                pendingRequests.delete(messageId);
                if (error) return reject(error);
                if (!data) return reject(new DOMException('Request aborted by user', 'AbortError'));
                try {
                  resolve(finishReply(data as ExtractedData | undefined));
                } catch (finishError) {
                  reject(finishError);
                }
              },
            },
          );
        } catch (error) {
          reject(error);
        }
      });
    };
  }

  // Trivial one-field schema used only to probe whether a connection's backend actually honors a
  // `json_schema` structured-output override - independent of any real tracker schema.
  const GRAMMAR_TEST_SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
  // A small dedicated budget keeps the probe cheap/fast; the real Module's maxResponseToken is
  // irrelevant to this one-boolean-field check and could be large on metered/paid backends.
  const GRAMMAR_TEST_MAX_TOKENS = 64;
  let nextGrammarTestMessageId = -1;

  /**
   * Fires one throwaway structured-output request against a Module's currently resolved
   * connection, with no chat message required, and reports whether the response actually
   * conformed to a trivial test schema. This is the only way a user learns whether their backend
   * honors the opt-in grammar/schema enforcement setting - no result is persisted.
   */
  async function testGrammarSchemaEnforcement(moduleId: string): Promise<{ supported: boolean; message: string }> {
    const settings = { ...getSettingsForTrackerModule(settingsManager.getSettings(), moduleId), maxResponseToken: GRAMMAR_TEST_MAX_TOKENS };
    const context = SillyTavern.getContext();

    let resolvedConnection: ResolvedTrackerConnection;
    try {
      resolvedConnection = resolveTrackerConnection(settings, context);
    } catch (error) {
      return { supported: false, message: error instanceof Error ? error.message : 'Could not resolve a connection to test.' };
    }

    // A unique negative id keeps this synthetic probe from colliding with real chat message
    // indices (always >= 0) in the pendingRequests/pendingRequestsByRun bookkeeping maps.
    const syntheticMessageId = nextGrammarTestMessageId;
    nextGrammarTestMessageId -= 1;

    // rawReply keeps the probe a plain schema check: no Start Reply With prefill, no reasoning handling.
    const makeRequest = makeRequestFactory(syntheticMessageId, settings, {
      resolvedConnection,
      moduleId,
      moduleName: getModuleDebugName(moduleId),
      rawReply: true,
    });

    try {
      const response = await makeRequest(
        [{ role: 'system', content: 'Respond with only a single JSON object of the exact shape {"ok": true}. No other text.' }],
        { json_schema: GRAMMAR_TEST_SCHEMA },
      );

      const rawContent = response?.content;
      if (typeof rawContent !== 'string' || !rawContent.trim()) {
        return { supported: false, message: 'The connection returned no content for the test request.' };
      }

      // Reuses the same fence-stripping/repair pipeline real JSON-mode generation relies on, so a
      // backend that wraps schema-constrained output in a markdown fence isn't misreported as failing.
      let parsed: unknown;
      try {
        parsed = parseResponse(rawContent, 'json', { schema: GRAMMAR_TEST_SCHEMA });
      } catch {
        return {
          supported: false,
          message: 'The response was not valid JSON, so schema enforcement is not confirmed for this connection.',
        };
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof (parsed as { ok?: unknown }).ok !== 'boolean') {
        return {
          supported: false,
          message: 'The response did not match the trivial test schema, so schema enforcement is not confirmed for this connection.',
        };
      }

      return { supported: true, message: 'The current connection returned schema-conforming output. Schema enforcement is supported.' };
    } catch (error) {
      return { supported: false, message: error instanceof Error ? error.message : 'The test request failed.' };
    }
  }

  // Common chat defaults (e.g. 350) cannot hold a generated schema, and a truncated reply looks like invalid JSON.
  const GENERATION_MIN_RESPONSE_TOKENS = 2048;
  let nextGenerationMessageId = -1000;

  /** Reply budget for Module-authoring requests: the active connection's live response length, raised to the floor. */
  function getGenerationMaxTokens(context: { substituteParams?: (text: string) => string }): number {
    const live = Number.parseInt(context.substituteParams?.('{{maxResponse}}') ?? '', 10);
    return Number.isFinite(live) ? Math.max(live, GENERATION_MIN_RESPONSE_TOKENS) : GENERATION_MIN_RESPONSE_TOKENS;
  }

  /** "API · model" of the global active connection when known, for the Schema editor's notice. */
  function getActiveConnectionLabel(): string {
    const context = SillyTavern.getContext() as any;
    const model = context.substituteParams?.('{{model}}');
    const parts = [context.mainApi, model && model !== '{{model}}' ? model : undefined].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'the active connection';
  }

  /**
   * One message-less request through the global active SillyTavern connection (independent of any
   * Module's own connection), used by LLM schema/prompt generation. Reasoning is stripped here because
   * `rawReply` skips it; no Start Reply With prefill is applied. `signal` cancels the in-flight request.
   */
  async function requestWithActiveConnection(
    messages: Array<{ role: string; content: string }>,
    overridePayload?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    const context = SillyTavern.getContext() as any;
    const settings = {
      ...getSettingsForTrackerModule(settingsManager.getSettings(), DEFAULT_MODULE_ID),
      connectionSource: 'active' as const,
      maxResponseToken: getGenerationMaxTokens(context),
    };
    if (signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError');

    // Throws when there is no usable active connection, before anything is sent.
    const resolvedConnection = resolveTrackerConnection(settings, context);
    const messageId = nextGenerationMessageId;
    nextGenerationMessageId -= 1;
    const makeRequest = makeRequestFactory(messageId, settings, {
      resolvedConnection,
      moduleName: 'Schema generation',
      rawReply: true,
    });

    const onAbort = () => {
      const requestId = pendingRequests.get(messageId);
      if (requestId) cancelRequestId(requestId);
    };
    signal?.addEventListener('abort', onAbort);
    try {
      const response = await makeRequest(messages as Message[], overridePayload);
      if (signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError');
      if (typeof response?.content !== 'string' || !response.content.trim()) {
        throw new Error('The active connection returned no content.');
      }
      return finishTrackerReply(response as { content: string; reasoning?: unknown }, {
        prefill: '',
        jsonSchemaSent: false,
        reasoningTemplate: context.powerUserSettings?.reasoning,
        parseReasoning: context.parseReasoningFromString,
      }).content;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async function prepareTrackerGeneration(messageId: number, options?: { schemaPresetKey?: string; moduleId?: string }) {
    const message = globalContext.chat[messageId];
    if (!message) {
      throw new Error(`Message with ID ${messageId} not found.`);
    }

    const moduleId = options?.moduleId ?? DEFAULT_MODULE_ID;
    const settings = getSettingsForTrackerModule(settingsManager.getSettings(), moduleId);
    const context = SillyTavern.getContext();
    const chatMetadata = context.chatMetadata;
    const resolvedConnection = resolveTrackerConnection(settings, context);
    const { profile, apiMap } = resolvedConnection;

    getModuleChatMetadataRecord(chatMetadata, moduleId, true);
    const storedChatSchemaPresetKey = readModuleChatSchemaPresetKey(chatMetadata, moduleId);
    const shouldPersistChatSchemaPreset = options?.schemaPresetKey === undefined;
    const { schemaPresetKey, schemaPreset } = resolveSchemaPreset(
      settings,
      options?.schemaPresetKey ?? (typeof storedChatSchemaPresetKey === 'string' ? storedChatSchemaPresetKey : undefined),
    );
    if (shouldPersistChatSchemaPreset && storedChatSchemaPresetKey !== schemaPresetKey) {
      writeModuleChatSchemaPresetKey(chatMetadata, schemaPresetKey, moduleId);
      if (typeof (context as any).saveMetadataDebounced === 'function') {
        (context as any).saveMetadataDebounced();
      }
    }
    const chatJsonValue = schemaPreset.value;
    const chatHtmlValue = schemaPreset.html;

    let characterId = characters.findIndex((char: any) => char.avatar === message.original_avatar);
    characterId = characterId !== -1 ? characterId : undefined;

    const trackerWorldInfoMode = settings.trackerWorldInfoPolicyMode ?? TrackerWorldInfoPolicyMode.INCLUDE_ALL;
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

    const promptPresetSelections = getPromptPresetSelections(apiMap.selected, {
      context,
      effective: resolveEffectiveSettings(resolvedConnection, context),
      trackerSystemPromptMode: settings.trackerSystemPromptMode,
      trackerSystemPromptName: syspromptName,
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
      // zTracker runs its own dry-run scan below; the library's scan is a real run that advances sticky/cooldown timers.
      ignoreWorldInfo: true,
      ...(skipCharacterCardInTrackerGeneration ? { ignoreCharacterFields: true } : {}),
    });

    const currentModule = getTrackerModule(settingsManager.getSettings(), moduleId);
    // Chained (non-self) entries scan globalContext.chat directly so they stay independent of
    // the raw messageIndexesBetween window used above; self-history stays window-bound.
    debugLog(settingsManager, 'include list resolved', {
      moduleId,
      entries: resolveTrackerModuleIncludeEntries(currentModule, settingsManager.getSettings().modules ?? []).map((resolved) => ({
        target: resolved.entry.target,
        count: resolved.entry.count,
        status: !resolved.eligible ? 'dormant' : resolved.entry.count === 0 ? 'zero-count' : 'active',
      })),
    });
    let messages = applyTrackerModuleIncludeList(promptResult.result, currentModule, settings, {
      chat: globalContext.chat,
      messageId,
    });
    messages = normalizeTrackerGenerationConversationRoles(messages, settings);
    debugLog(settingsManager, 'prompt built', {
      trackerGenerationConversationRoleMode: settings.trackerGenerationConversationRoleMode ?? 'preserve',
      skipCharacterCardInTrackerGeneration,
      messageCount: messages.length,
      roles: messages.map((m: any) => m.role),
    });

    // Stays 'scan-unavailable' if building World Info throws below, so a failure is never recorded as "nothing matched".
    let worldInfo: TrackerWorldInfoReport = { outcome: 'scan-unavailable', books: [] };
    try {
      const allowlistRows = settings.trackerWorldInfoAllowlist ?? [];
      const scannedChat = buildWorldInfoScanChat(globalContext.chat, messageId, settings.includeLastXMessages);
      const built = await buildTrackerWorldInfo({
        mode: trackerWorldInfoMode,
        scannedChat,
        rows: allowlistRows,
        debug: !!settings.debugLogging,
        resolveSources: () =>
          resolveWorldInfoScopeSources(
            createHostWorldInfoScopeDeps(context, async () => Object.keys(await getWorldInfos(['global'], true))),
            { card: allowlistRows.some((r) => r.activeVia.includes('card')), global: allowlistRows.some((r) => r.activeVia.includes('global')) },
          ),
        loadBookByName: (name) => loadWorldInfoBookByName(name, { debug: !!settings.debugLogging }),
        loadFullEntries: (name) => loadFullWorldInfoEntries(name, (book) => (context as any).loadWorldInfo(book)),
        scan: (restrictTo) =>
          scanWorldInfo({
            host: {
              getWorldInfoPrompt: (context as any).getWorldInfoPrompt,
              eventSource: context.eventSource as any,
              eventTypes: (context as any).eventTypes,
              // streamingProcessor only exists while streaming; the host also marks any generation on <body>.
              isGenerating: () =>
                !!(SillyTavern.getContext() as any).streamingProcessor || document.body?.dataset?.generating === 'true',
            },
            chat: scannedChat,
            chatLength: globalContext.chat.length,
            maxContext: st_getMaxContextSize(),
            scanData: buildWorldInfoScanData(context, characterId),
            restrictTo,
          }),
        // Only chat completion has a World Info format; text completion put World Info in the story string unwrapped.
        wrapIncludeAll: (text) =>
          apiMap.selected === 'textgenerationwebui'
            ? text
            : st_formatWorldInfo(text, {
                wiFormat: (context.getPresetManager?.('openai') as any)?.getCompletionPresetByName?.(promptPresetSelections.presetName)?.wi_format,
              }),
      });
      worldInfo = built.report;
      const worldInfoText = built.text;
      if (worldInfoText) {
        const firstNonSystem = messages.findIndex((m: any) => m.role !== 'system');
        const insertAt = firstNonSystem === -1 ? messages.length : firstNonSystem;
        messages.splice(insertAt, 0, { role: 'system', content: worldInfoText } as Message);
        debugLog(settingsManager, 'world info injected', {
          mode: trackerWorldInfoMode,
          insertAt,
          injectedLength: worldInfoText.length,
          preview: worldInfoText.slice(0, 200),
        });
      } else {
        debugLog(settingsManager, 'world info produced no text', { mode: trackerWorldInfoMode });
      }
    } catch (e) {
      console.warn('zTracker: failed to build World Info; proceeding without it.', e);
    }

    // Text-completion prompt assembly can consume saved sysprompt presets directly.
    // Chat-completion paths still need the tracker prompt injected as a standalone system message.
    if (savedSystemPromptContent && apiMap.selected !== 'textgenerationwebui') {
      messages = insertSystemPromptMessage(messages, savedSystemPromptContent);
    }

    return {
      message,
      settings,
      resolvedConnection,
      schemaPresetKey,
      chatJsonValue,
      chatHtmlValue,
      messages,
      worldInfo,
    };
  }

  function clearDefaultModuleMirror(extensionData: Record<string, any>): void {
    for (const key of [
      CHAT_MESSAGE_SCHEMA_PRESET_KEY,
      CHAT_MESSAGE_SCHEMA_VALUE_KEY,
      CHAT_MESSAGE_SCHEMA_HTML_KEY,
      CHAT_MESSAGE_PARTS_ORDER_KEY,
      TRACKER_PARTS_META_KEY,
      CHAT_MESSAGE_PENDING_REDACTIONS_KEY,
    ]) {
      delete extensionData[key];
    }
  }

  async function deleteTracker(messageId: number, moduleId = DEFAULT_MODULE_ID) {
    const message = globalContext.chat[messageId];
    const trackerRecord = getTrackerModuleRecord(message, moduleId);
    if (!trackerRecord) return;

    const confirm = await globalContext.Popup.show.confirm(
      'Delete Tracker',
      'Are you sure you want to delete the tracker data for this message? This cannot be undone.',
    );

    if (confirm) {
      const extensionData = message.extra?.[EXTENSION_KEY] as Record<string, any> | undefined;
      delete extensionData?.[TRACKER_MODULE_RECORDS_KEY]?.[moduleId];
      if (extensionData && moduleId === DEFAULT_MODULE_ID) {
        clearDefaultModuleMirror(extensionData);
      }
      await globalContext.saveChat();
      renderTrackerWithDeps(messageId, moduleId);
      st_echo('success', 'Tracker data deleted.');
    }
  }

  /** Opens the "World Info used" popup for one Module's stored record ("not recorded" when there is none). */
  async function showWorldInfoReport(messageId: number, moduleId = DEFAULT_MODULE_ID) {
    const record = getTrackerModuleRecord(globalContext.chat[messageId], moduleId);
    await globalContext.callGenericPopup(buildWorldInfoReportElement(record?.[WORLD_INFO_RECORD_KEY]), POPUP_TYPE.TEXT, '', {
      okButton: 'Close',
      wide: true,
    });
  }

  async function editTracker(messageId: number, moduleId = DEFAULT_MODULE_ID) {
    const message = globalContext.chat[messageId];
    const trackerRecord = getTrackerModuleRecord(message, moduleId);
    if (!trackerRecord?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY]) return;

    const currentData = trackerRecord[CHAT_MESSAGE_SCHEMA_VALUE_KEY];
    const trackerHtml = trackerRecord[CHAT_MESSAGE_SCHEMA_HTML_KEY];

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
                moduleId,
                trackerData: newData,
                trackerHtml,
                render: () => renderTrackerWithDeps(messageId, moduleId),
              });
              restoreDetailsState(messageId, detailsState);
            } catch (e) {
              console.error('Error validating updated tracker data:', e);
              renderTrackerWithDeps(messageId, moduleId);
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
              renderTrackerWithDeps(messageId, moduleId);
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
    const moduleId = options?.moduleId ?? DEFAULT_MODULE_ID;
    if (cancelIfPending(id, moduleId)) return false;

    debugLog(settingsManager, 'generateTracker start', {
      mesId: id,
      mode: getSettingsForTrackerModule(settingsManager.getSettings(), moduleId).promptEngineeringMode,
    });

    const messageBlock = document.querySelector(`.mes[mesid="${id}"]`);
    const mainButton = messageBlock?.querySelector('.mes_ztracker_button');
    const regenerateButton = findRenderedModuleBlock(messageBlock, moduleId)?.querySelector('.ztracker-regenerate-button');
    const detailsState = captureDetailsState(id);
    const token = { cancelled: false };
    const runKey = makeTrackerRunKey(id, moduleId);
    let activeSchemaPresetLabel: string | undefined;

    pendingSequences.set(runKey, token);

    try {
      mainButton?.classList.add('spinning');
      regenerateButton?.classList.add('spinning');

      return await runWithFullTrackerStatusIndicator(id, options, async (progress) => {
        const {
          message,
          settings,
          resolvedConnection,
          schemaPresetKey,
          chatJsonValue,
          chatHtmlValue,
          messages,
          worldInfo,
        } = await prepareTrackerGeneration(id, { moduleId });
        if (token.cancelled) {
          return false;
        }
        activeSchemaPresetLabel = settings.schemaPresets[schemaPresetKey]?.name ?? schemaPresetKey;

        const { partsOrder, partsMeta } = getSchemaRenderMetadata(chatJsonValue);
        const makeRequest = makeRequestFactory(id, settings, {
          resolvedConnection,
          moduleId,
          moduleName: getModuleDebugName(moduleId),
        });
        progress.setPhase(WAITING_FOR_MODEL_PHASE);
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
          moduleId,
          message,
          schemaPresetKey,
          trackerData: response,
          trackerHtml: chatHtmlValue,
          partsOrder,
          partsMeta,
          detailsState,
          extensionData: {
            ...buildPendingRedactionExtensionData(message, { moduleId, clearAll: true }),
            [WORLD_INFO_RECORD_KEY]: worldInfo,
          },
        });
        return true;
      });
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error generating tracker:', error);
        st_echo('error', `Tracker generation failed: ${formatTrackerGenerationErrorMessage(error, activeSchemaPresetLabel)}`);
      }
      return false;
    } finally {
      pendingSequences.delete(runKey);
      mainButton?.classList.remove('spinning');
      regenerateButton?.classList.remove('spinning');
    }
  }

  async function generateTrackerSequential(id: number, options?: GenerateTrackerOptions) {
    const moduleId = options?.moduleId ?? DEFAULT_MODULE_ID;
    if (cancelIfPending(id, moduleId)) return false;
    const messageBlock = document.querySelector(`.mes[mesid="${id}"]`);
    const mainButton = messageBlock?.querySelector('.mes_ztracker_button');
    const regenerateButton = findRenderedModuleBlock(messageBlock, moduleId)?.querySelector('.ztracker-regenerate-button');
    const detailsState = captureDetailsState(id);
    let activeSchemaPresetLabel: string | undefined;

    const token = { cancelled: false };
  const runKey = makeTrackerRunKey(id, moduleId);
  pendingSequences.set(runKey, token);

    try {
      mainButton?.classList.add('spinning');
      regenerateButton?.classList.add('spinning');

      return await runWithFullTrackerStatusIndicator(id, options, async (progress) => {
        const {
          message,
          settings,
          resolvedConnection,
          schemaPresetKey,
          chatJsonValue,
          chatHtmlValue,
          messages,
          worldInfo,
        } = await prepareTrackerGeneration(id, { moduleId });
        if (token.cancelled) {
          return false;
        }
        activeSchemaPresetLabel = settings.schemaPresets[schemaPresetKey]?.name ?? schemaPresetKey;

        const { partsOrder, partsMeta } = getSchemaRenderMetadata(chatJsonValue);
        if (partsOrder.length === 0) {
          throw new Error('Schema has no top-level properties to generate.');
        }

        const makeRequest = makeRequestFactory(id, settings, {
          resolvedConnection,
          moduleId,
          moduleName: getModuleDebugName(moduleId),
        });
        const baseMessages = structuredClone(messages) as Message[];
        let trackerData: any = {};

        for (const [partIndex, partKey] of partsOrder.entries()) {
          if (token.cancelled) break;

          progress.setPart(`part ${partIndex + 1}/${partsOrder.length}`);
          progress.setPhase(WAITING_FOR_MODEL_PHASE);
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
          moduleId,
          message,
          schemaPresetKey,
          trackerData,
          trackerHtml: chatHtmlValue,
          partsOrder,
          partsMeta,
          detailsState,
          extensionData: {
            ...buildPendingRedactionExtensionData(message, { moduleId, clearAll: true }),
            [WORLD_INFO_RECORD_KEY]: worldInfo,
          },
        });
        return true;
      });
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const displayMessage = formatTrackerGenerationErrorMessage(error, activeSchemaPresetLabel);
        console.error('Error generating tracker (sequential):', error);
        st_echo('error', `Tracker generation failed: ${displayMessage}`);
      }
      return false;
    } finally {
      pendingSequences.delete(runKey);
      mainButton?.classList.remove('spinning');
      regenerateButton?.classList.remove('spinning');
    }
  }

  /** Dispatches full tracker generation while enforcing the shared skip-first-messages guard for manual and auto flows. */
  async function generateTracker(id: number, options?: GenerateTrackerOptions) {
    const moduleId = options?.moduleId ?? DEFAULT_MODULE_ID;
    const settings = getSettingsForTrackerModule(settingsManager.getSettings(), moduleId);
    const shouldRespectSkipFirstMessages = options?.silent || !hasStoredTracker(id, moduleId);
    if (shouldRespectSkipFirstMessages && shouldSkipTrackerGeneration(id, settings, (message) => st_echo('info', message), options?.silent)) {
      return false;
    }

    if (settings.sequentialPartGeneration) {
      return generateTrackerSequential(id, { ...options, moduleId });
    }
    return generateTrackerFull(id, { ...options, moduleId });
  }

  async function generateTrackersForMessage(id: number, options?: GenerateTrackersForMessageOptions) {
    const moduleIds = options?.moduleIds ? new Set(options.moduleIds) : undefined;
    // When the caller supplies an explicit moduleIds set, trust it completely rather than
    // re-filtering by module.auto.enabled: callers with per-character context (e.g. auto-mode
    // dispatch in src/ui/ui-init.ts) may have already resolved a Module as due via a
    // per-character "on" override even though that Module's global auto.enabled is false, and
    // re-applying a global-only autoOnly filter here would incorrectly drop it again.
    const modules = getOrderedTrackerModules(settingsManager.getSettings())
      .filter((module) => (moduleIds ? moduleIds.has(module.id) : !options?.autoOnly || module.auto.enabled));

    let allSucceeded = true;
    const trigger: TriggerToken = { cancelled: false };
    for (const [index, module] of modules.entries()) {
      if (trigger.cancelled) {
        return false;
      }

      const succeeded = await generateTracker(id, {
        silent: options?.silent,
        ownedByHold: options?.ownedByHold,
        moduleId: module.id,
        trigger,
        moduleStep: modules.length > 1 ? `module ${index + 1}/${modules.length}` : undefined,
      });
      allSucceeded = allSucceeded && succeeded;
    }

    return allSucceeded;
  }

  async function clearTrackerTargetsOnly(messageId: number, targets: TrackerCleanupTarget[], moduleId = DEFAULT_MODULE_ID): Promise<TrackerCleanupTarget[]> {
    const normalizedTargets = normalizeTrackerCleanupTargets(targets);
    if (normalizedTargets.length === 0) {
      return [];
    }

    const { message, schemaPresetKey, currentTracker, chatJsonValue, trackerHtml, partsOrder, partsMeta, pendingTargets } =
      getTrackerSchemaAndRenderState(messageId, moduleId);
    const detailsState = captureDetailsState(messageId);
    const nextTracker = clearTrackerCleanupTargets(currentTracker, chatJsonValue, normalizedTargets);
    const nextPending = buildPendingRedactions([...pendingTargets, ...normalizedTargets], { schemaPresetKey });

    await persistTrackerUpdate({
      messageId,
      moduleId,
      message,
      schemaPresetKey,
      trackerData: nextTracker,
      trackerHtml,
      partsOrder,
      partsMeta,
      detailsState,
      successMessage: `Cleared ${normalizedTargets.length} tracker ${normalizedTargets.length === 1 ? 'target' : 'targets'}.`,
      extensionData: buildPendingRedactionExtensionData(message, { moduleId, nextPending }),
    });

    return normalizedTargets;
  }

  async function clearAndRecreateTrackerTargets(messageId: number, targets: TrackerCleanupTarget[], moduleId = DEFAULT_MODULE_ID): Promise<void> {
    const normalizedTargets = await clearTrackerTargetsOnly(messageId, targets, moduleId);
    if (normalizedTargets.length === 0) {
      return;
    }

    const settings = getSettingsForTrackerModule(settingsManager.getSettings(), moduleId);
    const { schemaPresetKey: messageSchemaPresetKey } = getTrackerSchemaAndRenderState(messageId, moduleId);
    notifyIfExistingTrackerUsesOlderSchema(settings, messageSchemaPresetKey, moduleId);

    let successCount = 0;
    for (const target of sortCleanupTargets(normalizedTargets)) {
      if (await recreateCleanupTarget(messageId, target, moduleId)) {
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

  async function openTrackerCleanup(messageId: number, moduleId = DEFAULT_MODULE_ID) {
    const { currentTracker, chatJsonValue, partsOrder, partsMeta, pendingTargets } = getTrackerSchemaAndRenderState(messageId, moduleId);
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
          await clearTrackerTargetsOnly(messageId, normalizedTargets, moduleId);
          return;
        }

        await clearAndRecreateTrackerTargets(messageId, normalizedTargets, moduleId);
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
    const settings = getSettingsForTrackerModule(settingsManager.getSettings(), DEFAULT_MODULE_ID);
    const context = SillyTavern.getContext();
    const chatMetadata = context.chatMetadata;
    const { schemaPresetKey: currentPresetKey } = resolveSchemaPreset(
      settings,
      readModuleChatSchemaPresetKey(chatMetadata),
    );
    if (readModuleChatSchemaPresetKey(chatMetadata) !== currentPresetKey) {
      writeModuleChatSchemaPresetKey(chatMetadata, currentPresetKey);
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
              writeModuleChatSchemaPresetKey(chatMetadata, newPresetKey);
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
    ...createLorebookActions({ globalContext, settingsManager, renderTrackerWithDeps, requestWithActiveConnection, getActiveConnectionLabel }),
    cancelTracker,
    deleteTracker,
    editTracker,
    showWorldInfoReport,
    generateTracker,
    generateTrackersForMessage,
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
    testGrammarSchemaEnforcement,
    requestWithActiveConnection,
    getActiveConnectionLabel,
    /** Lets outgoing auto mode tag zTracker-owned request starts without affecting manual generation flows. */
    setBeforeRequestStartHook(callback?: () => void) {
      beforeRequestStartHook = callback;
    },
  };
}

export type TrackerActions = ReturnType<typeof createTrackerActions>;
