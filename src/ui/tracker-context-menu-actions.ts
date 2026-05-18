import { st_echo } from 'sillytavern-utils-lib/config';
import type { ContextMenuTrackerActionsDependencies } from './tracker-actions.js';
import {
  buildArrayItemCleanupTarget,
  buildArrayItemFieldCleanupTarget,
  buildArrayItemFieldSchema,
  buildArrayItemSchema,
  buildTopLevelPartSchema,
  findArrayItemIndexByIdentity,
  findArrayItemIndexByName,
  getArrayItemIdentityKey,
  mergeTrackerPart,
  redactTrackerArrayItemFieldValue,
  redactTrackerArrayItemValue,
  redactTrackerPartValue,
  replaceTrackerArrayItem,
  replaceTrackerArrayItemField,
  type TrackerCleanupTarget,
} from '../tracker-parts.js';
import { appendCurrentTrackerSnapshot, captureDetailsState } from './tracker-action-helpers.js';
import { CONTEXT_MENU_STATUS_CLASS, withMessageStatusIndicator } from './message-status-indicator.js';

/** Keeps the context-menu regeneration actions out of tracker-actions.ts while preserving the same public API. */
export function createContextMenuTrackerActions(dependencies: ContextMenuTrackerActionsDependencies) {
  /** Runs one context-menu regeneration action with the shared badge, spinner, and error handling. */
  const runContextMenuTrackerUpdate = async (
    options: {
      messageId: number;
      button: Element | null | undefined;
      errorContext: string;
      callback: () => Promise<void>;
    },
  ): Promise<boolean> => {
    try {
      options.button?.classList.add('spinning');
      await withMessageStatusIndicator(
        { messageId: options.messageId, text: 'Updating tracker from menu', statusClassName: CONTEXT_MENU_STATUS_CLASS },
        options.callback,
      );
      return true;
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error(`Error ${options.errorContext}:`, error);
        st_echo('error', `Tracker generation failed: ${(error as Error).message}`);
      }
      return false;
    } finally {
      options.button?.classList.remove('spinning');
    }
  };

  /** Returns one tracker array field as an array or throws a focused regeneration error. */
  function getTrackerArrayValue(currentTracker: any, partKey: string): any[] {
    const currentArr = currentTracker?.[partKey];
    if (!Array.isArray(currentArr)) {
      throw new Error(`Tracker field is not an array: ${partKey}`);
    }

    return currentArr;
  }

  /** Resolves one array-item locator into the exact array index that regeneration should update. */
  function resolveArrayItemIndex(currentArr: any[], partKey: string, locator: ArrayItemLocator): number {
    if (locator.kind === 'index') {
      if (locator.index < 0 || locator.index >= currentArr.length) {
        throw new Error(`Array index out of range for ${partKey}: ${locator.index}`);
      }
      return locator.index;
    }

    if (locator.kind === 'name') {
      const index = findArrayItemIndexByName(currentArr, locator.name);
      if (index === -1) {
        throw new Error(`No array item found by name in ${partKey}: ${locator.name}`);
      }
      return index;
    }

    const index = findArrayItemIndexByIdentity(currentArr, locator.idKey, locator.idValue);
    if (index === -1) {
      throw new Error(`No array item found by ${locator.idKey} in ${partKey}: ${locator.idValue}`);
    }
    return index;
  }

  /** Builds the prompt context and post-processing rules for one array-item regeneration request. */
  function resolveArrayItemRegeneration(
    chatJsonValue: any,
    partKey: string,
    currentArr: any[],
    locator: ArrayItemLocator,
  ): {
    index: number;
    promptContext: Record<string, unknown>;
    promptContextLabel: string;
    prompt: string;
    promptEngineeringInstruction?: string;
    successMessage: string;
    resolvedTarget: TrackerCleanupTarget;
    finalizeItem: (item: unknown) => unknown;
  } {
    const index = resolveArrayItemIndex(currentArr, partKey, locator);
    const currentItem = currentArr[index];

    if (locator.kind === 'name') {
      const preserveName = currentItem && typeof currentItem === 'object' && typeof (currentItem as any).name === 'string';
      const preserveLine = preserveName ? `\n\nIMPORTANT: Preserve the item name exactly as "${locator.name}".` : '';
      return {
        index,
        promptContext: { part: partKey, matchBy: 'name', name: locator.name, index },
        promptContextLabel: 'Regenerate ONLY this array item (matched by name; previous values intentionally omitted):',
        prompt:
          `${dependencies.getTrackerPrompt()}\n\nRegenerate ONLY the ${partKey} item with name "${locator.name}" as an object under key "item". Return a single JSON object matching the provided schema.${preserveLine}\n\nIMPORTANT: Generate a fresh item; the previous values have been intentionally omitted and must not be repeated.`,
        promptEngineeringInstruction: preserveLine,
        successMessage: `Updated: ${partKey} (${locator.name})`,
        resolvedTarget: buildArrayItemCleanupTarget(partKey, index, { idKey: 'name', idValue: locator.name }),
        finalizeItem: (item) => {
          if (preserveName && item && typeof item === 'object') {
            (item as any).name = locator.name;
          }
          return item;
        },
      };
    }

    if (locator.kind === 'identity') {
      const preserveIdentity = currentItem && typeof currentItem === 'object' && typeof (currentItem as any)[locator.idKey] === 'string';
      const preserveLine = preserveIdentity
        ? `\n\nIMPORTANT: Preserve the identity field ${locator.idKey} exactly as "${locator.idValue}".`
        : '';
      return {
        index,
        promptContext: { part: partKey, matchBy: locator.idKey, idValue: locator.idValue, index },
        promptContextLabel: 'Regenerate ONLY this array item (matched by identity; previous values intentionally omitted):',
        prompt:
          `${dependencies.getTrackerPrompt()}\n\nRegenerate ONLY the ${partKey} item with ${locator.idKey} "${locator.idValue}" as an object under key "item". Return a single JSON object matching the provided schema.${preserveLine}\n\nIMPORTANT: Generate a fresh item; the previous values have been intentionally omitted and must not be repeated.`,
        promptEngineeringInstruction: preserveLine,
        successMessage: `Updated: ${partKey} (${locator.idKey}=${locator.idValue})`,
        resolvedTarget: buildArrayItemCleanupTarget(partKey, index, { idKey: locator.idKey, idValue: locator.idValue }),
        finalizeItem: (item) => {
          if (preserveIdentity && item && typeof item === 'object') {
            (item as any)[locator.idKey] = locator.idValue;
          }
          return item;
        },
      };
    }

    const idKey = getArrayItemIdentityKey(chatJsonValue, partKey);
    const idValue =
      currentItem && typeof currentItem === 'object' && typeof (currentItem as any)[idKey] === 'string'
        ? String((currentItem as any)[idKey])
        : '';
    return {
      index,
      promptContext: { part: partKey, index, ...(idKey && idValue ? { idKey, idValue } : {}) },
      promptContextLabel: 'Regenerate ONLY this array item (previous item intentionally omitted):',
      prompt:
        `${dependencies.getTrackerPrompt()}\n\nRegenerate ONLY ${partKey}[${index}] as an object under key "item". Return a single JSON object matching the provided schema. IMPORTANT: Generate a fresh item; the previous values have been intentionally omitted and must not be repeated.`,
      successMessage: `Updated: ${partKey}[${index}]`,
      resolvedTarget: buildArrayItemCleanupTarget(partKey, index, idKey && idValue ? { idKey, idValue } : undefined),
      finalizeItem: (item) => item,
    };
  }

  /** Builds the prompt context and cleanup target for one array-item field regeneration request. */
  function resolveArrayItemFieldRegeneration(
    chatJsonValue: any,
    partKey: string,
    fieldKey: string,
    currentArr: any[],
    locator: ArrayItemLocator,
  ): {
    index: number;
    promptContext: Record<string, unknown>;
    prompt: string;
    successMessage: string;
    resolvedTarget: TrackerCleanupTarget;
  } {
    const index = resolveArrayItemIndex(currentArr, partKey, locator);
    const currentItem = currentArr[index];
    if (!currentItem || typeof currentItem !== 'object' || Array.isArray(currentItem)) {
      throw new Error(`Array item is not an object at ${partKey}[${index}]`);
    }

    const idKey = getArrayItemIdentityKey(chatJsonValue, partKey);
    const idValue = typeof (currentItem as any)?.[idKey] === 'string' ? String((currentItem as any)[idKey]) : '';
    const itemContext = structuredClone(currentItem);
    if (fieldKey in (itemContext as any)) {
      delete (itemContext as any)[fieldKey];
    }

    return {
      index,
      promptContext: {
        part: partKey,
        index,
        ...(idKey && idValue ? { idKey, idValue } : {}),
        field: fieldKey,
        itemContext,
      },
      prompt:
        `${dependencies.getTrackerPrompt()}\n\nRegenerate ONLY ${partKey}[${index}].${fieldKey}. Return a single JSON object with key "value" that matches the provided schema. Do not change or rename the array item; only update that field. IMPORTANT: Generate a fresh value; the previous value has been intentionally omitted and must not be repeated.`,
      successMessage: `Updated: ${partKey}[${index}].${fieldKey}`,
      resolvedTarget: buildArrayItemFieldCleanupTarget(
        partKey,
        index,
        fieldKey,
        idKey && idValue ? { idKey, idValue } : undefined,
      ),
    };
  }

  /** Regenerates one top-level tracker part through the shared context-menu update flow. */
  async function generateTrackerPartInternal(id: number, partKey: string, notifySchemaMismatch = true) {
    if (dependencies.cancelIfPending(id)) return false;

    const messageBlock = getMessageBlock(id);
    const partButton = messageBlock?.querySelector(
      `.ztracker-part-regenerate-button[data-ztracker-part="${CSS.escape(partKey)}"]`,
    );
    const detailsState = captureDetailsState(id);

    return runContextMenuTrackerUpdate({
      messageId: id,
      button: partButton,
      errorContext: 'generating tracker part',
      callback: async () => {
        const { message, settings, schemaPresetKey, currentTracker, chatJsonValue, chatHtmlValue, messages, partsOrder, partsMeta, makeRequest } =
          await dependencies.prepareExistingTrackerGeneration(id, notifySchemaMismatch);
        if (!currentTracker || typeof currentTracker !== 'object') {
          throw new Error('No existing tracker found for this message. Generate a full tracker first.');
        }

        const partSchema = buildTopLevelPartSchema(chatJsonValue, partKey);
        const redactedTracker = redactTrackerPartValue(currentTracker, partKey);
        appendCurrentTrackerSnapshot(
          messages as any,
          redactedTracker,
          'Current tracker for this message (target part omitted for freshness; keep everything else consistent):',
        );

        const partResponse = await dependencies.requestStructuredTrackerContent({
          messages,
          settings,
          schema: partSchema,
          schemaName: 'SceneTrackerPart',
          prompt: `${settings.prompt}\n\nGenerate ONLY the field "${partKey}". Return a single JSON object matching the provided schema.`,
          makeRequest,
        });

        if (!partResponse || Object.keys(partResponse as any).length === 0) {
          throw new Error(`Empty response while generating part: ${partKey}`);
        }

        const nextTracker = mergeTrackerPart(currentTracker, partKey, partResponse);
        await dependencies.persistResolvedTrackerUpdate({
          messageId: id,
          message,
          schemaPresetKey,
          trackerData: nextTracker,
          trackerHtml: chatHtmlValue,
          partsOrder,
          partsMeta,
          detailsState,
          successMessage: `Updated: ${partKey}`,
          resolvedTargets: [{ kind: 'part', partKey }],
        });
      },
    });
  }

  /** Regenerates one tracker array item resolved by index, name, or identity. */
  async function generateTrackerArrayItemForLocator(
    id: number,
    partKey: string,
    locator: ArrayItemLocator,
    options: { button: Element | null | undefined; errorContext: string },
    notifySchemaMismatch = true,
  ) {
    if (dependencies.cancelIfPending(id)) return false;

    const detailsState = captureDetailsState(id);

    return runContextMenuTrackerUpdate({
      messageId: id,
      button: options.button,
      errorContext: options.errorContext,
      callback: async () => {
        const { message, settings, schemaPresetKey, currentTracker, chatJsonValue, chatHtmlValue, messages, partsOrder, partsMeta, makeRequest } =
          await dependencies.prepareExistingTrackerGeneration(id, notifySchemaMismatch);
        if (!currentTracker || typeof currentTracker !== 'object') {
          throw new Error('No existing tracker found for this message. Generate a full tracker first.');
        }

        const currentArr = getTrackerArrayValue(currentTracker, partKey);
        const itemRequest = resolveArrayItemRegeneration(chatJsonValue, partKey, currentArr, locator);
        const itemSchema = buildArrayItemSchema(chatJsonValue, partKey);
        const redactedTracker = redactTrackerArrayItemValue(currentTracker, partKey, itemRequest.index);

        appendCurrentTrackerSnapshot(
          messages as any,
          redactedTracker,
          'Current tracker for this message (target item omitted for freshness; keep everything else consistent):',
        );
        appendCurrentTrackerSnapshot(messages as any, itemRequest.promptContext, itemRequest.promptContextLabel);

        const itemResponse = (await dependencies.requestStructuredTrackerContent({
          messages,
          settings,
          schema: itemSchema,
          schemaName: 'SceneTrackerItem',
          prompt: itemRequest.prompt,
          makeRequest,
          promptEngineeringInstruction: itemRequest.promptEngineeringInstruction,
        })) as Record<string, unknown> | undefined;

        const item = itemRequest.finalizeItem(itemResponse?.item);
        if (item === undefined) {
          throw new Error('Item response missing key: item');
        }

        const nextTracker = replaceTrackerArrayItem(currentTracker, partKey, itemRequest.index, item);
        await dependencies.persistResolvedTrackerUpdate({
          messageId: id,
          message,
          schemaPresetKey,
          trackerData: nextTracker,
          trackerHtml: chatHtmlValue,
          partsOrder,
          partsMeta,
          detailsState,
          successMessage: itemRequest.successMessage,
          resolvedTargets: [itemRequest.resolvedTarget],
        });
      },
    });
  }

  /** Regenerates one tracker array-item field resolved by index, name, or identity. */
  async function generateTrackerArrayItemFieldForLocator(
    id: number,
    partKey: string,
    fieldKey: string,
    locator: ArrayItemLocator,
    options: { button: Element | null | undefined; errorContext: string },
    notifySchemaMismatch = true,
  ) {
    if (dependencies.cancelIfPending(id)) return false;

    const detailsState = captureDetailsState(id);

    return runContextMenuTrackerUpdate({
      messageId: id,
      button: options.button,
      errorContext: options.errorContext,
      callback: async () => {
        const { message, settings, schemaPresetKey, currentTracker, chatJsonValue, chatHtmlValue, messages, partsOrder, partsMeta, makeRequest } =
          await dependencies.prepareExistingTrackerGeneration(id, notifySchemaMismatch);
        if (!currentTracker || typeof currentTracker !== 'object') {
          throw new Error('No existing tracker found for this message. Generate a full tracker first.');
        }

        const currentArr = getTrackerArrayValue(currentTracker, partKey);
        const fieldRequest = resolveArrayItemFieldRegeneration(chatJsonValue, partKey, fieldKey, currentArr, locator);
        const redactedTracker = redactTrackerArrayItemFieldValue(currentTracker, partKey, fieldRequest.index, fieldKey);
        const fieldSchema = buildArrayItemFieldSchema(chatJsonValue, partKey, fieldKey);

        appendCurrentTrackerSnapshot(
          messages as any,
          redactedTracker,
          'Current tracker for this message (target field omitted for freshness; keep everything else consistent):',
        );
        appendCurrentTrackerSnapshot(
          messages as any,
          fieldRequest.promptContext,
          'Regenerate ONLY this field within this array item (field value intentionally omitted):',
        );

        const fieldResponse = (await dependencies.requestStructuredTrackerContent({
          messages,
          settings,
          schema: fieldSchema,
          schemaName: 'SceneTrackerItemField',
          prompt: fieldRequest.prompt,
          makeRequest,
        })) as Record<string, unknown> | undefined;

        const value = fieldResponse?.value;
        if (value === undefined) {
          throw new Error('Field response missing key: value');
        }

        const nextTracker = replaceTrackerArrayItemField(currentTracker, partKey, fieldRequest.index, fieldKey, value);
        await dependencies.persistResolvedTrackerUpdate({
          messageId: id,
          message,
          schemaPresetKey,
          trackerData: nextTracker,
          trackerHtml: chatHtmlValue,
          partsOrder,
          partsMeta,
          detailsState,
          successMessage: fieldRequest.successMessage,
          resolvedTargets: [fieldRequest.resolvedTarget],
        });
      },
    });
  }

  /** Recreates one cleanup target by routing it through the same context-menu regeneration paths. */
  async function recreateCleanupTarget(messageId: number, target: TrackerCleanupTarget): Promise<boolean> {
    if (target.kind === 'part') {
      return !!(await generateTrackerPartInternal(messageId, target.partKey, false));
    }
    if (target.kind === 'array-item') {
      if (typeof target.idKey === 'string' && target.idKey && typeof target.idValue === 'string' && target.idValue) {
        return !!(
          await generateTrackerArrayItemForLocator(
            messageId,
            target.partKey,
            { kind: 'identity', idKey: target.idKey, idValue: target.idValue },
            { button: undefined, errorContext: 'generating tracker array item (by identity)' },
            false,
          )
        );
      }
      return !!(
        await generateTrackerArrayItemForLocator(
          messageId,
          target.partKey,
          { kind: 'index', index: target.index },
          { button: undefined, errorContext: 'generating tracker array item' },
          false,
        )
      );
    }
    if (typeof target.idKey === 'string' && target.idKey && typeof target.idValue === 'string' && target.idValue) {
      return !!(
        await generateTrackerArrayItemFieldForLocator(
          messageId,
          target.partKey,
          target.fieldKey,
          { kind: 'identity', idKey: target.idKey, idValue: target.idValue },
          { button: undefined, errorContext: 'generating tracker array item field (by identity)' },
          false,
        )
      );
    }
    return !!(
      await generateTrackerArrayItemFieldForLocator(
        messageId,
        target.partKey,
        target.fieldKey,
        { kind: 'index', index: target.index },
        { button: undefined, errorContext: 'generating tracker array item field' },
        false,
      )
    );
  }

  /** Resolves the message-local button for one array-item regeneration action. */
  function getArrayItemButton(messageId: number, partKey: string, locator: ArrayItemLocator): Element | null {
    return getMessageBlock(messageId)?.querySelector(buildItemButtonSelector(partKey, locator)) ?? null;
  }

  /** Resolves the message-local button for one array-item-field regeneration action. */
  function getArrayItemFieldButton(
    messageId: number,
    partKey: string,
    fieldKey: string,
    locator: ArrayItemLocator,
  ): Element | null {
    return getMessageBlock(messageId)?.querySelector(buildFieldButtonSelector(partKey, fieldKey, locator)) ?? null;
  }

  return {
    generateTrackerPart: async (id: number, partKey: string) => generateTrackerPartInternal(id, partKey),
    generateTrackerArrayItem: async (id: number, partKey: string, index: number) => {
      return generateTrackerArrayItemForLocator(id, partKey, { kind: 'index', index }, {
        button: getArrayItemButton(id, partKey, { kind: 'index', index }),
        errorContext: 'generating tracker array item',
      });
    },
    generateTrackerArrayItemByName: async (id: number, partKey: string, name: string) => {
      return generateTrackerArrayItemForLocator(id, partKey, { kind: 'name', name }, {
        button: getArrayItemButton(id, partKey, { kind: 'name', name }),
        errorContext: 'generating tracker array item (by name)',
      });
    },
    generateTrackerArrayItemByIdentity: async (id: number, partKey: string, idKey: string, idValue: string) => {
      return generateTrackerArrayItemForLocator(id, partKey, { kind: 'identity', idKey, idValue }, {
        button: getArrayItemButton(id, partKey, { kind: 'identity', idKey, idValue }),
        errorContext: 'generating tracker array item (by identity)',
      });
    },
    generateTrackerArrayItemField: async (id: number, partKey: string, index: number, fieldKey: string) => {
      return generateTrackerArrayItemFieldForLocator(id, partKey, fieldKey, { kind: 'index', index }, {
        button: getArrayItemFieldButton(id, partKey, fieldKey, { kind: 'index', index }),
        errorContext: 'generating tracker array item field',
      });
    },
    generateTrackerArrayItemFieldByName: async (id: number, partKey: string, name: string, fieldKey: string) => {
      return generateTrackerArrayItemFieldForLocator(id, partKey, fieldKey, { kind: 'name', name }, {
        button: getArrayItemFieldButton(id, partKey, fieldKey, { kind: 'name', name }),
        errorContext: 'generating tracker array item field (by name)',
      });
    },
    generateTrackerArrayItemFieldByIdentity: async (
      id: number,
      partKey: string,
      idKey: string,
      idValue: string,
      fieldKey: string,
    ) => {
      return generateTrackerArrayItemFieldForLocator(id, partKey, fieldKey, { kind: 'identity', idKey, idValue }, {
        button: getArrayItemFieldButton(id, partKey, fieldKey, { kind: 'identity', idKey, idValue }),
        errorContext: 'generating tracker array item field (by identity)',
      });
    },
    recreateCleanupTarget,
  };
}

