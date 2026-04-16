/** Manages the zTracker parts dropdown while it is portaled to the document body. */
type PartsMenuPortalState = {
  details: HTMLDetailsElement;
  summary: HTMLElement;
  list: HTMLElement;
  placeholder: Comment;
  messageId: number | null;
  reposition: () => void;
};

type PartsMenuPortalController = {
  getMessageIdForTarget: (target: HTMLElement) => number | null;
};

let activePartsMenu: PartsMenuPortalState | null = null;

/** Repositions the portaled menu so it stays within the viewport near its summary button. */
function positionPartsMenu(list: HTMLElement, summary: HTMLElement): void {
  const rect = summary.getBoundingClientRect();
  const viewportMargin = 8;
  const top = rect.bottom + 6;
  const width = Math.max(list.offsetWidth, 260);
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const maxLeft = Math.max(scrollX + viewportMargin, scrollX + window.innerWidth - viewportMargin - width);
  const desiredLeft = rect.right - width;
  const left = Math.max(scrollX + viewportMargin, Math.min(desiredLeft + scrollX, maxLeft));
  const maxHeightPx = Math.max(120, window.innerHeight - top - viewportMargin);

  list.style.top = `${Math.round(top + scrollY)}px`;
  list.style.left = `${Math.round(left)}px`;
  list.style.maxHeight = `${Math.round(maxHeightPx)}px`;
}

/** Restores a portaled parts menu back into its original tracker container. */
function restorePartsMenu(state: PartsMenuPortalState): void {
  state.list.classList.remove('ztracker-parts-list-portal');
  state.list.style.removeProperty('position');
  state.list.style.removeProperty('z-index');
  state.list.style.removeProperty('right');
  state.list.style.removeProperty('top');
  state.list.style.removeProperty('left');
  state.list.style.removeProperty('max-height');
  state.list.style.removeProperty('visibility');

  if (state.placeholder.parentNode) {
    state.placeholder.replaceWith(state.list);
  } else {
    state.list.remove();
  }

  window.removeEventListener('resize', state.reposition);
  window.removeEventListener('scroll', state.reposition, true);
}

/** Closes the currently active parts menu before another one is opened or focus moves away. */
function closeActivePartsMenu(): void {
  if (!activePartsMenu) {
    return;
  }

  const state = activePartsMenu;
  activePartsMenu = null;
  if (state.details.isConnected && state.details.open) {
    state.details.open = false;
  }

  restorePartsMenu(state);
}

/** Moves the open parts menu into the document body so host overflow clipping cannot hide it. */
function portalPartsMenu(details: HTMLDetailsElement): void {
  const summary = details.querySelector('summary') as HTMLElement | null;
  const list = details.querySelector('.ztracker-parts-list') as HTMLElement | null;
  if (!summary || !list) {
    return;
  }

  if (activePartsMenu?.details && activePartsMenu.details !== details) {
    closeActivePartsMenu();
  }

  const placeholder = document.createComment('ztracker-parts-list-placeholder');
  list.replaceWith(placeholder);
  document.body.append(list);
  list.classList.add('ztracker-parts-list-portal');
  list.style.position = 'absolute';
  list.style.zIndex = '2147483647';
  list.style.right = 'auto';

  const messageIdText = details.closest('.mes')?.getAttribute('mesid') ?? '';
  const parsedMessageId = Number(messageIdText);
  const messageId = Number.isFinite(parsedMessageId) ? parsedMessageId : null;
  const reposition = () => positionPartsMenu(list, summary);
  const state: PartsMenuPortalState = { details, summary, list, placeholder, messageId, reposition };
  activePartsMenu = state;

  list.style.visibility = 'hidden';
  requestAnimationFrame(() => {
    if (!list.isConnected) {
      return;
    }
    if (!details.isConnected || !details.open) {
      if (list.classList.contains('ztracker-parts-list-portal')) {
        list.style.visibility = '';
        restorePartsMenu(state);
        if (activePartsMenu?.details === details) {
          activePartsMenu = null;
        }
      }
      return;
    }

    list.style.visibility = '';
    reposition();
  });

  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
}

/** Installs the global parts-menu listeners and exposes a resolver for portaled menu clicks. */
export function installPartsMenuPortalHandlers(): PartsMenuPortalController {
  document.addEventListener(
    'toggle',
    (event) => {
      const details = event.target as HTMLDetailsElement;
      if (!details?.classList?.contains('ztracker-parts-details')) {
        return;
      }

      if (details.open) {
        portalPartsMenu(details);
      } else if (activePartsMenu?.details === details) {
        restorePartsMenu(activePartsMenu);
        activePartsMenu = null;
      }
    },
    true,
  );

  document.addEventListener(
    'mousedown',
    (event) => {
      if (!activePartsMenu) {
        return;
      }

      const target = event.target as Node;
      if (activePartsMenu.list.contains(target) || activePartsMenu.summary.contains(target)) {
        return;
      }

      closeActivePartsMenu();
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (!activePartsMenu || event.key !== 'Escape') {
        return;
      }

      closeActivePartsMenu();
    },
    true,
  );

  return {
    getMessageIdForTarget(target: HTMLElement): number | null {
      if (!activePartsMenu || !activePartsMenu.list.contains(target)) {
        return null;
      }

      return activePartsMenu.messageId;
    },
  };
}