import { EXTENSION_KEY } from '../config.js';

/** Character-card field name used to persist zTracker's per-character auto-mode exclusion. */
export const CHARACTER_AUTO_MODE_EXCLUDED_FIELD = 'autoModeExcluded';

/** DOM id for the character-panel toggle button so repeated sync passes remain idempotent. */
export const CHARACTER_AUTO_MODE_BUTTON_ID = 'ztracker-character-auto-mode-toggle';

type CharacterLike = {
  avatar?: string;
  data?: Record<string, unknown> & {
    extensions?: Record<string, unknown>;
  };
};

type ChatMessageLike = {
  original_avatar?: string;
};

type CharacterContextLike = {
  characters?: CharacterLike[];
  chat?: ChatMessageLike[];
  characterId?: unknown;
  writeExtensionField?: (characterId: number, key: string, value: unknown) => unknown;
};

/** Returns the zTracker extension payload stored on a character card, if present. */
export function getCharacterZTrackerExtensionData(character: CharacterLike | undefined): Record<string, unknown> {
  const data = character?.data?.extensions?.[EXTENSION_KEY];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {};
  }
  return data as Record<string, unknown>;
}

/** Reads whether the supplied character is excluded from zTracker auto-mode. */
export function isCharacterAutoModeExcluded(character: CharacterLike | undefined): boolean {
  return getCharacterZTrackerExtensionData(character)[CHARACTER_AUTO_MODE_EXCLUDED_FIELD] === true;
}

/** Resolves a SillyTavern character id from a rendered message's original avatar reference. */
export function resolveCharacterIdFromMessage(
  characters: CharacterLike[] | undefined,
  message: ChatMessageLike | undefined,
): number | undefined {
  if (!Array.isArray(characters)) {
    return undefined;
  }

  const avatar = typeof message?.original_avatar === 'string' ? message.original_avatar : undefined;
  if (!avatar) {
    return undefined;
  }

  const characterId = characters.findIndex((character) => character?.avatar === avatar);
  return characterId >= 0 ? characterId : undefined;
}

/** Returns the active solo-character id from the current host context, when available. */
export function getCurrentCharacterId(context: CharacterContextLike): number | undefined {
  return Number.isInteger(context.characterId) && Number(context.characterId) >= 0
    ? Number(context.characterId)
    : undefined;
}

/** Determines whether an incoming character-rendered message should be skipped by auto-mode. */
export function shouldAutoGenerateForCharacterMessage(context: CharacterContextLike, messageId: number): boolean {
  const message = context.chat?.[messageId];
  const characterId = resolveCharacterIdFromMessage(context.characters, message);
  if (characterId === undefined) {
    return true;
  }

  return !isCharacterAutoModeExcluded(context.characters?.[characterId]);
}

/** Determines whether an outgoing user-rendered message should be skipped for the active solo character. */
export function shouldAutoGenerateForUserMessage(context: CharacterContextLike): boolean {
  const characterId = getCurrentCharacterId(context);
  if (characterId === undefined) {
    return true;
  }

  return !isCharacterAutoModeExcluded(context.characters?.[characterId]);
}

/** Persists and mirrors the per-character exclusion flag into the live SillyTavern context. */
export function setCharacterAutoModeExcluded(
  context: CharacterContextLike,
  characterId: number,
  excluded: boolean,
): boolean {
  const characters = context.characters;
  if (!Array.isArray(characters) || characterId < 0 || characterId >= characters.length) {
    return false;
  }

  const character = characters[characterId] ?? {};
  const currentExtensionData = getCharacterZTrackerExtensionData(character);
  const nextExtensionData = {
    ...currentExtensionData,
    [CHARACTER_AUTO_MODE_EXCLUDED_FIELD]: excluded,
  };

  character.data = character.data ?? {};
  character.data.extensions = character.data.extensions ?? {};
  character.data.extensions[EXTENSION_KEY] = nextExtensionData;

  context.writeExtensionField?.(characterId, EXTENSION_KEY, nextExtensionData);
  return true;
}

