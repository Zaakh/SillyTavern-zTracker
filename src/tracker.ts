import Handlebars from 'handlebars';
import type { Message } from 'sillytavern-utils-lib';
import type { ChatMessage } from 'sillytavern-utils-lib/types';
import { DEFAULT_EMBED_SNAPSHOT_HEADER } from './config.js';
import type { ExtensionSettings } from './config.js';
import { EXTENSION_KEY } from './extension-metadata.js';
import { formatEmbeddedTrackerSnapshot } from './embed-snapshot-transform.js';
import { toShortTrackerLabel } from './tracker-helpers.js';
import { isSameTrackerCleanupTarget, sanitizeArrayItemFieldKeys } from './tracker-parts.js';

export const CHAT_METADATA_SCHEMA_PRESET_KEY = 'schemaKey';
export const CHAT_MESSAGE_SCHEMA_PRESET_KEY = 'schemaKey';
export const CHAT_MESSAGE_SCHEMA_VALUE_KEY = 'value';
export const CHAT_MESSAGE_SCHEMA_HTML_KEY = 'html';
export const CHAT_MESSAGE_PARTS_ORDER_KEY = 'partsOrder';
export const CHAT_MESSAGE_PARTS_META_KEY = 'partsMeta';
export const CHAT_MESSAGE_PENDING_REDACTIONS_KEY = 'pendingRedactions';

function escapeHtmlAttr(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
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
      fields.add(key);
    }
  }

  return sanitizeArrayItemFieldKeys(Array.from(fields), idKey).sort((a, b) => a.localeCompare(b));
}

function getPendingRedactionTargets(extra: Record<string, any> | undefined): Array<Record<string, any>> {
  const targets = extra?.[CHAT_MESSAGE_PENDING_REDACTIONS_KEY]?.targets;
  return Array.isArray(targets) ? targets : [];
}

