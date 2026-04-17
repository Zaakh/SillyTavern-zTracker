/** Shared DOM helpers for zTracker message-local status badges. */

export const AUTO_MODE_HOLD_CLASS = 'ztracker-auto-mode-hold';
export const AUTO_MODE_STATUS_CLASS = 'ztracker-auto-mode-status';
export const CONTEXT_MENU_STATUS_CLASS = 'ztracker-context-menu-status';
export const FULL_TRACKER_STATUS_CLASS = 'ztracker-full-tracker-status';
export const MESSAGE_STATUS_BASE_CLASS = 'ztracker-message-status';

type MessageStatusIndicatorOptions = {
  messageId: number | null;
  text: string;
  statusClassName: string;
  holdClassName?: string;
};

/** Removes one status-badge variant and its optional message hold styling from the current DOM. */
export function clearMessageStatusIndicator(options: {
  statusClassName: string;
  holdClassName?: string;
  messageId?: number | null;
}): void {
  if (typeof document === 'undefined') {
    return;
  }

  if (options.messageId !== undefined && options.messageId !== null) {
    const messageBlock = document.querySelector(`.mes[mesid="${options.messageId}"]`);
    if (messageBlock instanceof HTMLElement) {
      messageBlock.querySelectorAll(`.${options.statusClassName}`).forEach((element) => {
        element.remove();
      });

      if (options.holdClassName) {
        messageBlock.classList.remove(options.holdClassName);
      }
    }

    return;
  }

  document.querySelectorAll(`.${options.statusClassName}`).forEach((element) => {
    element.remove();
  });

  if (!options.holdClassName) {
    return;
  }

  const holdClassName = options.holdClassName;

  document.querySelectorAll(`.${holdClassName}`).forEach((element) => {
    element.classList.remove(holdClassName);
  });
}

/** Reattaches a message-local zTracker status badge after host rerenders or state changes. */
export function syncMessageStatusIndicator(options: MessageStatusIndicatorOptions): void {
  clearMessageStatusIndicator({
    statusClassName: options.statusClassName,
    holdClassName: options.holdClassName,
    messageId: options.messageId,
  });

  if (typeof document === 'undefined' || options.messageId === null) {
    return;
  }

  const messageBlock = document.querySelector(`.mes[mesid="${options.messageId}"]`);
  if (!(messageBlock instanceof HTMLElement)) {
    return;
  }

  if (options.holdClassName) {
    messageBlock.classList.add(options.holdClassName);
  }

  const status = document.createElement('div');
  status.className = `${MESSAGE_STATUS_BASE_CLASS} ${options.statusClassName}`;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const icon = document.createElement('span');
  icon.className = 'ztracker-message-status-icon fa-solid fa-truck-fast';
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'ztracker-message-status-text';
  text.textContent = options.text;

  status.append(icon, text);

  const messageText = messageBlock.querySelector('.mes_text');
  if (messageText) {
    messageText.before(status);
    return;
  }

  messageBlock.prepend(status);
}

/** Runs async work while keeping a message-local zTracker badge visible for that message. */
export async function withMessageStatusIndicator<T>(
  options: Omit<MessageStatusIndicatorOptions, 'messageId'> & { messageId: number },
  callback: () => Promise<T>,
): Promise<T> {
  syncMessageStatusIndicator(options);
  try {
    return await callback();
  } finally {
    clearMessageStatusIndicator({
      statusClassName: options.statusClassName,
      holdClassName: options.holdClassName,
      messageId: options.messageId,
    });
  }
}