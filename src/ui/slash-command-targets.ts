import type { ExtensionSettings, TrackerModule } from '../config.js';
import { getOrderedTrackerModules } from '../config.js';
import { st_echo } from 'sillytavern-utils-lib/config';
import type { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import { CHAT_MESSAGE_SCHEMA_VALUE_KEY, getTrackerModuleRecord } from '../tracker.js';
import type { TrackerActions } from './tracker-actions.js';

/**
 * Shares the target/argument resolution used by zTracker's slash commands so the command
 * definitions stay focused on host wiring. Nothing here touches the host parser directly.
 */

/** Describes the runtime dependencies zTracker's slash commands need from the host. */
export type SlashCommandRuntime = {
  globalContext: any;
  settingsManager: ExtensionSettingsManager<ExtensionSettings>;
  actions: Pick<TrackerActions, 'generateTracker' | 'generateTrackersForMessage' | 'deleteTracker'>;
};

/** Describes one resolved slash-command target: which chat, which message, which Modules. */
type TrackerCommandTarget = {
  chat: Array<{ extra?: Record<string, any> }>;
  messageId: number;
  modules: TrackerModule[];
};

/** Describes one resolved chat message for a slash command. */
type TrackerCommandMessage = {
  chat: Array<{ extra?: Record<string, any> }>;
  messageId: number;
  message: { extra?: Record<string, any> } | undefined;
};

/** Parses one slash-command boolean argument that is false when omitted. */
export function isTrueTrackerArgument(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'string') {
    return false;
  }
  return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/** Resolves the message a tracker command targets; blank input means the last message in the chat. */
export function parseTrackerTargetMessageId(value: unknown, chatLength: number): number | null {
  if (chatLength <= 0) {
    return null;
  }

  const text = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  if (!text) {
    return chatLength - 1;
  }
  if (!/^\d+$/.test(text)) {
    return null;
  }

  const messageId = Number(text);
  return Number.isSafeInteger(messageId) && messageId >= 0 && messageId < chatLength ? messageId : null;
}

/** Resolves the Modules a tracker command should act on, reporting ids the chat's settings do not define. */
export function resolveTrackerCommandModules(options: {
  settings: ExtensionSettings;
  requestedModuleId?: unknown;
}): { modules: TrackerModule[]; unknownModuleId?: string } {
  const requested = typeof options.requestedModuleId === 'string' ? options.requestedModuleId.trim() : '';
  if (!requested) {
    return { modules: getOrderedTrackerModules(options.settings) };
  }

  // An explicitly requested Module is honored even while its global `enabled` flag is off.
  const requestedModule = getOrderedTrackerModules(options.settings, { includeDisabled: true })
    .find((module) => module.id === requested);
  return requestedModule ? { modules: [requestedModule] } : { modules: [], unknownModuleId: requested };
}

/**
 * Resolves the Modules a delete command should clear: an explicitly requested Module, or - when none
 * is requested - every Module that actually has stored tracker data on the message (disabled Modules
 * included), so a single delete can clean up data left behind by a since-disabled Module.
 */
export function resolveTrackerDeleteModules(options: {
  settings: ExtensionSettings;
  message: { extra?: Record<string, any> } | undefined;
  requestedModuleId?: unknown;
}): { modules: TrackerModule[]; unknownModuleId?: string } {
  const requested = typeof options.requestedModuleId === 'string' ? options.requestedModuleId.trim() : '';
  const allModules = getOrderedTrackerModules(options.settings, { includeDisabled: true });
  if (requested) {
    const requestedModule = allModules.find((module) => module.id === requested);
    return requestedModule ? { modules: [requestedModule] } : { modules: [], unknownModuleId: requested };
  }

  return { modules: allModules.filter((module) => hasTrackerValue(options.message, module.id)) };
}

/** Mirrors the extension's stored-tracker presence check for one message and Module. */
export function hasTrackerValue(message: { extra?: Record<string, any> } | undefined, moduleId: string): boolean {
  return Boolean(getTrackerModuleRecord(message, moduleId)?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY]);
}