function isBlankPendingLabelValue(value: unknown): boolean {
  return value === null || value === '';
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
  const extra = message.extra?.[EXTENSION_KEY] as Record<string, any> | undefined;

  const partsOrder: string[] =
    (extra?.[CHAT_MESSAGE_PARTS_ORDER_KEY] as any) ?? Object.keys(trackerData ?? {});
  const partsMeta: Record<string, any> = (extra?.[CHAT_MESSAGE_PARTS_META_KEY] as any) ?? {};
  const pendingTargets = getPendingRedactionTargets(extra);
  const partsButtons = partsOrder
    .map((k) => {
      const safeKey = escapeHtmlAttr(k);
      const value = (trackerData as any)?.[k];
      const partTarget = { kind: 'part' as const, partKey: k };
      const isPartPending = pendingTargets.some((target) => isSameTrackerCleanupTarget(target as any, partTarget));
      const partPendingClass = isPartPending ? ' is-pending-redaction' : '';
      const partPendingText = isPartPending ? ' (pending recreation)' : '';
      const arrayItems = Array.isArray(value)
        ? `<div class="ztracker-part-items" title="Regenerate individual items">${value
            .map((item: any, index: number) => {
              const idKey =
                typeof partsMeta?.[k]?.idKey === 'string' && partsMeta[k].idKey.trim() ? partsMeta[k].idKey.trim() : 'name';
              const idValue = item && typeof item === 'object' && typeof item[idKey] === 'string' ? item[idKey] : '';
              const itemTarget = {
                kind: 'array-item' as const,
                partKey: k,
                index,
                ...(idKey && idValue ? { idKey, idValue } : {}),
              };
              const pendingItemTarget = pendingTargets.find((target) => isSameTrackerCleanupTarget(target as any, itemTarget));
              const label = escapeHtmlAttr(
                typeof pendingItemTarget?.displayLabel === 'string' && isBlankPendingLabelValue(item)
                  ? pendingItemTarget.displayLabel
                  : toShortTrackerLabel(item),
              );
              const itemName = item && typeof item === 'object' && typeof item.name === 'string' ? item.name : '';
              const safeName = itemName ? ` data-ztracker-name="${escapeHtmlAttr(itemName)}"` : '';
              const safeId =
                idKey && idValue
                  ? ` data-ztracker-idkey="${escapeHtmlAttr(idKey)}" data-ztracker-idvalue="${escapeHtmlAttr(idValue)}"`
                  : '';
              const itemPendingClass = pendingItemTarget ? ' is-pending-redaction' : '';
              const title = itemName
                ? `Regenerate ${safeKey} (${escapeHtmlAttr(itemName)})`
                : `Regenerate ${safeKey}[${index}]`;
              const itemTitle = `${title}${pendingItemTarget ? ' (pending recreation)' : ''}`;

              const fieldsFromMeta: string[] = Array.isArray(partsMeta?.[k]?.fields) ? partsMeta[k].fields : [];
              const sanitizedFieldsFromMeta = sanitizeArrayItemFieldKeys(fieldsFromMeta, idKey);
              const fields: string[] =
                sanitizedFieldsFromMeta.length > 0
                  ? sanitizedFieldsFromMeta
                  : item && typeof item === 'object' && !Array.isArray(item)
                    ? deriveArrayItemFieldsFallback(value, idKey)
                    : [];
              const fieldButtons = fields
                .map((fieldKey: string) => {
                  const safeField = escapeHtmlAttr(fieldKey);
                  const fieldTarget = {
                    kind: 'array-item-field' as const,
                    partKey: k,
                    index,
                    fieldKey,
                    ...(idKey && idValue ? { idKey, idValue } : {}),
                  };
                  const isFieldPending = pendingTargets.some((target) => isSameTrackerCleanupTarget(target as any, fieldTarget));
                  const fieldPendingClass = isFieldPending ? ' is-pending-redaction' : '';
                  const fieldTitle = itemName
                    ? `Regenerate ${safeKey} (${escapeHtmlAttr(itemName)}).${safeField}`
                    : `Regenerate ${safeKey}[${index}].${safeField}`;
                  return `<div class="ztracker-array-item-field-regenerate-button${fieldPendingClass}" data-ztracker-part="${safeKey}" data-ztracker-index="${index}" data-ztracker-field="${safeField}"${safeName}${safeId} title="${fieldTitle}${isFieldPending ? ' (pending recreation)' : ''}">${safeField}</div>`;
                })
                .join('');

              const fieldsBlock = fieldButtons ? `<div class="ztracker-array-item-fields">${fieldButtons}</div>` : '';

              return `<div class="ztracker-array-item-row">
                <div class="ztracker-array-item-regenerate-button${itemPendingClass}" data-ztracker-part="${safeKey}" data-ztracker-index="${index}"${safeName}${safeId} title="${itemTitle}">${label}</div>
                ${fieldsBlock}
              </div>`;
            })
            .join('')}</div>`
        : '';

      return `<div class="ztracker-part-row">
        <div class="ztracker-part-regenerate-button${partPendingClass}" data-ztracker-part="${safeKey}" title="Regenerate ${safeKey}${partPendingText}">${safeKey}</div>
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
    <div class="ztracker-cleanup-button fa-solid fa-eraser" title="Clear or recreate selected tracker targets"></div>
    <div class="ztracker-edit-button fa-solid fa-code" title="Edit Tracker Data"></div>
    <div class="ztracker-delete-button fa-solid fa-trash-can" title="Delete Tracker"></div>
  `;

  if (pendingTargets.length > 0) {
    const pendingStatus = doc.createElement('div');
    pendingStatus.className = 'ztracker-pending-redactions-status';
    pendingStatus.textContent = `${pendingTargets.length} tracker ${pendingTargets.length === 1 ? 'target' : 'targets'} cleared`;
    container.prepend(pendingStatus);
  }

  container.prepend(controls);

  messageBlock.querySelector('.mes_text')?.before(container);
}

// Keeps the embedded tracker speaker label aligned with the existing configurable header.
function deriveEmbeddedTrackerSpeakerName(settings: ExtensionSettings): string {
  const header = settings.embedZTrackerSnapshotHeader ?? DEFAULT_EMBED_SNAPSHOT_HEADER;
  const trimmedLabel = header.replace(/:+\s*$/, '').trim();
  return trimmedLabel || 'Tracker';
}

export function includeZTrackerMessages<T extends Message | ChatMessage>(
  messages: T[],
  settings: ExtensionSettings,
): T[] {
  // SillyTavern sometimes keeps speaker attribution only on source.name.
  // Promote it onto cloned chat turns so instruct-mode prompt assembly can still emit named dialogue.
  const copyMessages = structuredClone(messages).map((message: T) => {
    const fallbackName =
      typeof (message as any).name === 'string' && (message as any).name.trim()
        ? undefined
        : typeof (message as any).source?.name === 'string' && (message as any).source.name.trim()
          ? (message as any).source.name
          : undefined;

    return fallbackName
      ? ({ ...message, name: fallbackName } as T)
      : message;
  });
  const embedRole = settings.embedZTrackerRole ?? 'user';

  if (settings.includeLastXZTrackerMessages > 0) {
    for (let i = 0; i < settings.includeLastXZTrackerMessages; i++) {
      let foundMessage: T | null = null;
      let foundIndex = -1;
      // SillyTavern may pass a chat array that ends on the most recent user message
      // (e.g. Options → Regenerate can produce a 2-message prompt). We must consider
      // the last message as a valid tracker source.
      for (let j = copyMessages.length - 1; j >= 0; j--) {
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

        const header = settings.embedZTrackerSnapshotHeader ?? DEFAULT_EMBED_SNAPSHOT_HEADER;
        const useCharacterName = settings.embedZTrackerAsCharacter ?? false;
        const prefix = !useCharacterName && header ? `${header}\n` : '';
        const content = wrapInCodeFence
          ? `${prefix}\`\`\`${lang}\n${text}\n\`\`\``
          : `${prefix}${text}`;
        const speakerName = useCharacterName ? deriveEmbeddedTrackerSpeakerName(settings) : undefined;
        copyMessages.splice(
          foundIndex + 1,
          0,
          {
            content,
            role: embedRole,
            // These flags are used by SillyTavern Message objects; harmless for ChatMessage.
            is_user: embedRole === 'user',
            is_system: embedRole === 'system',
            ...(speakerName ? { name: speakerName } : {}),
            mes: content,
          } as unknown as T,
        );
      }
    }
  }
  return copyMessages;
}

// Mirrors SillyTavern's assistant-opening alignment behavior so instruct-mode
// text-completion prompts still begin with a user turn after leading system text.
function insertUserAlignmentMessage<
  T extends {
    role: string;
    content: string;
    name?: string;
  },
>(
  messages: T[],
  options: {
    userAlignmentMessage?: string;
    userName?: string;
  },
): T[] {
  const alignmentMessage = options.userAlignmentMessage?.trim();
  if (!alignmentMessage) {
    return messages;
  }

  const firstNonSystemIndex = messages.findIndex((message) => message.role !== 'system');
  if (firstNonSystemIndex === -1 || messages[firstNonSystemIndex].role !== 'assistant') {
    return messages;
  }

  const userName = options.userName?.trim();
  return [
    ...messages.slice(0, firstNonSystemIndex),
    {
      role: 'user',
      content: alignmentMessage,
      ...(userName ? { name: userName } : {}),
    } as T,
    ...messages.slice(firstNonSystemIndex),
  ];
}

/**
 * Reduces prompt messages to the fields the generator request actually needs.
 * This keeps SillyTavern/UI metadata and zTracker's temporary discovery markers
 * out of tracker-generation requests while preserving instruct-relevant speaker attribution.
 */
export function sanitizeMessagesForGeneration<
  T extends {
    role: string;
    content: string;
    name?: string;
    ignoreInstruct?: boolean;
    source?: { name?: string };
  },
>(
  messages: T[],
  options: {
    inlineNamesIntoContent?: boolean;
    userAlignmentMessage?: string;
    userName?: string;
  } = {},
): Array<{ role: string; content: string; name?: string; ignoreInstruct?: boolean }> {
  const alignedMessages = insertUserAlignmentMessage(messages, options);

  return alignedMessages.map((message) => {
    const name = typeof message.name === 'string' && message.name.trim()
      ? message.name
      : typeof message.source?.name === 'string' && message.source.name.trim()
        ? message.source.name
        : undefined;
    const shouldInlineName =
      !!options.inlineNamesIntoContent &&
      !!name &&
      (message.role === 'assistant' || message.role === 'user');
    const contentAlreadyHasSpeakerPrefix =
      !!name &&
      message.content.startsWith(`${name}:`);
    const content = shouldInlineName && !contentAlreadyHasSpeakerPrefix ? `${name}: ${message.content}` : message.content;

    return {
      role: message.role,
      content,
      ...(!shouldInlineName && name ? { name } : {}),
      ...(typeof message.ignoreInstruct === 'boolean' ? { ignoreInstruct: message.ignoreInstruct } : {}),
    };
  });
}

/**
 * Collapses consecutive leading system messages into one block so text-completion
 * prompt assembly can run them through SillyTavern's story-string wrapper.
 */
export function extractLeadingSystemPrompt<
  T extends {
    role: string;
    content: string;
  },
>(
  messages: T[],
): { systemPrompt?: string; remainingMessages: T[] } {
  const firstNonSystemIndex = messages.findIndex((message) => message.role !== 'system');
  if (firstNonSystemIndex === 0) {
    return { remainingMessages: [...messages] };
  }

  const systemMessages = (firstNonSystemIndex === -1 ? messages : messages.slice(0, firstNonSystemIndex))
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0);

  return {
    ...(systemMessages.length > 0 ? { systemPrompt: systemMessages.join('\n\n') } : {}),
    remainingMessages: firstNonSystemIndex === -1 ? [] : messages.slice(firstNonSystemIndex),
  };
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
      if (value === undefined) {
        delete message.extra[EXTENSION_KEY][key];
        continue;
      }

      message.extra[EXTENSION_KEY][key] = value;
    }
  }
  message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_VALUE_KEY] = options.trackerData;
  message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_HTML_KEY] = options.trackerHtml;
  warnOnDependentArrayMismatches(
    options.trackerData,
    message.extra[EXTENSION_KEY][CHAT_MESSAGE_PARTS_META_KEY] as Record<string, any> | undefined,
  );

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

