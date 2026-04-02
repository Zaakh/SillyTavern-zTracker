import { DEFAULT_EMBED_SNAPSHOT_HEADER } from '../config.js';
import type { ExtensionSettings } from '../config.js';
import type { ExtensionSettingsManager } from 'sillytavern-utils-lib';

export type PromptDebugMessage = {
  role: string;
  content: string;
  name?: string;
  ignoreInstruct?: boolean;
};

export type TrackerRequestDebugSnapshot = {
  capturedAt: string;
  messageId: number;
  profileId: string;
  promptEngineeringMode: string;
  maxTokens: number;
  embedSnapshotHeader: string;
  overridePayload: unknown;
  requestMessages: PromptDebugMessage[];
  sanitizedPrompt: PromptDebugMessage[];
  flattenedRequestMessages: string;
  flattenedSanitizedPrompt: string;
};

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
  const name = typeof message.name === 'string' && message.name.trim()
    ? message.name
    : typeof message.source?.name === 'string' && message.source.name.trim()
      ? message.source.name
      : undefined;

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

export function captureTrackerRequestDebugSnapshot(
  settingsManager: ExtensionSettingsManager<ExtensionSettings>,
  snapshot: {
    messageId: number;
    profileId: string;
    promptEngineeringMode: string;
    maxTokens: number;
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
    profileId: snapshot.profileId,
    promptEngineeringMode: snapshot.promptEngineeringMode,
    maxTokens: snapshot.maxTokens,
    embedSnapshotHeader: settings.embedZTrackerSnapshotHeader ?? DEFAULT_EMBED_SNAPSHOT_HEADER,
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
    `profileId: ${snapshot.profileId}`,
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
