import type { TrackerActions } from './tracker-actions.js';

type AutoModeHostContext = {
  generate?: (type?: string, options?: { automatic_trigger?: boolean }) => Promise<unknown>;
  stopGeneration?: () => boolean;
};

type OutgoingAutoModeState = {
  pendingMessageId: number | null;
  allowNextGenerationStart: boolean;
  shouldBlockNextGenerationStart: boolean;
  expectedTrackerGenerationStarts: number;
  observedHostGenerationStart: boolean;
  hostGenerationWasSuppressed: boolean;
  runId: number;
};

/** Coordinates the outgoing auto-mode hold badge, host stop button, and host generation gating. */
export function createOutgoingAutoModeController(options: { actions: TrackerActions }) {
  const { actions } = options;
  const state: OutgoingAutoModeState = {
    pendingMessageId: null,
    allowNextGenerationStart: false,
    shouldBlockNextGenerationStart: false,
    expectedTrackerGenerationStarts: 0,
    observedHostGenerationStart: false,
    hostGenerationWasSuppressed: false,
    runId: 0,
  };

  /** Clears the current outgoing auto-mode hold and optionally invalidates the active run token. */
  const reset = (options: { invalidateRun?: boolean } = {}) => {
    state.pendingMessageId = null;
    state.allowNextGenerationStart = false;
    state.shouldBlockNextGenerationStart = false;
    state.expectedTrackerGenerationStarts = 0;
    state.observedHostGenerationStart = false;
    state.hostGenerationWasSuppressed = false;
    if (options.invalidateRun) {
      state.runId += 1;
    }
  };

  /** Resolves the live host send button in the prompt bar. */
  const getSendButton = () => {
    const element = document.querySelector('#send_but');
    return element instanceof HTMLElement ? element : null;
  };

  /** Mirrors the pending-message state onto the host send button so it behaves like a tracker stop control. */
  const syncSendButton = () => {
    if (typeof document === 'undefined') {
      return;
    }

    const sendButton = getSendButton();
    if (!sendButton) {
      return;
    }

    if (state.pendingMessageId === null) {
      if (sendButton.dataset.ztrackerAutoModeManaged !== 'true') {
        return;
      }

      const originalClassName = sendButton.dataset.ztrackerOriginalClassName;
      if (originalClassName) {
        sendButton.className = originalClassName;
      }

      sendButton.title = sendButton.dataset.ztrackerOriginalTitle ?? '';
      const originalAriaLabel = sendButton.dataset.ztrackerOriginalAriaLabel;
      if (originalAriaLabel) {
        sendButton.setAttribute('aria-label', originalAriaLabel);
      } else {
        sendButton.removeAttribute('aria-label');
      }

      delete sendButton.dataset.ztrackerAutoModeManaged;
      delete sendButton.dataset.ztrackerOriginalClassName;
      delete sendButton.dataset.ztrackerOriginalTitle;
      delete sendButton.dataset.ztrackerOriginalAriaLabel;
      return;
    }

    if (sendButton.dataset.ztrackerAutoModeManaged !== 'true') {
      sendButton.dataset.ztrackerAutoModeManaged = 'true';
      sendButton.dataset.ztrackerOriginalClassName = sendButton.className;
      sendButton.dataset.ztrackerOriginalTitle = sendButton.getAttribute('title') ?? '';
      const originalAriaLabel = sendButton.getAttribute('aria-label');
      if (originalAriaLabel !== null) {
        sendButton.dataset.ztrackerOriginalAriaLabel = originalAriaLabel;
      }
    }

    sendButton.classList.remove('fa-paper-plane');
    sendButton.classList.add('fa-stop');
    sendButton.title = 'Stop tracker generation';
    sendButton.setAttribute('aria-label', 'Stop tracker generation');
  };

  /** Keeps the pending-message badge attached even when SillyTavern rerenders the message DOM. */
  const syncHoldIndicator = () => {
    if (typeof document === 'undefined') {
      return;
    }

    document.querySelectorAll('.ztracker-auto-mode-hold').forEach((element) => {
      element.classList.remove('ztracker-auto-mode-hold');
    });
    document.querySelectorAll('.ztracker-auto-mode-status').forEach((element) => {
      element.remove();
    });

    if (state.pendingMessageId === null) {
      return;
    }

    const messageBlock = document.querySelector(`.mes[mesid="${state.pendingMessageId}"]`);
    if (!(messageBlock instanceof HTMLElement)) {
      return;
    }

    messageBlock.classList.add('ztracker-auto-mode-hold');

    const status = document.createElement('div');
    status.className = 'ztracker-auto-mode-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const icon = document.createElement('span');
    icon.className = 'ztracker-auto-mode-status-icon fa-solid fa-truck-fast';
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'ztracker-auto-mode-status-text';
    text.textContent = 'Generating tracker before reply';

    status.append(icon, text);

    const messageText = messageBlock.querySelector('.mes_text');
    if (messageText) {
      messageText.before(status);
    } else {
      messageBlock.prepend(status);
    }
  };

  /** Aligns the hold badge and host send-button state to the same pending-message source of truth. */
  const syncUi = () => {
    syncHoldIndicator();
    syncSendButton();
  };

  /** Filters out the controller's own badge mutations so observer churn does not loop forever. */
  const isIndicatorOnlyMutation = (mutation: MutationRecord) => {
    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return changedNodes.length > 0 && changedNodes.every((node) =>
      node instanceof Element && node.classList.contains('ztracker-auto-mode-status')
    );
  };

  /** Cancels the live host generation if the host exposes a stopGeneration API. */
  const stopHostGeneration = () => {
    const context = SillyTavern.getContext() as AutoModeHostContext;
    if (typeof context?.stopGeneration !== 'function') {
      return false;
    }

    return context.stopGeneration();
  };

  /** Resumes the host reply generation once the tracker run has fully completed. */
  const resumeHostGeneration = async () => {
    const context = SillyTavern.getContext() as AutoModeHostContext;
    if (typeof context?.generate !== 'function') {
      return false;
    }

    state.allowNextGenerationStart = true;
    try {
      await context.generate(undefined, { automatic_trigger: true });
      return true;
    } finally {
      state.allowNextGenerationStart = false;
    }
  };

  /** Marks that zTracker is about to dispatch one of its own tracker requests while the outgoing hold is active. */
  const noteTrackerRequestStart = () => {
    if (state.pendingMessageId === null) {
      return;
    }

    state.expectedTrackerGenerationStarts += 1;
  };

  /** Attempts to stop the host reply immediately after send and records when the hold already succeeded. */
  const tryStopPendingHostGeneration = () => {
    if (state.pendingMessageId === null) {
      return false;
    }

    const stopped = stopHostGeneration();
    if (!stopped) {
      return false;
    }

    state.observedHostGenerationStart = true;
    state.hostGenerationWasSuppressed = true;
    state.shouldBlockNextGenerationStart = false;
    return true;
  };

  /** Starts tracking a new outgoing auto-mode run and returns the current run token. */
  const beginPendingMessage = (messageId: number) => {
    if (state.pendingMessageId !== null && state.pendingMessageId !== messageId) {
      reset({ invalidateRun: true });
      syncUi();
    }

    const runId = ++state.runId;
    state.pendingMessageId = messageId;
    state.allowNextGenerationStart = false;
    state.shouldBlockNextGenerationStart = true;
    syncUi();
    return runId;
  };

  /** Clears the pending state only if the completion belongs to the current run token. */
  const finishPendingMessage = (messageId: number, runId: number) => {
    if (state.pendingMessageId !== messageId || state.runId !== runId) {
      return {
        finished: false,
        shouldResumeHostGeneration: false,
      };
    }

    const shouldResumeHostGeneration = !state.observedHostGenerationStart || state.hostGenerationWasSuppressed;
    reset();
    syncUi();
    return {
      finished: true,
      shouldResumeHostGeneration,
    };
  };

  /** Refreshes the badge when the pending message is rerendered by the host. */
  const handleUserMessageRendered = (messageId: number) => {
    if (messageId !== state.pendingMessageId) {
      return;
    }

    syncUi();
  };

  /** Prevents the host from racing ahead while zTracker still owns the outgoing turn. */
  const handleGenerationStarted = () => {
    if (state.pendingMessageId === null) {
      return;
    }

    if (state.allowNextGenerationStart) {
      state.allowNextGenerationStart = false;
      return;
    }

    if (state.expectedTrackerGenerationStarts > 0) {
      state.expectedTrackerGenerationStarts -= 1;
      return;
    }

    if (!state.shouldBlockNextGenerationStart) {
      return;
    }

    state.shouldBlockNextGenerationStart = false;
    state.observedHostGenerationStart = true;
    if (stopHostGeneration()) {
      state.hostGenerationWasSuppressed = true;
    }
  };

  /** Installs the DOM observer and stop-button capture handler used by outgoing auto mode. */
  const installDocumentHandlers = () => {
    document.addEventListener(
      'click',
      (event) => {
        if (state.pendingMessageId === null) {
          return;
        }

        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }

        const stopButton = target.closest('#send_but');
        if (!(stopButton instanceof HTMLElement)) {
          return;
        }

        if (typeof actions.cancelTracker !== 'function') {
          return;
        }

        if (!actions.cancelTracker(state.pendingMessageId)) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        reset({ invalidateRun: true });
        syncUi();
      },
      true,
    );

    if (typeof MutationObserver === 'undefined') {
      return;
    }

    const observer = new MutationObserver((mutations) => {
      if (state.pendingMessageId === null) {
        return;
      }

      const hasRelevantMutation = mutations.some((mutation) => !isIndicatorOnlyMutation(mutation));
      if (!hasRelevantMutation) {
        return;
      }

      syncUi();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  return {
    beginPendingMessage,
    finishPendingMessage,
    getPendingMessageId: () => state.pendingMessageId,
    handleGenerationStarted,
    handleUserMessageRendered,
    installDocumentHandlers,
    noteTrackerRequestStart,
    resetAndSync(options: { invalidateRun?: boolean } = {}) {
      reset(options);
      syncUi();
    },
    resumeHostGeneration,
    stopHostGeneration,
    syncUi,
    tryStopPendingHostGeneration,
  };
}