// Warns when a dependent detail array is missing entries for identifiers declared in its source array.
function warnOnDependentArrayMismatches(
  trackerData: unknown,
  partsMeta: Record<string, { idKey?: string; dependsOn?: string[] }> | undefined,
): void {
  if (!trackerData || typeof trackerData !== 'object' || !partsMeta) {
    return;
  }

  for (const [partKey, meta] of Object.entries(partsMeta)) {
    const dependsOn = Array.isArray(meta?.dependsOn) ? meta.dependsOn : [];
    if (dependsOn.length === 0) {
      continue;
    }

    const detailItems = (trackerData as Record<string, any>)[partKey];
    if (!Array.isArray(detailItems)) {
      continue;
    }

    const idKey = typeof meta?.idKey === 'string' && meta.idKey.trim() ? meta.idKey.trim() : 'name';
    const availableIds = new Set(
      detailItems
        .map((item) => (item && typeof item === 'object' ? item[idKey] : undefined))
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    );

    for (const dependencyKey of dependsOn) {
      const sourceItems = (trackerData as Record<string, any>)[dependencyKey];
      if (!Array.isArray(sourceItems)) {
        continue;
      }

      const missingIds = sourceItems
        .map((item) => {
          if (typeof item === 'string') return item.trim();
          if (item && typeof item === 'object' && typeof item[idKey] === 'string') return item[idKey].trim();
          return '';
        })
        .filter((value) => value.length > 0 && !availableIds.has(value));

      if (missingIds.length > 0) {
        console.warn('zTracker: dependent array mismatch', {
          partKey,
          dependsOn: dependencyKey,
          idKey,
          missingIds,
        });
      }
    }
  }
}
