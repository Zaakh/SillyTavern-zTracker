import Handlebars from 'handlebars';
import type { Message } from 'sillytavern-utils-lib';
import type { ChatMessage } from 'sillytavern-utils-lib/types';
import type { ExtensionSettings } from './config.js';
import { EXTENSION_KEY } from './extension-metadata.js';
import { formatEmbeddedTrackerSnapshot } from './embed-snapshot-transform.js';

export const CHAT_METADATA_SCHEMA_PRESET_KEY = 'schemaKey';
export const CHAT_MESSAGE_SCHEMA_VALUE_KEY = 'value';
export const CHAT_MESSAGE_SCHEMA_HTML_KEY = 'html';

export interface TrackerContext {
  chat: Array<ChatMessage & { extra?: Record<string, any> }>;
}

export interface RenderTrackerOptions {
  context: TrackerContext;
  document?: Document;
  handlebars?: typeof Handlebars;
}

export function renderTracker(messageId: number, options: RenderTrackerOptions): void {
  const { context } = options;
  const doc = options.document ?? globalThis.document;
  const hb = options.handlebars ?? Handlebars;

  if (!context) {
    throw new Error('renderTracker: context is required');
  }
  if (!doc) {
    throw new Error('renderTracker: document is required');
  }
  if (!hb) {
    throw new Error('renderTracker: Handlebars reference is required');
  }

  const message = context.chat?.[messageId];
  const messageBlock = doc.querySelector(`.mes[mesid="${messageId}"]`);
  messageBlock?.querySelector('.mes_ztracker')?.remove();

  if (!message?.extra?.[EXTENSION_KEY]) {
    return;
  }

  const trackerData = message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_VALUE_KEY];
  const trackerHtmlSchema = message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_HTML_KEY];
  if (!trackerData || !trackerHtmlSchema) {
    return;
  }

  if (!messageBlock) {
    return;
  }

  const template = hb.compile(trackerHtmlSchema, { noEscape: true, strict: true });
  const renderedHtml = template({ data: trackerData });
  const container = doc.createElement('div');
  container.className = 'mes_ztracker';
  container.innerHTML = renderedHtml;

  const controls = doc.createElement('div');
  controls.className = 'ztracker-controls';
  controls.innerHTML = `
    <div class="ztracker-regenerate-button fa-solid fa-arrows-rotate" title="Regenerate Tracker"></div>
    <div class="ztracker-edit-button fa-solid fa-code" title="Edit Tracker Data"></div>
    <div class="ztracker-delete-button fa-solid fa-trash-can" title="Delete Tracker"></div>
  `;
  container.prepend(controls);

  messageBlock.querySelector('.mes_text')?.before(container);
}

export function includeZTrackerMessages<T extends Message | ChatMessage>(
  messages: T[],
  settings: ExtensionSettings,
  userName = 'You',
): T[] {
  const copyMessages = structuredClone(messages);
  const embedRole = settings.embedZTrackerRole ?? 'user';

  if (settings.includeLastXZTrackerMessages > 0) {
    for (let i = 0; i < settings.includeLastXZTrackerMessages; i++) {
      let foundMessage: T | null = null;
      let foundIndex = -1;
      for (let j = copyMessages.length - 2; j >= 0; j--) {
        const message = copyMessages[j];
        const extra = 'source' in message ? (message as Message).source?.extra : (message as ChatMessage).extra;
        // @ts-ignore - we avoid mutating the original object across include iterations
        if (!message.zTrackerFound && extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY]) {
          // @ts-ignore - mark so we do not reuse the same tracker entry twice
          message.zTrackerFound = true;
          foundMessage = message;
          foundIndex = j;
          break;
        }
      }
      if (foundMessage) {
        const extra =
          'source' in foundMessage
            ? (foundMessage as Message).source?.extra
            : (foundMessage as ChatMessage).extra;
        const trackerValue = extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY] || {};
        const { lang, text, wrapInCodeFence } = formatEmbeddedTrackerSnapshot(trackerValue, settings);

        const header = settings.embedZTrackerSnapshotHeader ?? 'Tracker:';
        const prefix = header ? `${header}\n` : '';
        const content = wrapInCodeFence
          ? `${prefix}\`\`\`${lang}\n${text}\n\`\`\``
          : `${prefix}${text}`;
        copyMessages.splice(
          foundIndex + 1,
          0,
          {
            content,
            role: embedRole,
            ...(embedRole === 'user' ? { name: userName } : {}),
            // These flags are used by SillyTavern Message objects; harmless for ChatMessage.
            is_user: embedRole === 'user',
            is_system: embedRole === 'system',
            mes: content,
          } as unknown as T,
        );
      }
    }
  }
  return copyMessages;
}

export interface ApplyTrackerUpdateOptions {
  trackerData: unknown;
  trackerHtml: string;
  render: () => void;
}

/**
 * Applies a tracker update to a message and attempts to render it.
 *
 * If rendering throws, the message is rolled back to the prior state (if any).
 * This is used to enforce "fail fast" behavior for strict templates.
 */
export function applyTrackerUpdateAndRender(
  message: { extra?: Record<string, any> } | undefined,
  options: ApplyTrackerUpdateOptions,
): void {
  if (!message) {
    throw new Error('applyTrackerUpdateAndRender: message is required');
  }
  if (!options?.render) {
    throw new Error('applyTrackerUpdateAndRender: render callback is required');
  }

  const hadExisting = !!message.extra?.[EXTENSION_KEY];
  const previousValue = hadExisting ? structuredClone(message.extra?.[EXTENSION_KEY]) : undefined;

  message.extra = message.extra || {};
  message.extra[EXTENSION_KEY] = message.extra[EXTENSION_KEY] || {};
  message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_VALUE_KEY] = options.trackerData;
  message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_HTML_KEY] = options.trackerHtml;

  try {
    options.render();
  } catch (error) {
    if (hadExisting) {
      message.extra[EXTENSION_KEY] = previousValue;
    } else {
      delete message.extra[EXTENSION_KEY];
    }
    throw error;
  }
}
