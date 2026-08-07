import { DEFAULT_MODULE_ID, EXTENSION_KEY } from '../config.js';

/** Character-card field name used to persist zTracker's per-character auto-mode exclusion. */
export const CHARACTER_AUTO_MODE_EXCLUDED_FIELD = 'autoModeExcluded';
export const CHARACTER_AUTO_MODE_EXCLUSIONS_FIELD = 'autoModeExclusions';

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

type CharacterPanelButtonSyncOptions = {
  autoModeEnabled: boolean;
  root?: ParentNode;
  context?: CharacterContextLike;
  getContext?: () => CharacterContextLike;
  onToggle?: (result: { characterId: number; excluded: boolean }) => void;
};

function resolveCharacterContext(options: CharacterPanelButtonSyncOptions): CharacterContextLike | null {
  if (typeof options.getContext === 'function') {
    return options.getContext();
  }
  return options.context ?? null;
}

/** Returns the zTracker extension payload stored on a character card, if present. */
export function getCharacterZTrackerExtensionData(character: CharacterLike | undefined): Record<string, unknown> {
  const data = character?.data?.extensions?.[EXTENSION_KEY];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {};
  }
  const extensionData = data as Record<string, unknown>;
  migrateLegacyCharacterAutoModeExclusion(extensionData);
  return extensionData;
}

/** Moves the legacy single boolean exclusion into the default Module slot. */
export function migrateLegacyCharacterAutoModeExclusion(extensionData: Record<string, unknown>): boolean {
  if (extensionData[CHARACTER_AUTO_MODE_EXCLUDED_FIELD] === undefined) {
    return false;
  }

  const exclusions =
    extensionData[CHARACTER_AUTO_MODE_EXCLUSIONS_FIELD]
    && typeof extensionData[CHARACTER_AUTO_MODE_EXCLUSIONS_FIELD] === 'object'
    && !Array.isArray(extensionData[CHARACTER_AUTO_MODE_EXCLUSIONS_FIELD])
      ? { ...(extensionData[CHARACTER_AUTO_MODE_EXCLUSIONS_FIELD] as Record<string, unknown>) }
      : {};

  if (exclusions[DEFAULT_MODULE_ID] === undefined) {
    exclusions[DEFAULT_MODULE_ID] = extensionData[CHARACTER_AUTO_MODE_EXCLUDED_FIELD] === true;
  }
  extensionData[CHARACTER_AUTO_MODE_EXCLUSIONS_FIELD] = exclusions;
  delete extensionData[CHARACTER_AUTO_MODE_EXCLUDED_FIELD];
  return true;
}

/** Reads whether the supplied character is excluded from zTracker auto-mode. */
export function isCharacterAutoModeExcluded(character: CharacterLike | undefined, moduleId = DEFAULT_MODULE_ID): boolean {
  const exclusions = getCharacterZTrackerExtensionData(character)[CHARACTER_AUTO_MODE_EXCLUSIONS_FIELD];
  return !!exclusions && typeof exclusions === 'object' && !Array.isArray(exclusions)
    ? (exclusions as Record<string, unknown>)[moduleId] === true
    : false;
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
  const characterId = Number(context.characterId);
  return Number.isInteger(characterId) && characterId >= 0 ? characterId : undefined;
}

/** Determines whether an incoming character-rendered message should be skipped by auto-mode. */
export function shouldAutoGenerateForCharacterMessage(
  context: CharacterContextLike,
  messageId: number,
  moduleId = DEFAULT_MODULE_ID,
): boolean {
  const message = context.chat?.[messageId];
  const characterId = resolveCharacterIdFromMessage(context.characters, message);
  if (characterId === undefined) {
    return true;
  }

  return !isCharacterAutoModeExcluded(context.characters?.[characterId], moduleId);
}

/** Determines whether an outgoing user-rendered message should be skipped for the active solo character. */
export function shouldAutoGenerateForUserMessage(context: CharacterContextLike, moduleId = DEFAULT_MODULE_ID): boolean {
  const characterId = getCurrentCharacterId(context);
  if (characterId === undefined) {
    return true;
  }

  return !isCharacterAutoModeExcluded(context.characters?.[characterId], moduleId);
}

/** Persists and mirrors the per-character exclusion flag into the live SillyTavern context. */
export function setCharacterAutoModeExcluded(
  context: CharacterContextLike,
  characterId: number,
  excluded: boolean,
  moduleId = DEFAULT_MODULE_ID,
): boolean {
  const characters = context.characters;
  if (!Array.isArray(characters) || characterId < 0 || characterId >= characters.length) {
    return false;
  }

  const character = characters[characterId] ?? {};
  const currentExtensionData = getCharacterZTrackerExtensionData(character);
  const currentExclusions =
    currentExtensionData[CHARACTER_AUTO_MODE_EXCLUSIONS_FIELD]
    && typeof currentExtensionData[CHARACTER_AUTO_MODE_EXCLUSIONS_FIELD] === 'object'
    && !Array.isArray(currentExtensionData[CHARACTER_AUTO_MODE_EXCLUSIONS_FIELD])
      ? currentExtensionData[CHARACTER_AUTO_MODE_EXCLUSIONS_FIELD] as Record<string, unknown>
      : {};
  const nextExtensionData = {
    ...currentExtensionData,
    [CHARACTER_AUTO_MODE_EXCLUSIONS_FIELD]: {
      ...currentExclusions,
      [moduleId]: excluded,
    },
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
    '.form_create_bottom_buttons_block.buttons_block',
  ];
  for (const selector of explicitSelectors) {
    const match = form.querySelector(selector);
    if (match instanceof HTMLElement) {
      return match;
    }
  }
  return null;
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
export function syncCharacterAutoModeButton(options: CharacterPanelButtonSyncOptions): HTMLElement | null {
  const { autoModeEnabled, root = document, onToggle } = options;
  const buttonRow = findCharacterPanelButtonRow(root);
  if (!buttonRow) {
    return null;
  }

  const context = resolveCharacterContext(options);
  if (!context) {
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
      const nextContext = resolveCharacterContext(options);
      if (!nextContext) {
        return;
      }

      const result = toggleCurrentCharacterAutoModeExcluded(nextContext);
      if (!result) {
        return;
      }
      syncCharacterAutoModeButton({ ...options, root });
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