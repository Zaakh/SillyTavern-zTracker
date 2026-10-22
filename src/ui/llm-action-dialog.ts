/**
 * The shared "Advanced" dialog for LLM content buttons (openspec: add-llm-action-dialog): per part an
 * editable system prompt (Reset, edited marker) and an editable result preview, one Generate/Regenerate
 * button, and Apply/Cancel handled by the host popup's `onClosing`. Nothing reaches the target before
 * Apply; instructions are saved on close. Framework-free so the lorebook (DOM) and Settings (React)
 * UIs open the same dialog.
 */
import { POPUP_RESULT, POPUP_TYPE } from 'sillytavern-utils-lib/types/popup';
import { isAbortError, saveOverride, resolveInstruction } from '../llm-actions.js';
import type { OverrideStore } from '../llm-actions.js';

/** One prompt-and-result pair; a single-text generator has exactly one part. */
export interface LlmDialogPart {
  /** Override key, e.g. `lorebook-title`. */
  id: string;
  label: string;
  defaultInstruction: string;
}

export interface LlmDialogOptions {
  title: string;
  parts: LlmDialogPart[];
  store: OverrideStore;
  /** Shown above the editors, e.g. "Uses: OpenAI · gpt-x". */
  connectionLabel?: string;
  /** Shown beside Apply, e.g. an overwrite warning. */
  applyNotice?: string;
  /** Sends the request(s) with the instructions as currently edited; one instruction and one result per part. */
  run(instructions: string[], signal: AbortSignal): Promise<string[]>;
  /** Writes the previewed results to the target; a throw keeps the dialog open. */
  apply(results: string[]): void | Promise<void>;
}

export interface LlmActionDialog {
  element: HTMLElement;
  /** Popup `onClosing` handler: returns false to keep the dialog open. */
  onClosing(popup: { result: unknown }): Promise<boolean>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildLlmActionDialog(options: LlmDialogOptions): LlmActionDialog {
  const { parts, store } = options;
  const element = document.createElement('div');
  element.className = 'ztracker-llm-dialog';

  const intro = document.createElement('div');
  intro.className = 'ztracker-llm-dialog-note';
  intro.textContent = [options.connectionLabel ? `Uses: ${options.connectionLabel}.` : '', 'Additional rules are added automatically.']
    .filter(Boolean)
    .join(' ');
  element.append(intro);

  const editors: HTMLTextAreaElement[] = [];
  const previews: HTMLTextAreaElement[] = [];
  for (const part of parts) {
    const section = document.createElement('div');
    section.className = 'ztracker-llm-dialog-part';
    section.innerHTML = `
      <details class="ztracker-llm-dialog-prompt">
        <summary><span class="ztracker-llm-dialog-label"></span> system prompt <span class="ztracker-llm-dialog-edited" hidden>(edited)</span></summary>
        <textarea class="text_pole ztracker-llm-dialog-instruction" rows="6"></textarea>
        <button type="button" class="menu_button ztracker-llm-dialog-reset">Reset to default</button>
      </details>
      <label>Result <textarea class="text_pole ztracker-llm-dialog-preview" rows="4"></textarea></label>`;
    (section.querySelector('.ztracker-llm-dialog-label') as HTMLElement).textContent = part.label;
    const editor = section.querySelector('.ztracker-llm-dialog-instruction') as HTMLTextAreaElement;
    const preview = section.querySelector('.ztracker-llm-dialog-preview') as HTMLTextAreaElement;
    const marker = section.querySelector('.ztracker-llm-dialog-edited') as HTMLElement;
    editor.value = resolveInstruction(store, part.id, part.defaultInstruction);
    const refreshMarker = () => {
      marker.hidden = !editor.value.trim() || editor.value === part.defaultInstruction;
    };
    refreshMarker();
    editor.addEventListener('input', refreshMarker);
    // Reset only edits the editor; closing the dialog then drops the override (one removal path).
    (section.querySelector('.ztracker-llm-dialog-reset') as HTMLButtonElement).addEventListener('click', () => {
      editor.value = part.defaultInstruction;
      refreshMarker();
    });
    editors.push(editor);
    previews.push(preview);
    element.append(section);
  }

  const bar = document.createElement('div');
  bar.className = 'ztracker-llm-dialog-bar';
  bar.innerHTML = `
    <button type="button" class="menu_button ztracker-llm-dialog-generate">Generate</button>
    <button type="button" class="menu_button ztracker-llm-dialog-stop" hidden>Stop</button>
    <span class="ztracker-llm-dialog-notice"></span>`;
  const generate = bar.querySelector('.ztracker-llm-dialog-generate') as HTMLButtonElement;
  const stop = bar.querySelector('.ztracker-llm-dialog-stop') as HTMLButtonElement;
  (bar.querySelector('.ztracker-llm-dialog-notice') as HTMLElement).textContent = options.applyNotice ?? '';
  const error = document.createElement('div');
  error.className = 'ztracker-llm-dialog-error';
  element.append(bar, error);

  let controller: AbortController | undefined;
  let hasResult = false;
  let closed = false;

  generate.addEventListener('click', async () => {
    if (controller) return;
    const current = new AbortController();
    controller = current;
    generate.disabled = true;
    stop.hidden = false;
    generate.textContent = 'Generating...';
    error.textContent = '';
    try {
      const results = await options.run(editors.map((editor) => editor.value), current.signal);
      if (current.signal.aborted || closed) return;
      results.forEach((text, index) => {
        previews[index].value = text;
      });
      hasResult = true;
    } catch (failure) {
      if (!isAbortError(failure) && !closed) {
        console.error('zTracker: LLM action failed', failure);
        error.textContent = errorText(failure);
      }
    } finally {
      controller = undefined;
      generate.disabled = false;
      stop.hidden = true;
      generate.textContent = hasResult ? 'Regenerate' : 'Generate';
    }
  });
  stop.addEventListener('click', () => controller?.abort());

  async function onClosing(popup: { result: unknown }): Promise<boolean> {
    if (popup.result === POPUP_RESULT.AFFIRMATIVE) {
      const results = previews.map((preview) => preview.value.trim());
      if (!hasResult || results.some((text) => !text)) {
        error.textContent = hasResult ? 'Every result needs text before you can apply.' : 'Generate a result first.';
        return false;
      }
      try {
        await options.apply(results);
      } catch (failure) {
        console.error('zTracker: applying the LLM result failed', failure);
        error.textContent = `Could not apply: ${errorText(failure)}`;
        return false;
      }
    }
    closed = true;
    controller?.abort();
    parts.forEach((part, index) => saveOverride(store, part.id, part.defaultInstruction, editors[index].value));
    return true;
  }

  return { element, onClosing };
}

/** Opens the dialog in a SillyTavern popup (Apply = the popup's OK button). */
export async function openLlmActionDialog(
  // `any` parameters: the host's `callGenericPopup` is typed with its own popup enums and option shape.
  callGenericPopup: (content: any, type: any, title: any, options: any) => Promise<unknown>,
  options: LlmDialogOptions,
): Promise<void> {
  const dialog = buildLlmActionDialog(options);
  await callGenericPopup(dialog.element, POPUP_TYPE.CONFIRM, options.title, {
    okButton: 'Apply',
    cancelButton: 'Cancel',
    wide: true,
    onClosing: dialog.onClosing,
  });
}