/** Toggles the exclusion flag for the currently active solo character. */
export function toggleCurrentCharacterAutoModeExcluded(
  context: CharacterContextLike,
): { characterId: number; excluded: boolean } | null {
  const characterId = getCurrentCharacterId(context);
  if (characterId === undefined) {
    return null;
  }

  const nextExcluded = !isCharacterAutoModeExcluded(context.characters?.[characterId]);
  if (!setCharacterAutoModeExcluded(context, characterId, nextExcluded)) {
    return null;
  }

  return { characterId, excluded: nextExcluded };
}

/** Finds the character edit-panel action row where zTracker should inject its toggle button. */
export function findCharacterPanelButtonRow(root: ParentNode = document): HTMLElement | null {
  const form = root.querySelector('#form_create');
  if (!(form instanceof HTMLElement)) {
    return null;
  }

  const explicitSelectors = [
    '.panel_button_row',
    '.avatar_button_row',
    '.right_menu_button_div',
    '.avatar-buttons',
  ];
  for (const selector of explicitSelectors) {
    const match = form.querySelector(selector);
    if (match instanceof HTMLElement) {
      return match;
    }
  }

  const candidates = Array.from(form.querySelectorAll<HTMLElement>('div')).filter((element) => {
    const childButtons = Array.from(element.children).filter(
      (child) =>
        child instanceof HTMLElement &&
        (child.classList.contains('menu_button') || child.classList.contains('right_menu_button') || child.tagName === 'BUTTON'),
    );
    return childButtons.length >= 2;
  });

  return candidates[0] ?? null;
}

function buildCharacterAutoModeButtonTitle(options: {
  hasCharacter: boolean;
  excluded: boolean;
  autoModeEnabled: boolean;
}): string {
  const { hasCharacter, excluded, autoModeEnabled } = options;
  if (!hasCharacter) {
    return 'zTracker: Open a character card to toggle auto-mode exclusion.';
  }
  if (!autoModeEnabled) {
    return excluded
      ? 'zTracker: This character stays excluded while auto mode is disabled globally.'
      : 'zTracker: Auto mode is disabled globally. Enable it to use this character exclusion toggle.';
  }
  return excluded
    ? 'zTracker: Auto mode excluded for this character. Click to include.'
    : 'zTracker: Auto mode active for this character. Click to exclude.';
}

/** Creates or refreshes the character-panel exclusion button and keeps its state in sync. */
export function syncCharacterAutoModeButton(options: {
  context: CharacterContextLike;
  autoModeEnabled: boolean;
  root?: ParentNode;
  onToggle?: (result: { characterId: number; excluded: boolean }) => void;
}): HTMLElement | null {
  const { context, autoModeEnabled, root = document, onToggle } = options;
  const buttonRow = findCharacterPanelButtonRow(root);
  if (!buttonRow) {
    return null;
  }

  let button = buttonRow.querySelector<HTMLElement>(`#${CHARACTER_AUTO_MODE_BUTTON_ID}`);
  if (!button) {
    button = document.createElement('div');
    button.id = CHARACTER_AUTO_MODE_BUTTON_ID;
    button.className = 'menu_button interactable fa-solid fa-truck ztracker-character-auto-mode-button';
    button.setAttribute('role', 'button');
    button.tabIndex = 0;
    button.addEventListener('click', () => {
      const result = toggleCurrentCharacterAutoModeExcluded(context);
      if (!result) {
        return;
      }
      syncCharacterAutoModeButton({ context, autoModeEnabled, root, onToggle });
      onToggle?.(result);
    });
    buttonRow.appendChild(button);
  }

  const characterId = getCurrentCharacterId(context);
  const excluded = characterId !== undefined && isCharacterAutoModeExcluded(context.characters?.[characterId]);
  const hasCharacter = characterId !== undefined;

  button.dataset.excluded = String(excluded);
  button.setAttribute('aria-pressed', String(excluded));
  button.style.color = !autoModeEnabled ? 'var(--SmartThemeEmColor, #888)' : excluded ? 'var(--SmartThemeQuoteColor, #e74c3c)' : '';
  button.style.opacity = !autoModeEnabled ? '0.7' : '1';
  button.title = buildCharacterAutoModeButtonTitle({ hasCharacter, excluded, autoModeEnabled });

  return button;
}