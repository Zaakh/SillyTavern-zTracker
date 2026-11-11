/**
 * Generic copy-to-clipboard action for tracker HTML templates: a control carrying
 * `data-ztracker-copy="<id>"` copies the text of the element with `data-ztracker-copy-source="<id>"`
 * inside the same `.mes_ztracker` block. Import-safe (no host side effects) so Jest can load it.
 */

const COPY_CONTROL_SELECTOR = '[data-ztracker-copy]';
const FEEDBACK_RESET_MS = 1500;

const resetTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** Returns the copy control for a click target (the control itself or a nested element), or null. */
export function findCopyControl(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? (target.closest(COPY_CONTROL_SELECTOR) as HTMLElement | null) : null;
}

function findCopySource(control: HTMLElement): HTMLElement | null {
  const id = control.getAttribute('data-ztracker-copy');
  const block = control.closest('.mes_ztracker');
  if (!id || !block) {
    return null;
  }
  return Array.from(block.querySelectorAll<HTMLElement>('[data-ztracker-copy-source]')).find(
    (element) => element.getAttribute('data-ztracker-copy-source') === id,
  ) ?? null;
}

/** Select-and-execCommand fallback for non-secure contexts where navigator.clipboard is missing. */
function copyViaSelection(source: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || typeof document.execCommand !== 'function') {
    return false;
  }
  const previousRanges = Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i));
  const range = document.createRange();
  range.selectNodeContents(source);
  selection.removeAllRanges();
  selection.addRange(range);
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    selection.removeAllRanges();
    previousRanges.forEach((r) => selection.addRange(r));
  }
}

function showFeedback(control: HTMLElement, ok: boolean): void {
  const previousTimer = resetTimers.get(control);
  if (previousTimer) {
    clearTimeout(previousTimer);
  } else {
    control.dataset.ztrackerCopyTitle = control.getAttribute('title') ?? '';
  }
  control.classList.remove('is-copied', 'is-copy-failed');
  control.classList.add(ok ? 'is-copied' : 'is-copy-failed');
  control.setAttribute('title', ok ? 'Copied' : 'Copy failed');
  resetTimers.set(
    control,
    setTimeout(() => {
      control.classList.remove('is-copied', 'is-copy-failed');
      const original = control.dataset.ztrackerCopyTitle ?? '';
      if (original) {
        control.setAttribute('title', original);
      } else {
        control.removeAttribute('title');
      }
      delete control.dataset.ztrackerCopyTitle;
      resetTimers.delete(control);
    }, FEEDBACK_RESET_MS),
  );
}

/** Copies the control's target text; missing target does nothing. Never throws. */
export async function handleCopyControlClick(control: HTMLElement): Promise<void> {
  const source = findCopySource(control);
  if (!source) {
    return;
  }
  const text = (source.textContent ?? '').trim();
  let ok = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (!ok) {
    ok = copyViaSelection(source);
  }
  showFeedback(control, ok);
}
