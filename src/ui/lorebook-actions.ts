// UI side of lorebook export: the export dialog (book, title, keys, "Suggest title") and the
// "Replace linked entry" action. All lorebook writing lives in `../lorebook-export.ts`; this file
// only gathers input and reports results.
import { POPUP_RESULT, POPUP_TYPE } from 'sillytavern-utils-lib/types/popup';
import { st_echo } from 'sillytavern-utils-lib/config';
import type { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import { DEFAULT_MODULE_ID, getSettingsForTrackerModule, getTrackerModule } from '../config.js';
import type { ExtensionSettings } from '../config.js';
import { formatEmbeddedTrackerSnapshot } from '../embed-snapshot-transform.js';
import {
  createLorebookHost,
  exportTrackerToLorebook,
  getLorebookLink,
  replaceLinkedLorebookEntry,
  suggestEntryTitle,
} from '../lorebook-export.js';
import type { LorebookHost } from '../lorebook-export.js';
import { CHAT_MESSAGE_SCHEMA_VALUE_KEY, getTrackerModuleRecord } from '../tracker.js';

export function createLorebookActions(options: {
  globalContext: any;
  settingsManager: ExtensionSettingsManager<ExtensionSettings>;
  renderTrackerWithDeps: (messageId: number, moduleId?: string) => void;
  /** Test seam; defaults to the real SillyTavern-backed host. */
  createHost?: () => Promise<LorebookHost>;
}) {
  const { globalContext, settingsManager, renderTrackerWithDeps } = options;
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
          <button type="button" class="ztracker-lorebook-suggest menu_button">Suggest title</button>
        </div>
      </label>
      <label>Keys (comma separated; empty means the entry will not trigger)
        <input type="text" class="ztracker-lorebook-keys text_pole" />
      </label>`;
    const book = form.querySelector('.ztracker-lorebook-book') as HTMLSelectElement;
    const title = form.querySelector('.ztracker-lorebook-title') as HTMLInputElement;
    const keys = form.querySelector('.ztracker-lorebook-keys') as HTMLInputElement;
    const suggest = form.querySelector('.ztracker-lorebook-suggest') as HTMLButtonElement;
    for (const name of books) book.add(new Option(name, name));

    // Keys mirror the title until the user types in the keys field.
    let keysFollowTitle = true;
    title.addEventListener('input', () => {
      if (keysFollowTitle) keys.value = title.value;
    });
    keys.addEventListener('input', () => {
      keysFollowTitle = false;
    });

    suggest.addEventListener('click', async () => {
      suggest.disabled = true;
      suggest.textContent = 'Suggesting...';
      try {
        const suggested = await suggestEntryTitle(host, snapshotText());
        const keysMatchedTitle = keys.value === title.value;
        title.value = suggested;
        if (keysFollowTitle || keysMatchedTitle) keys.value = suggested;
      } catch (error) {
        console.error('zTracker: title suggestion failed', error);
        st_echo('error', `Title suggestion failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        suggest.disabled = false;
        suggest.textContent = 'Suggest title';
      }
    });

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
