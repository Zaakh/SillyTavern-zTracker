/** Shared DOM helpers for zTracker message-local status badges (per-run phase, step, elapsed timer and cancel). */

import { formatElapsed, startRunTimer } from '../run-timer.js';

export const AUTO_MODE_HOLD_CLASS = 'ztracker-auto-mode-hold';
export const AUTO_MODE_STATUS_CLASS = 'ztracker-auto-mode-status';
export const CONTEXT_MENU_STATUS_CLASS = 'ztracker-context-menu-status';
export const FULL_TRACKER_STATUS_CLASS = 'ztracker-full-tracker-status';
export const MESSAGE_STATUS_BASE_CLASS = 'ztracker-message-status';
export const RENDER_ERROR_STATUS_CLASS = 'ztracker-render-error-status';

type MessageStatusIndicatorOptions = {
  messageId: number | null;
  text: string;
  statusClassName: string;
  holdClassName?: string;
  iconClassName?: string;
  /** Identifies one run's badge; clearing and reattaching only touch the badge with this key. */
  runKey?: string;
  /** Shows the elapsed time since this timestamp (ms), so a reattached badge continues the clock. */
  startedAt?: number;
  /** Adds a cancel control that calls this handler. */
  onCancel?: () => void;
  /** Initial phase and step text (used when reattaching a running badge). */
  phase?: string;
  step?: string;
};

/** Updates the phase and step text of a running badge without recreating it. */
export type StatusIndicatorHandle = {
  setPhase: (phase: string) => void;
  setStep: (step: string) => void;
};

type RunState = { startedAt: number; phase: string; step: string; onCancel?: () => void };

/** Run state lives here, not in the DOM, so a host re-render that reattaches the badge keeps its elapsed time. */
const runStates = new Map<string, RunState>();
const timerStops = new WeakMap<Element, () => void>();

/** Finds badges of one variant under `root`, narrowed to a single run when a run key is given. */
function findBadges(root: ParentNode, statusClassName: string, runKey?: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`.${statusClassName}`)].filter(
    (element) => runKey === undefined || element.dataset.runKey === runKey,
  );
}

function removeBadge(element: Element): void {
  timerStops.get(element)?.();
  element.remove();
}

/** Removes one status-badge variant and its optional message hold styling from the current DOM. */
export function clearMessageStatusIndicator(options: {
  statusClassName: string;
  holdClassName?: string;
  messageId?: number | null;
  runKey?: string;
}): void {
  if (typeof document === 'undefined') {
    return;
  }

  if (options.messageId !== undefined && options.messageId !== null) {
    const messageBlock = document.querySelector(`.mes[mesid="${options.messageId}"]`);
    if (messageBlock instanceof HTMLElement) {
      findBadges(messageBlock, options.statusClassName, options.runKey).forEach(removeBadge);

      if (options.holdClassName) {
        messageBlock.classList.remove(options.holdClassName);
      }
    }

    return;
  }

  findBadges(document, options.statusClassName, options.runKey).forEach(removeBadge);

  if (!options.holdClassName) {
    return;
  }

  document.querySelectorAll(`.${options.holdClassName}`).forEach((element) => {
    element.classList.remove(options.holdClassName!);
  });
}

/** Reattaches a message-local zTracker status badge after host rerenders or state changes. */
export function syncMessageStatusIndicator(options: MessageStatusIndicatorOptions): void {
  clearMessageStatusIndicator({
    statusClassName: options.statusClassName,
    holdClassName: options.holdClassName,
    messageId: options.messageId,
    runKey: options.runKey,
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
  if (options.runKey) {
    status.dataset.runKey = options.runKey;
  }

  const icon = document.createElement('span');
  icon.className = options.iconClassName ?? 'ztracker-message-status-icon fa-solid fa-truck-fast';
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'ztracker-message-status-text';
  text.textContent = options.text;

  status.append(icon, text);

  if (options.runKey) {
    const step = document.createElement('span');
    step.className = 'ztracker-message-status-step';
    step.textContent = options.step ?? '';
    const phase = document.createElement('span');
    phase.className = 'ztracker-message-status-phase';
    phase.textContent = options.phase ?? '';
    status.append(step, phase);
  }

  if (options.startedAt !== undefined) {
    // aria-hidden: the live region announces phase/step changes, not every tick.
    const timer = document.createElement('span');
    timer.className = 'ztracker-message-status-timer';
    timer.setAttribute('aria-hidden', 'true');
    timer.textContent = formatElapsed(Date.now() - options.startedAt);
    status.append(timer);

    const startedAt = options.startedAt;
    const stopTimer = startRunTimer((elapsedMs) => {
      if (status.isConnected) {
        timer.textContent = formatElapsed(elapsedMs);
        return;
      }
      // A host re-render dropped the badge: stop this timer and, for a run that is still active,
      // rebuild the badge from the stored run state so it keeps its elapsed time.
      stopTimer();
      const state = options.runKey ? runStates.get(options.runKey) : undefined;
      if (state) {
        syncMessageStatusIndicator({ ...options, startedAt, phase: state.phase, step: state.step });
      }
    }, startedAt);
    timerStops.set(status, stopTimer);
  }

  if (options.onCancel) {
    const onCancel = options.onCancel;
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ztracker-message-status-cancel fa-solid fa-xmark';
    cancel.title = 'Cancel';
    cancel.setAttribute('aria-label', 'Cancel');
    cancel.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    });
    status.append(cancel);
  }

  const messageText = messageBlock.querySelector('.mes_text');
  if (messageText) {
    messageText.before(status);
    return;
  }

  messageBlock.prepend(status);
}

/**
 * Runs async work while keeping a per-run zTracker badge visible for that message.
 * The callback gets a handle to update the phase and step shown in the badge.
 */
export async function withMessageStatusIndicator<T>(
  options: Omit<MessageStatusIndicatorOptions, 'messageId' | 'startedAt' | 'phase' | 'step'> & { messageId: number },
  callback: (handle: StatusIndicatorHandle) => Promise<T>,
): Promise<T> {
  const runKey = options.runKey ?? `${options.statusClassName}:${options.messageId}`;
  const state: RunState = { startedAt: Date.now(), phase: '', step: '', onCancel: options.onCancel };
  runStates.set(runKey, state);

  const attach = () =>
    syncMessageStatusIndicator({ ...options, runKey, startedAt: state.startedAt, phase: state.phase, step: state.step });

  const update = (field: 'phase' | 'step', value: string) => {
    state[field] = value;
    const badge = findBadges(document, options.statusClassName, runKey)[0];
    const element = badge?.querySelector(`.ztracker-message-status-${field}`);
    if (element) {
      element.textContent = value;
    }
  };

  attach();
  try {
    return await callback({
      setPhase: (phase) => update('phase', phase),
      setStep: (step) => update('step', step),
    });
  } finally {
    runStates.delete(runKey);
    clearMessageStatusIndicator({
      statusClassName: options.statusClassName,
      holdClassName: options.holdClassName,
      messageId: options.messageId,
      runKey,
    });
  }
}