/** Keeps command toasts short by labeling Modules with their user-facing name. */
export function getModuleLabel(module: TrackerModule): string {
  return module.name?.trim() || module.id;
}

/** Resolves the shared chat and message target for a tracker command, or notifies and returns null. */
export function resolveTrackerCommandMessage(options: {
  runtime: SlashCommandRuntime;
  rawMessageId: unknown;
}): TrackerCommandMessage | null {
  const chat = options.runtime.globalContext?.chat;
  if (!Array.isArray(chat) || chat.length === 0) {
    st_echo('error', 'zTracker: there is no chat message to target.');
    return null;
  }

  const messageId = parseTrackerTargetMessageId(options.rawMessageId, chat.length);
  if (messageId === null) {
    st_echo('error', buildMessageIndexError(options.rawMessageId, chat.length));
    return null;
  }

  return { chat, messageId, message: chat[messageId] };
}

/** Resolves the message and Module target for a tracker command, or notifies and returns null. */
export function resolveTrackerCommandTarget(options: {
  runtime: SlashCommandRuntime;
  rawMessageId: unknown;
  rawModuleId: unknown;
}): TrackerCommandTarget | null {
  const target = resolveTrackerCommandMessage(options);
  if (!target) {
    return null;
  }

  const { modules, unknownModuleId } = resolveTrackerCommandModules({
    settings: options.runtime.settingsManager.getSettings(),
    requestedModuleId: options.rawModuleId,
  });
  if (unknownModuleId) {
    st_echo('error', `zTracker: no Module with id "${unknownModuleId}".`);
    return null;
  }
  if (modules.length === 0) {
    st_echo('error', 'zTracker: no Modules are enabled. Enable a Module or pass module=<id>.');
    return null;
  }

  return { chat: target.chat, messageId: target.messageId, modules };
}

/**
 * Builds the invalid-message-index error, adding a syntax hint when the argument looks like a named
 * argument typed in the wrong place (or with dashes), which is the most common way to mistype these
 * commands in SillyTavern's `name=value` slash-command syntax.
 */
function buildMessageIndexError(rawValue: unknown, chatLength: number): string {
  const base = `zTracker: message index must be a whole number between 0 and ${chatLength - 1}.`;
  const text = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (text.startsWith('-') || text.includes('=')) {
    return `${base} Named arguments use name=value without dashes and must come first, for example "/ztracker-check module=<module id> 0".`;
  }
  return base;
}

/** Builds the shared `module=<id>` argument, including autocomplete for every configured Module. */
export function buildModuleArgument(runtime: SlashCommandRuntime) {
  return runtime.globalContext.SlashCommandNamedArgument.fromProps({
    name: 'module',
    description: 'Module id to target. Defaults to every enabled Module.',
    typeList: [runtime.globalContext.ARGUMENT_TYPE.STRING],
    enumProvider: () =>
      getOrderedTrackerModules(runtime.settingsManager.getSettings(), { includeDisabled: true })
        .map((module) => new runtime.globalContext.SlashCommandEnumValue(module.id, getModuleLabel(module))),
  });
}

/** Builds the shared `silent=<true|false>` argument that keeps commands script-friendly. */
export function buildSilentArgument(runtime: SlashCommandRuntime) {
  return runtime.globalContext.SlashCommandNamedArgument.fromProps({
    name: 'silent',
    description: 'Suppress all command toasts and the message-local progress badge.',
    typeList: [runtime.globalContext.ARGUMENT_TYPE.BOOLEAN],
    defaultValue: 'false',
  });
}

/** Builds the shared message-index argument for the per-message tracker commands. */
export function buildMessageArgument(runtime: SlashCommandRuntime, description: string) {
  return runtime.globalContext.SlashCommandArgument.fromProps({
    description,
    typeList: [runtime.globalContext.ARGUMENT_TYPE.NUMBER],
  });
}
