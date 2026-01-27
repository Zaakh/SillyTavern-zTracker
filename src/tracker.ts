import Handlebars from 'handlebars';
import type { Message } from 'sillytavern-utils-lib';
import type { ChatMessage } from 'sillytavern-utils-lib/types';
import type { ExtensionSettings } from './config.js';
import { EXTENSION_KEY } from './extension-metadata.js';
import { formatEmbeddedTrackerSnapshot } from './embed-snapshot-transform.js';

export const CHAT_METADATA_SCHEMA_PRESET_KEY = 'schemaKey';
export const CHAT_MESSAGE_SCHEMA_VALUE_KEY = 'value';
export const CHAT_MESSAGE_SCHEMA_HTML_KEY = 'html';
export const CHAT_MESSAGE_PARTS_ORDER_KEY = 'partsOrder';
export const CHAT_MESSAGE_PARTS_META_KEY = 'partsMeta';

function escapeHtmlAttr(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function toShortLabel(value: unknown, maxLen = 28): string {
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else if (value && typeof value === 'object') {
    const name = (value as any).name;
    text = typeof name === 'string' && name.trim() ? name : '[object]';
  } else {
    text = String(value);
  }
  text = text.replaceAll('\n', ' ').trim();
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

function deriveArrayItemFieldsFallback(items: unknown[], idKey: string): string[] {
  if (!Array.isArray(items) || items.length === 0) return [];

  const fields = new Set<string>();
  const sampleCount = Math.min(items.length, 5);
  for (let i = 0; i < sampleCount; i++) {
    const it: any = items[i];
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
    for (const key of Object.keys(it)) {
      if (!key) continue;
      if (key === 'name') continue;
      if (idKey && key === idKey) continue;
      fields.add(key);
    }
  }

  return Array.from(fields).sort((a, b) => a.localeCompare(b));
}

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

  const partsOrder: string[] =
    (message.extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_PARTS_ORDER_KEY] as any) ?? Object.keys(trackerData ?? {});
  const partsMeta: Record<string, any> = (message.extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_PARTS_META_KEY] as any) ?? {};
  const partsButtons = partsOrder
    .map((k) => {
      const safeKey = escapeHtmlAttr(k);
      const value = (trackerData as any)?.[k];
      const arrayItems = Array.isArray(value)
        ? `<div class="ztracker-part-items" title="Regenerate individual items">${value
            .map((item: any, index: number) => {
              const label = escapeHtmlAttr(toShortLabel(item));
              const itemName = item && typeof item === 'object' && typeof item.name === 'string' ? item.name : '';
              const safeName = itemName ? ` data-ztracker-name="${escapeHtmlAttr(itemName)}"` : '';
              const idKey =
                typeof partsMeta?.[k]?.idKey === 'string' && partsMeta[k].idKey.trim() ? partsMeta[k].idKey.trim() : 'name';
              const idValue = item && typeof item === 'object' && typeof item[idKey] === 'string' ? item[idKey] : '';
              const safeId =
                idKey && idValue
                  ? ` data-ztracker-idkey="${escapeHtmlAttr(idKey)}" data-ztracker-idvalue="${escapeHtmlAttr(idValue)}"`
                  : '';
              const title = itemName
                ? `Regenerate ${safeKey} (${escapeHtmlAttr(itemName)})`
                : `Regenerate ${safeKey}[${index}]`;

              const fieldsFromMeta: string[] = Array.isArray(partsMeta?.[k]?.fields) ? partsMeta[k].fields : [];
              const fields: string[] =
                fieldsFromMeta.length > 0
                  ? fieldsFromMeta
                  : item && typeof item === 'object' && !Array.isArray(item)
                    ? deriveArrayItemFieldsFallback(value, idKey)
                    : [];
              const fieldButtons = fields
                .map((fieldKey: string) => {
                  const safeField = escapeHtmlAttr(fieldKey);
                  const fieldTitle = itemName
                    ? `Regenerate ${safeKey} (${escapeHtmlAttr(itemName)}).${safeField}`
                    : `Regenerate ${safeKey}[${index}].${safeField}`;
                  return `<div class="ztracker-array-item-field-regenerate-button" data-ztracker-part="${safeKey}" data-ztracker-index="${index}" data-ztracker-field="${safeField}"${safeName}${safeId} title="${fieldTitle}">${safeField}</div>`;
                })
                .join('');

              const fieldsBlock = fieldButtons ? `<div class="ztracker-array-item-fields">${fieldButtons}</div>` : '';

              return `<div class="ztracker-array-item-row">
                <div class="ztracker-array-item-regenerate-button" data-ztracker-part="${safeKey}" data-ztracker-index="${index}"${safeName}${safeId} title="${title}">${label}</div>
                ${fieldsBlock}
              </div>`;
            })
            .join('')}</div>`
        : '';

      return `<div class="ztracker-part-row">
        <div class="ztracker-part-regenerate-button" data-ztracker-part="${safeKey}" title="Regenerate ${safeKey}">${safeKey}</div>
        ${arrayItems}
      </div>`;
    })
    .join('');

  const controls = doc.createElement('div');
  controls.className = 'ztracker-controls';
  controls.innerHTML = `
    <div class="ztracker-regenerate-button fa-solid fa-arrows-rotate" title="Regenerate Tracker"></div>
    <details class="ztracker-parts-details" title="Regenerate individual parts">
      <summary class="ztracker-parts-summary fa-solid fa-list"></summary>
      <div class="ztracker-parts-list">${partsButtons}</div>
    </details>
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
  /** Additional fields to store on message.extra[EXTENSION_KEY] (besides value/html). */
  extensionData?: Record<string, unknown>;
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

  if (options.extensionData) {
    for (const [key, value] of Object.entries(options.extensionData)) {
      message.extra[EXTENSION_KEY][key] = value;
    }
  }
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
