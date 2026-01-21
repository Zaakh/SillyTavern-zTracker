import Handlebars from 'handlebars';
import type { Message } from 'sillytavern-utils-lib';
import type { ChatMessage } from 'sillytavern-utils-lib/types';
import type { ExtensionSettings } from './config.js';
import { EXTENSION_KEY } from './extension-metadata.js';

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
        const content = `Tracker:\n\`\`\`json\n${JSON.stringify(
          extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY] || '{}',
          null,
          2,
        )}\n\`\`\``;
        copyMessages.splice(foundIndex + 1, 0, {
          content,
          role: 'user',
          name: userName,
          is_user: true,
          mes: content,
          is_system: false,
        } as unknown as T);
      }
    }
  }
  return copyMessages;
}
