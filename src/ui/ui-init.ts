import type { ExtensionSettings } from '../config.js';
import { EXTENSION_KEY } from '../config.js';
import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import type { ChatMessage } from 'sillytavern-utils-lib/types';
import { EventNames } from 'sillytavern-utils-lib/types';
import type { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import type { TrackerActions } from './tracker-actions.js';
import { includeZTrackerMessages } from '../tracker.js';
import { st_echo } from 'sillytavern-utils-lib/config';

const incomingTypes = [AutoModeOptions.RESPONSES, AutoModeOptions.BOTH];
const outgoingTypes = [AutoModeOptions.INPUT, AutoModeOptions.BOTH];

type Rgb = { r: number; g: number; b: number; a: number };

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function parseCssColorToRgb(color: string): Rgb | null {
  const c = (color || '').trim().toLowerCase();
  if (!c) return null;
  if (c === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  // Computed styles are typically rgb()/rgba(). Handle both.
  const m = c.match(/^rgba?\(([^)]+)\)$/);
  if (!m) return null;
  const parts = m[1].split(',').map((p) => p.trim());
  if (parts.length < 3) return null;

  const r = Number(parts[0]);
  const g = Number(parts[1]);
  const b = Number(parts[2]);
  const a = parts.length >= 4 ? Number(parts[3]) : 1;
  if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
  return { r: clampByte(r), g: clampByte(g), b: clampByte(b), a: Math.max(0, Math.min(1, a)) };
}

function rgbToLuma(rgb: Rgb): number {
  // Relative luminance approximation on sRGB.
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

function findNearestNonTransparentBackground(start: Element | null): Rgb | null {
  let el: Element | null = start;
  while (el) {
    const style = getComputedStyle(el);
    const bg = parseCssColorToRgb(style.backgroundColor);
    if (bg && bg.a > 0.05) return bg;
    el = el.parentElement;
  }
  // Fallback to body/html.
  const bodyBg = parseCssColorToRgb(getComputedStyle(document.body).backgroundColor);
  if (bodyBg && bodyBg.a > 0.05) return bodyBg;
  const htmlBg = parseCssColorToRgb(getComputedStyle(document.documentElement).backgroundColor);
  if (htmlBg && htmlBg.a > 0.05) return htmlBg;
  return { r: 0, g: 0, b: 0, a: 1 };
}

function setZTrackerMenuThemeVars(): void {
  if (typeof document === 'undefined') return;

  // Try to sample from the chat area first; fall back to a message element; then body/html.
  const sampleTarget =
    (document.querySelector('#chat') as Element | null) ??
    (document.querySelector('#chatLog') as Element | null) ??
    (document.querySelector('.chat') as Element | null) ??
    (document.querySelector('.mes') as Element | null) ??
    document.body;

  const bg = findNearestNonTransparentBackground(sampleTarget);
  if (!bg) return;

  const luma = rgbToLuma(bg);
  const isLight = luma > 0.6;
  const menuAlpha = isLight ? 0.96 : 0.92;

  const root = document.documentElement;
  root.style.setProperty('--ztracker-menu-bg', `rgba(${bg.r}, ${bg.g}, ${bg.b}, ${menuAlpha})`);
  root.style.setProperty('--ztracker-menu-border', isLight ? 'rgba(0, 0, 0, 0.18)' : 'rgba(255, 255, 255, 0.12)');
  root.style.setProperty('--ztracker-menu-part-bg', isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.06)');
  root.style.setProperty('--ztracker-menu-item-bg', isLight ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.03)');
  root.style.setProperty('--ztracker-menu-hover-bg', isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.10)');
}

function installZTrackerThemeObserver(): void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;

  let timer: number | undefined;
  const schedule = () => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      setZTrackerMenuThemeVars();
    }, 50);
  };

  const observer = new MutationObserver(() => schedule());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });

  // Initial.
  setZTrackerMenuThemeVars();
}

