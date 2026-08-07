/**
 * Browser file-picker helper for importing exported JSON definitions.
 * Opens a native file dialog and resolves the selected file's text contents,
 * or null when the user cancels.
 */

/** Opens a native file picker and resolves the chosen text file's contents, or null if cancelled. */
export function readTextFileViaPicker(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';

    let settled = false;
    let changeStarted = false;
    const finish = (value: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      input.remove();
      resolve(value);
    };

    input.addEventListener('change', () => {
      changeStarted = true;
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      file.text().then(finish, () => finish(null));
    });

    // ponytail: file inputs emit no cancel event, so a one-shot window focus
    // handler approximates "dialog dismissed". Upgrade path: replace with the
    // `cancel` event once the target browsers support it.
    window.addEventListener(
      'focus',
      () => {
        setTimeout(() => {
          if (!changeStarted) {
            finish(null);
          }
        }, 300);
      },
      { once: true },
    );

    document.body.appendChild(input);
    input.click();
  });
}
