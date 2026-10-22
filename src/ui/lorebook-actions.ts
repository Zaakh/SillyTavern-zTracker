// UI side of lorebook export: the export dialog (book, title, keys, Suggest title/keys) and the
// "Replace linked entry" action. All lorebook writing lives in `../lorebook-export.ts`; this file
// only gathers input and reports results.
import { POPUP_RESULT, POPUP_TYPE } from 'sillytavern-utils-lib/types/popup';
import { st_echo } from 'sillytavern-utils-lib/config';
import type { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import { DEFAULT_MODULE_ID, getSettingsForTrackerModule, getTrackerModule } from '../config.js';
import type { ExtensionSettings } from '../config.js';
import { formatEmbeddedTrackerSnapshot } from '../embed-snapshot-transform.js';
import {
  LOREBOOK_KEYS_ACTION,
  LOREBOOK_TITLE_ACTION,
  createLorebookHost,
  exportTrackerToLorebook,
  getLorebookLink,
  replaceLinkedLorebookEntry,
} from '../lorebook-export.js';
import type { LorebookHost } from '../lorebook-export.js';
import { resolveInstruction, runLlmAction } from '../llm-actions.js';
import type { LlmAction } from '../llm-actions.js';
import type { GenerationMessage } from '../schema-generation.js';
import { openLlmActionDialog } from './llm-action-dialog.js';
import { CHAT_MESSAGE_SCHEMA_VALUE_KEY, getTrackerModuleRecord } from '../tracker.js';

export function createLorebookActions(options: {
  globalContext: any;
  settingsManager: ExtensionSettingsManager<ExtensionSettings>;
  renderTrackerWithDeps: (messageId: number, moduleId?: string) => void;
  /** One request through the global active connection (reasoning stripped, no prefill); `signal` cancels it. */
  requestWithActiveConnection: (
    messages: GenerationMessage[],
    overridePayload?: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<string>;
  getActiveConnectionLabel: () => string;
  /** Test seam; defaults to the real SillyTavern-backed host. */
  createHost?: () => Promise<LorebookHost>;
}) {
  const { globalContext, settingsManager, renderTrackerWithDeps, requestWithActiveConnection, getActiveConnectionLabel } = options;
  const createHost = options.createHost ?? (() => createLorebookHost(globalContext));

  function getTarget(messageId: number, moduleId: string) {
    const message = globalContext.chat[messageId];
    const record = getTrackerModuleRecord(message, moduleId);
    const trackerValue = record?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY];
    if (!record || trackerValue === undefined) return null;
    const extensionSettings = settingsManager.getSettings();
    return {
      record,
      trackerValue,
      settings: getSettingsForTrackerModule(extensionSettings, moduleId),
      moduleName: getTrackerModule(extensionSettings, moduleId).name,
    };
  }

  function buildDialog(host: LorebookHost, books: string[], snapshotText: () => string) {
    const form = document.createElement('div');
    form.className = 'ztracker-lorebook-dialog';
    form.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    form.innerHTML = `
      <label>Lorebook <select class="ztracker-lorebook-book text_pole"></select></label>
      <label>Entry title (required)
        <div style="display:flex;gap:6px;">
          <input type="text" class="ztracker-lorebook-title text_pole" style="flex:1;" />
          <button type="button" class="ztracker-lorebook-suggest-title menu_button fa-solid fa-wand-magic-sparkles" title="Suggest title" aria-label="Suggest title"></button>
          <button type="button" class="ztracker-lorebook-advanced-title menu_button" title="Suggest a title with an editable prompt and a preview">Advanced...</button>
        </div>
      </label>
      <label>Keys (comma separated; empty means the entry will not trigger)
        <div style="display:flex;gap:6px;">
          <input type="text" class="ztracker-lorebook-keys text_pole" style="flex:1;" />
          <button type="button" class="ztracker-lorebook-suggest-keys menu_button fa-solid fa-wand-magic-sparkles" title="Suggest keys" aria-label="Suggest keys"></button>
          <button type="button" class="ztracker-lorebook-advanced-keys menu_button" title="Suggest keys with an editable prompt and a preview">Advanced...</button>
        </div>
      </label>`;
    const book = form.querySelector('.ztracker-lorebook-book') as HTMLSelectElement;
    const title = form.querySelector('.ztracker-lorebook-title') as HTMLInputElement;
    const keys = form.querySelector('.ztracker-lorebook-keys') as HTMLInputElement;
    const [suggestTitle, suggestKeys, advancedTitle, advancedKeys] = ['suggest-title', 'suggest-keys', 'advanced-title', 'advanced-keys'].map(
      (name) => form.querySelector(`.ztracker-lorebook-${name}`) as HTMLButtonElement,
    );
    for (const name of books) book.add(new Option(name, name));

    // Keys mirror the title until the user types in the keys field.
    let keysFollowTitle = true;
    title.addEventListener('input', () => {
      if (keysFollowTitle) keys.value = title.value;
    });
    keys.addEventListener('input', () => {
      keysFollowTitle = false;
    });

    const applyTitle = (suggested: string) => {
      const keysMatchedTitle = keys.value === title.value;
      title.value = suggested;
      if (keysFollowTitle || keysMatchedTitle) keys.value = suggested;
    };
    // Applied keys are the user's now: later title edits must not overwrite them.
    const applyKeys = (text: string) => {
      keys.value = text.split(',').map((key) => key.trim()).filter(Boolean).join(', ');
      keysFollowTitle = false;
    };

    // One run guard for all four buttons: only one suggestion runs at a time.
    let busy = false;
    const setBusy = (value: boolean) => {
      busy = value;
      for (const button of [suggestTitle, suggestKeys, advancedTitle, advancedKeys]) button.disabled = value;
    };
    const store = settingsManager;
    const inputs = {
      title: () => ({ snapshotText: snapshotText() }),
      keys: () => ({ snapshotText: snapshotText(), title: title.value }),
    };

    /** Runs `work` under the shared guard; a failure is reported to the user, leaving the fields unchanged. */
    async function guarded(work: () => Promise<void>, failure: string) {
      if (busy) return;
      setBusy(true);
      try {
        await work();
      } catch (error) {
        console.error(`zTracker: ${failure} failed`, error);
        st_echo('error', `${failure} failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setBusy(false);
      }
    }

    function suggest<Input, Result>(
      action: LlmAction<Input, Result>,
      input: () => Input,
      toText: (result: Result) => string,
      instruction: string,
      signal?: AbortSignal,
    ) {
      return runLlmAction(action, { instruction, input: input(), request: requestWithActiveConnection, signal }).then(toText);
    }

    function wire<Input, Result>(
      quickButton: HTMLButtonElement,
      advancedButton: HTMLButtonElement,
      action: LlmAction<Input, Result>,
      heading: string,
      input: () => Input,
      toText: (result: Result) => string,
      apply: (text: string) => void,
    ) {
      quickButton.addEventListener('click', () =>
        guarded(
          async () => apply(await suggest(action, input, toText, resolveInstruction(store, action.id, action.defaultInstruction))),
          heading,
        ),
      );
      advancedButton.addEventListener('click', () =>
        guarded(() =>
          openLlmActionDialog(globalContext.callGenericPopup, {
            title: heading,
            parts: [{ id: action.id, label: heading, defaultInstruction: action.defaultInstruction }],
            store,
            connectionLabel: getActiveConnectionLabel(),
            run: async ([instruction], signal) => [await suggest(action, input, toText, instruction, signal)],
            apply: ([text]) => apply(text),
          }),
          `${heading} dialog`,
        ),
      );
    }

    wire(suggestTitle, advancedTitle, LOREBOOK_TITLE_ACTION, 'Title suggestion', inputs.title, (result) => result, applyTitle);
    wire(suggestKeys, advancedKeys, LOREBOOK_KEYS_ACTION, 'Keys suggestion', inputs.keys, (result) => result.join(', '), applyKeys);

    return { form, book, title, keys };
  }

  async function finishWrite(result: Awaited<ReturnType<typeof exportTrackerToLorebook>>, messageId: number, moduleId: string, doneText: string, linkChanged: boolean) {
    if (!result.ok) {
      st_echo('error', result.error);
      return;
    }
    // Only Export changes the chat (the stored link); Replace leaves it untouched.
    if (linkChanged) {
      try {
        await globalContext.saveChat();
      } catch (error) {
        console.error('zTracker: saving the chat after a lorebook write failed', error);
        st_echo('error', 'The lorebook was written, but the link to it could not be saved with the chat.');
        return;
      }
      renderTrackerWithDeps(messageId, moduleId);
    }
    st_echo('success', doneText);
    if (result.warnings.includes('no-keys')) {
      st_echo('warning', 'The entry has no keys and will not trigger until you add some in the lorebook.');
    }
  }

  async function runExport(messageId: number, moduleId: string) {
    const target = getTarget(messageId, moduleId);
    if (!target) return;
    const host = await createHost();
    const books = host.getWorldInfoNames();
    if (books.length === 0) {
      st_echo('warning', 'Create a lorebook first, then export again.');
      return;
    }

    const dialog = buildDialog(host, books, () =>
      formatEmbeddedTrackerSnapshot(target.trackerValue, target.settings, { moduleName: target.moduleName }).text,
    );
    const result = await globalContext.callGenericPopup(dialog.form, POPUP_TYPE.CONFIRM, 'Export to lorebook', {
      okButton: 'Export',
      onClosing: (popup: any) => {
        if (popup.result !== POPUP_RESULT.AFFIRMATIVE) return true;
        if (dialog.title.value.trim()) return true;
        st_echo('warning', 'Enter an entry title first.');
        return false;
      },
    });
    if (result !== POPUP_RESULT.AFFIRMATIVE) return;

    const title = dialog.title.value.trim();
    const keys = dialog.keys.value.split(',').map((key) => key.trim()).filter(Boolean);
    const written = await exportTrackerToLorebook(host, {
      book: dialog.book.value,
      title,
      keys,
      trackerValue: target.trackerValue,
      settings: target.settings,
      record: target.record,
    });
    await finishWrite(written, messageId, moduleId, `Exported "${title}" to ${dialog.book.value}.`, true);
  }

  async function runReplace(messageId: number, moduleId: string) {
    const target = getTarget(messageId, moduleId);
    const link = getLorebookLink(target?.record);
    if (!target || !link) return;

    const host = await createHost();
    const result = await replaceLinkedLorebookEntry(host, { link, trackerValue: target.trackerValue, settings: target.settings });
    await finishWrite(result, messageId, moduleId, `Replaced "${link.title}" in ${link.book}.`, false);
    if (!result.ok && result.missing) {
      const exportNew = await globalContext.Popup.show.confirm('Linked entry is gone', `${result.error} Export as a new entry instead?`);
      if (exportNew) await runExport(messageId, moduleId);
    }
  }

  /** Runs one action and reports any failure to the user instead of leaving an unhandled rejection. */
  async function reportFailures(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      console.error('zTracker: lorebook action failed', error);
      st_echo('error', `Lorebook action failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    exportToLorebook: (messageId: number, moduleId = DEFAULT_MODULE_ID) => reportFailures(() => runExport(messageId, moduleId)),
    replaceLorebookEntry: (messageId: number, moduleId = DEFAULT_MODULE_ID) => reportFailures(() => runReplace(messageId, moduleId)),
  };
}
