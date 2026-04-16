import type { ExtensionSettings } from './config.js';
import { DEFAULT_EMBED_SNAPSHOT_HEADER } from './config.js';
import {
  EXTENSION_KEY,
  CHAT_MESSAGE_SCHEMA_VALUE_KEY,
} from './extension-metadata.js';
import { formatEmbeddedTrackerSnapshot } from './embed-snapshot-transform.js';

type MacroTrackerMessageLike = {
  extra?: Record<string, any>;
  source?: { extra?: Record<string, any> };
};

type MacroContextLike = {
  chat?: MacroTrackerMessageLike[];
  macros?: {
    register?: (
      name: string,
      definition: {
        description?: string;
        category?: unknown;
        handler: (macroContext?: { env?: { chat?: MacroTrackerMessageLike[] } }) => string;
      },
    ) => void;
    registry?: {
      unregisterMacro?: (name: string) => void;
    };
    unregisterMacro?: (name: string) => void;
    category?: Record<string, unknown>;
  };
};

type MacroSettings = Pick<
  ExtensionSettings,
  'embedZTrackerSnapshotHeader' | 'embedZTrackerSnapshotTransformPreset' | 'embedZTrackerSnapshotTransformPresets' | 'debugLogging'
>;

type MacroSettingsGetter = () => MacroSettings;

function getMessageTrackerExtra(message: MacroTrackerMessageLike | undefined): Record<string, any> | undefined {
  if (!message) return undefined;
  return message.extra ?? message.source?.extra;
}

export function findLatestTrackerMessage(messages: MacroTrackerMessageLike[] | undefined): MacroTrackerMessageLike | undefined {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const extra = getMessageTrackerExtra(message);
    if (extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY]) {
      return message;
    }
  }

  return undefined;
}

export function buildZTrackerMacroText(messages: MacroTrackerMessageLike[] | undefined, settings: MacroSettings): string {
  const trackerMessage = findLatestTrackerMessage(messages);
  const trackerValue = trackerMessage ? getMessageTrackerExtra(trackerMessage)?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY] : undefined;

  if (!trackerValue) {
    return settings.debugLogging ? '<!-- zTracker: no tracker snapshot available -->' : '';
  }

  const { lang, text, wrapInCodeFence } = formatEmbeddedTrackerSnapshot(trackerValue, settings);
  const header = settings.embedZTrackerSnapshotHeader ?? DEFAULT_EMBED_SNAPSHOT_HEADER;
  const prefix = header ? `${header}\n` : '';

  return wrapInCodeFence ? `${prefix}\`\`\`${lang}\n${text}\n\`\`\`` : `${prefix}${text}`;
}

/** Expands any `{{zTracker}}` tags in plain prompt text before zTracker compiles or sends it. */
export function expandZTrackerMacrosInText(
  text: string,
  messages: MacroTrackerMessageLike[] | undefined,
  settings: MacroSettings,
): string {
  if (!text.includes('{{zTracker')) {
    return text;
  }

  const trackerText = buildZTrackerMacroText(messages, settings);
  return text.replace(/\{\{\s*zTracker\s*\}\}/g, trackerText);
}

function unregisterExistingMacro(macros: NonNullable<MacroContextLike['macros']>): void {
  macros.registry?.unregisterMacro?.('zTracker');
  macros.unregisterMacro?.('zTracker');
}

/** Registers the synchronous zTracker macro used for manual prompt injection. */
export function registerZTrackerMacro(getContext: () => MacroContextLike, getSettings: MacroSettingsGetter): boolean {
  const context = getContext() as any;
  const macros = context.macros;
  const settings = getSettings();

  const handler = (macroContext?: { env?: { chat?: MacroTrackerMessageLike[] } }) => {
    const chat = macroContext?.env?.chat ?? getContext().chat;
    if (settings.debugLogging) {
      console.log('[zTracker] Macro handler executed. Chat messages:', chat?.length);
    }
    return buildZTrackerMacroText(chat, settings);
  };

  // 1. Try modern API
  if (macros?.register) {
    unregisterExistingMacro(macros);
    macros.register('zTracker', {
      description: 'Returns the most recent zTracker snapshot as prompt text.',
      category: macros.category?.UTILITY,
      handler,
    });
    console.log('[zTracker] Macro {{zTracker}} registered via modern API');
    return true;
  }

  // 2. Fallback to legacy API
  if (typeof context.registerMacro === 'function') {
    context.registerMacro('zTracker', handler);
    console.log('[zTracker] Macro {{zTracker}} registered via legacy API');
    return true;
  }

  return false;
}