export async function initializeGlobalUI(options: {
  globalContext: any;
  settingsManager: ExtensionSettingsManager<ExtensionSettings>;
  actions: TrackerActions;
  renderTrackerWithDeps: (messageId: number) => void;
}) {
  const { globalContext, settingsManager, actions, renderTrackerWithDeps } = options;

  // Keep menu colors in sync with the current SillyTavern theme.
  installZTrackerThemeObserver();

  const zTrackerIcon = document.createElement('div');
  zTrackerIcon.title = 'zTracker';
  zTrackerIcon.className = 'mes_button mes_ztracker_button fa-solid fa-truck-moving interactable';
  zTrackerIcon.tabIndex = 0;
  document.querySelector('#message_template .mes_buttons .extraMesButtons')?.prepend(zTrackerIcon);

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const messageEl = target.closest('.mes');

    if (!messageEl) return;
    const messageId = Number(messageEl.getAttribute('mesid'));
    if (isNaN(messageId)) return;

    const fieldButton = target.closest('.ztracker-array-item-field-regenerate-button') as HTMLElement | null;
    if (fieldButton) {
      const partKey = fieldButton.getAttribute('data-ztracker-part') ?? '';
      const indexText = fieldButton.getAttribute('data-ztracker-index') ?? '';
      const index = Number(indexText);
      const name = fieldButton.getAttribute('data-ztracker-name') ?? '';
      const idKey = fieldButton.getAttribute('data-ztracker-idkey') ?? '';
      const idValue = fieldButton.getAttribute('data-ztracker-idvalue') ?? '';
      const fieldKey = fieldButton.getAttribute('data-ztracker-field') ?? '';

      if (
        partKey &&
        fieldKey &&
        idKey &&
        idValue &&
        'generateTrackerArrayItemFieldByIdentity' in actions
      ) {
        // @ts-ignore - optional capability depending on build/version.
        actions.generateTrackerArrayItemFieldByIdentity(messageId, partKey, idKey, idValue, fieldKey);
      } else if (partKey && fieldKey && name && 'generateTrackerArrayItemFieldByName' in actions) {
        // @ts-ignore - optional capability depending on build/version.
        actions.generateTrackerArrayItemFieldByName(messageId, partKey, name, fieldKey);
      } else if (partKey && fieldKey && !isNaN(index) && 'generateTrackerArrayItemField' in actions) {
        // @ts-ignore - optional capability depending on build/version.
        actions.generateTrackerArrayItemField(messageId, partKey, index, fieldKey);
      }

      return;
    }

    const itemButton = target.closest('.ztracker-array-item-regenerate-button') as HTMLElement | null;
    if (itemButton) {
      const partKey = itemButton.getAttribute('data-ztracker-part') ?? '';
      const indexText = itemButton.getAttribute('data-ztracker-index') ?? '';
      const index = Number(indexText);
      const name = itemButton.getAttribute('data-ztracker-name') ?? '';
      const idKey = itemButton.getAttribute('data-ztracker-idkey') ?? '';
      const idValue = itemButton.getAttribute('data-ztracker-idvalue') ?? '';

      if (partKey && idKey && idValue && 'generateTrackerArrayItemByIdentity' in actions) {
        // @ts-ignore - optional capability depending on build/version.
        actions.generateTrackerArrayItemByIdentity(messageId, partKey, idKey, idValue);
      } else if (partKey && name) {
        actions.generateTrackerArrayItemByName(messageId, partKey, name);
      } else if (partKey && !isNaN(index)) {
        actions.generateTrackerArrayItem(messageId, partKey, index);
      }
      return;
    }

    const partButton = target.closest('.ztracker-part-regenerate-button') as HTMLElement | null;
    if (partButton) {
      const partKey = partButton.getAttribute('data-ztracker-part') ?? '';
      if (partKey) {
        actions.generateTrackerPart(messageId, partKey);
      }
      return;
    }

    if (target.classList.contains('mes_ztracker_button')) {
      actions.generateTracker(messageId);
    } else if (target.classList.contains('ztracker-edit-button')) {
      actions.editTracker(messageId);
    } else if (target.classList.contains('ztracker-regenerate-button')) {
      actions.generateTracker(messageId);
    } else if (target.classList.contains('ztracker-delete-button')) {
      actions.deleteTracker(messageId);
    }
  });

  await actions.renderExtensionTemplates();

  const settings = settingsManager.getSettings();
  globalContext.eventSource.on(
    EventNames.CHARACTER_MESSAGE_RENDERED,
    (messageId: number) => incomingTypes.includes(settings.autoMode) && actions.generateTracker(messageId),
  );
  globalContext.eventSource.on(
    EventNames.USER_MESSAGE_RENDERED,
    (messageId: number) => outgoingTypes.includes(settings.autoMode) && actions.generateTracker(messageId),
  );

  globalContext.eventSource.on(EventNames.CHAT_CHANGED, () => {
    const { saveChat } = globalContext;
    let chatModified = false;
    globalContext.chat.forEach((message: any, i: number) => {
      try {
        renderTrackerWithDeps(i);
      } catch (error) {
        console.error(`Error rendering zTracker on message ${i}, removing data:`, error);
        st_echo('error', 'A zTracker template failed to render. Removing tracker from the message.');
        if (message?.extra?.[EXTENSION_KEY]) {
          delete message.extra[EXTENSION_KEY];
          chatModified = true;
        }
      }
    });
    if (chatModified) {
      saveChat();
    }
  });

  (globalThis as any).ztrackerGenerateInterceptor = (chat: ChatMessage[]) => {
    const newChat = includeZTrackerMessages(chat, settingsManager.getSettings());
    chat.length = 0;
    chat.push(...newChat);
  };
}