type ArrayItemLocator =
  | { kind: 'index'; index: number }
  | { kind: 'name'; name: string }
  | { kind: 'identity'; idKey: string; idValue: string };

/** Returns one chat message block so per-message tracker buttons can be resolved locally. */
function getMessageBlock(messageId: number): Element | null {
  return document.querySelector(`.mes[mesid="${messageId}"]`);
}

/** Builds the shared selector suffix for one array-item locator. */
function buildLocatorSelector(locator: ArrayItemLocator): string {
  if (locator.kind === 'index') {
    return `[data-ztracker-index="${locator.index}"]`;
  }
  if (locator.kind === 'name') {
    return `[data-ztracker-name="${CSS.escape(locator.name)}"]`;
  }
  return `[data-ztracker-idkey="${CSS.escape(locator.idKey)}"][data-ztracker-idvalue="${CSS.escape(locator.idValue)}"]`;
}

/** Builds the selector for one array-item regenerate button. */
function buildItemButtonSelector(partKey: string, locator: ArrayItemLocator): string {
  return `.ztracker-array-item-regenerate-button[data-ztracker-part="${CSS.escape(partKey)}"]${buildLocatorSelector(locator)}`;
}

/** Builds the selector for one array-item-field regenerate button. */
function buildFieldButtonSelector(partKey: string, fieldKey: string, locator: ArrayItemLocator): string {
  return `${buildItemButtonSelector(partKey, locator).replace('array-item-regenerate-button', 'array-item-field-regenerate-button')}[data-ztracker-field="${CSS.escape(fieldKey)}"]`;
}