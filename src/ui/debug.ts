import { DEFAULT_EMBED_SNAPSHOT_HEADER } from '../config.js';
import type { ExtensionSettings } from '../config.js';
import type { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import { normalizePromptSpeakerName } from '../tracker.js';

export type PromptDebugMessage = {
  role: string;
  content: string;
  name?: string;
  ignoreInstruct?: boolean;
};

export type TrackerRequestDebugSnapshot = {
  capturedAt: string;
  messageId: number;
  moduleId?: string;
  moduleName?: string;
  connectionSource: 'active' | 'saved';
  profileId: string;
  api?: string;
  apiType?: string;
  model?: string;
  apiServer?: string;
  presetName?: string;
  instructName?: string;
  contextName?: string;
  syspromptName?: string;
  /** Where the effective settings came from and which profile fields fell back to live values. */
  settingsSource?: 'profile' | 'live';
  fallbackFields?: string[];
  instructEnabled?: boolean;
  /** Start Reply With exactly as sent; `omitted` marks a prefill dropped because it would leave reasoning open. */
  startReplyWith?: string;
  startReplyWithOmitted?: boolean;
  reasoningTemplateName?: string;
  promptEngineeringMode: string;
  maxTokens: number;
  embedSnapshotHeader: string;
  overridePayload: unknown;
  requestMessages: PromptDebugMessage[];
  sanitizedPrompt: PromptDebugMessage[];
  flattenedRequestMessages: string;
  flattenedSanitizedPrompt: string;
};

const CONNECTION_DEBUG_FIELD_KEYS = [
  'api',
  'apiType',
  'model',
  'apiServer',
  'presetName',
  'instructName',
  'contextName',
  'syspromptName',
] as const;

type ConnectionDebugFieldKey = (typeof CONNECTION_DEBUG_FIELD_KEYS)[number];

type ConnectionDebugFields = Pick<TrackerRequestDebugSnapshot, ConnectionDebugFieldKey>;

type ZTrackerDiagnosticsState = {
  templateChecks?: unknown;
  lastTrackerRequest?: TrackerRequestDebugSnapshot;
};

function getDiagnosticsState(): ZTrackerDiagnosticsState {
  const globalValue = globalThis as typeof globalThis & { zTrackerDiagnostics?: ZTrackerDiagnosticsState };
  globalValue.zTrackerDiagnostics ??= {};
  return globalValue.zTrackerDiagnostics;
}

function toPromptDebugMessage(message: {
  role: string;
  content: string;
  name?: string;
  ignoreInstruct?: boolean;
  source?: { name?: string };
}): PromptDebugMessage {
  const name = normalizePromptSpeakerName(message.name) ?? normalizePromptSpeakerName(message.source?.name);

  return {
    role: message.role,
    content: message.content,
    ...(name ? { name } : {}),
    ...(typeof message.ignoreInstruct === 'boolean' ? { ignoreInstruct: message.ignoreInstruct } : {}),
  };
}

function flattenPromptDebugMessages(messages: PromptDebugMessage[]): string {
  return messages
    .map((message) => {
      if (typeof message.name === 'string' && message.name.trim()) {
        return `${message.name}: ${String(message.content)}`;
      }
      return String(message.content);
    })
    .join('\n\n');
}

function pickConnectionDebugFields(snapshot: ConnectionDebugFields): Partial<ConnectionDebugFields> {
  return Object.fromEntries(
    CONNECTION_DEBUG_FIELD_KEYS.flatMap((key) => {
      const value = snapshot[key];
      return value ? [[key, value]] : [];
    }),
  ) as Partial<ConnectionDebugFields>;
}

function formatConnectionDebugFields(snapshot: Partial<ConnectionDebugFields>): string[] {
  return CONNECTION_DEBUG_FIELD_KEYS.flatMap((key) => {
    const value = snapshot[key];
    return value ? [`${key}: ${value}`] : [];
  });
}

export function captureTrackerRequestDebugSnapshot(
  settingsManager: ExtensionSettingsManager<ExtensionSettings>,
  snapshot: {
    messageId: number;
    moduleId?: string;
    moduleName?: string;
    connectionSource: 'active' | 'saved';
    profileId: string;
    api?: string;
    apiType?: string;
    model?: string;
    apiServer?: string;
    presetName?: string;
    instructName?: string;
    contextName?: string;
    syspromptName?: string;
    settingsSource?: 'profile' | 'live';
    fallbackFields?: string[];
    instructEnabled?: boolean;
    startReplyWith?: string;
    startReplyWithOmitted?: boolean;
    reasoningTemplateName?: string;
    promptEngineeringMode: string;
    maxTokens: number;
    embedSnapshotHeader?: string;
    overridePayload: unknown;
    requestMessages: Array<{ role: string; content: string; name?: string; ignoreInstruct?: boolean; source?: { name?: string } }>;
    sanitizedPrompt: Array<{ role: string; content: string; name?: string; ignoreInstruct?: boolean; source?: { name?: string } }>;
  },
): void {
  const settings = settingsManager.getSettings();
  if (!settings.debugLogging) {
    return;
  }

  const requestMessages = snapshot.requestMessages.map((message) => toPromptDebugMessage(message));
  const sanitizedPrompt = snapshot.sanitizedPrompt.map((message) => toPromptDebugMessage(message));
  const debugSnapshot: TrackerRequestDebugSnapshot = {
    capturedAt: new Date().toISOString(),
    messageId: snapshot.messageId,
    ...(snapshot.moduleId ? { moduleId: snapshot.moduleId } : {}),
    ...(snapshot.moduleName ? { moduleName: snapshot.moduleName } : {}),
    connectionSource: snapshot.connectionSource,
    profileId: snapshot.profileId,
    ...pickConnectionDebugFields(snapshot),
    ...(snapshot.settingsSource ? { settingsSource: snapshot.settingsSource } : {}),
    ...(snapshot.fallbackFields ? { fallbackFields: snapshot.fallbackFields } : {}),
    ...(snapshot.instructEnabled !== undefined ? { instructEnabled: snapshot.instructEnabled } : {}),
    ...(snapshot.startReplyWith !== undefined ? { startReplyWith: snapshot.startReplyWith } : {}),
    ...(snapshot.startReplyWithOmitted ? { startReplyWithOmitted: true } : {}),
    ...(snapshot.reasoningTemplateName ? { reasoningTemplateName: snapshot.reasoningTemplateName } : {}),
    promptEngineeringMode: snapshot.promptEngineeringMode,
    maxTokens: snapshot.maxTokens,
    embedSnapshotHeader: snapshot.embedSnapshotHeader ?? DEFAULT_EMBED_SNAPSHOT_HEADER,
    overridePayload: snapshot.overridePayload,
    requestMessages,
    sanitizedPrompt,
    flattenedRequestMessages: flattenPromptDebugMessages(requestMessages),
    flattenedSanitizedPrompt: flattenPromptDebugMessages(sanitizedPrompt),
  };

  getDiagnosticsState().lastTrackerRequest = debugSnapshot;
  debugLog(settingsManager, 'last tracker request snapshot', debugSnapshot);
}

export function formatTrackerRequestDebugSnapshot(snapshot?: TrackerRequestDebugSnapshot): string[] {
  if (!snapshot) {
    return ['lastTrackerRequest: unavailable'];
  }

  return [
    'lastTrackerRequest:',
    `capturedAt: ${snapshot.capturedAt}`,
    `messageId: ${snapshot.messageId}`,
    ...(snapshot.moduleId ? [`moduleId: ${snapshot.moduleId}`] : []),
    ...(snapshot.moduleName ? [`moduleName: ${snapshot.moduleName}`] : []),
    `connectionSource: ${snapshot.connectionSource}`,
    `profileId: ${snapshot.profileId}`,
    ...formatConnectionDebugFields(snapshot),
    ...(snapshot.settingsSource ? [`settingsSource: ${snapshot.settingsSource}`] : []),
    ...(snapshot.fallbackFields ? [`fallbackFields: ${snapshot.fallbackFields.length > 0 ? snapshot.fallbackFields.join(', ') : 'none'}`] : []),
    ...(snapshot.instructEnabled !== undefined ? [`instructEnabled: ${snapshot.instructEnabled}`] : []),
    ...(snapshot.startReplyWithOmitted
      ? ['startReplyWith: omitted (would leave a reasoning block open under a structured-output schema)']
      : snapshot.startReplyWith !== undefined
        ? [`startReplyWith: ${snapshot.startReplyWith ? JSON.stringify(snapshot.startReplyWith) : 'none'}`]
        : []),
    ...(snapshot.reasoningTemplateName ? [`reasoningTemplate: ${snapshot.reasoningTemplateName}`] : []),
    `promptEngineeringMode: ${snapshot.promptEngineeringMode}`,
    `maxTokens: ${snapshot.maxTokens}`,
    `embedSnapshotHeader: ${snapshot.embedSnapshotHeader}`,
    `requestMessages: ${snapshot.requestMessages.length}`,
    `sanitizedPrompt: ${snapshot.sanitizedPrompt.length}`,
    `overridePayload: ${JSON.stringify(snapshot.overridePayload ?? {})}`,
    'note: embedSnapshotHeader is the active zTracker-injected snapshot label, not the input placeholder.',
    '',
    'flattenedRequestMessages:',
    snapshot.flattenedRequestMessages,
    '',
    'flattenedSanitizedPrompt:',
    snapshot.flattenedSanitizedPrompt,
  ];
}

export function getLastTrackerRequestDebugSnapshot(): TrackerRequestDebugSnapshot | undefined {
  return getDiagnosticsState().lastTrackerRequest;
}

export function isDebugLoggingEnabled(settingsManager: ExtensionSettingsManager<ExtensionSettings>): boolean {
  try {
    return !!settingsManager.getSettings().debugLogging;
  } catch {
    return false;
  }
}

export function debugLog(settingsManager: ExtensionSettingsManager<ExtensionSettings>, ...args: unknown[]) {
  if (!isDebugLoggingEnabled(settingsManager)) return;
  // eslint-disable-next-line no-console
  console.debug('zTracker:', ...args);
}
