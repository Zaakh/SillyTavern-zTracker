import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import type { TrackerModule, TrackerModuleAutoDirection } from '../config.js';
import { DEFAULT_MODULE_ID, EXTENSION_KEY } from '../config.js';

/** Character-card field name used to persist zTracker's per-character, per-Module auto-mode override. */
export const CHARACTER_AUTO_MODE_OVERRIDES_FIELD = 'autoModeOverrides';
/** Legacy field names, kept only so `getCharacterZTrackerExtensionData` can migrate old data. */
const LEGACY_CHARACTER_AUTO_MODE_EXCLUDED_FIELD = 'autoModeExcluded';
const LEGACY_CHARACTER_AUTO_MODE_EXCLUSIONS_FIELD = 'autoModeExclusions';

/** DOM id for the character-panel toggle button so repeated sync passes remain idempotent. */
export const CHARACTER_AUTO_MODE_BUTTON_ID = 'ztracker-character-auto-mode-toggle';

/**
 * Per-character, per-Module auto-mode override.
 * - `default`: follow that Module's own global `auto.enabled`/`auto.direction`.
 * - `off`: never auto-generate for this character on that Module, regardless of global state.
 * - `on`: always auto-generate for this character on that Module, using that Module's configured
 *   `auto.direction`, even while that Module's `auto.enabled` is globally false.
 */
export type CharacterAutoModeOverride = 'default' | 'off' | 'on';

/** A Module's auto-generation participation as resolved for one specific character. */
export interface EffectiveAutoModeState {
  enabled: boolean;
  direction: TrackerModuleAutoDirection;
}

/** Auto-mode directions that count as "incoming" (assistant reply) vs "outgoing" (user message). */
export const INCOMING_AUTO_MODE_DIRECTIONS: AutoModeOptions[] = [AutoModeOptions.RESPONSES, AutoModeOptions.BOTH];
export const OUTGOING_AUTO_MODE_DIRECTIONS: AutoModeOptions[] = [AutoModeOptions.INPUT, AutoModeOptions.BOTH];

const OVERRIDE_CYCLE: Record<CharacterAutoModeOverride, CharacterAutoModeOverride> = {
  default: 'off',
  off: 'on',
  on: 'default',
};

const OVERRIDE_LABELS: Record<CharacterAutoModeOverride, string> = {
  default: 'Default',
  off: 'Off',
  on: 'On',
};

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
  /** Modules to render controls for. Prefer `getModules` when the configured Module list can change while the button stays mounted. */
  modules?: TrackerModule[];
  /** Live alternative to `modules`, invoked fresh on every sync and on every click. */
  getModules?: () => TrackerModule[];
  root?: ParentNode;
  context?: CharacterContextLike;
  getContext?: () => CharacterContextLike;
  onOverrideChange?: (result: { characterId: number; moduleId: string; override: CharacterAutoModeOverride }) => void;
};

function resolveCharacterContext(options: CharacterPanelButtonSyncOptions): CharacterContextLike | null {
  if (typeof options.getContext === 'function') {
    return options.getContext();
  }
  return options.context ?? null;
}

/** Resolves the Module list fresh from `options`, favoring the live getter over a captured snapshot. */
function resolveModules(options: CharacterPanelButtonSyncOptions): TrackerModule[] {
  if (typeof options.getModules === 'function') {
    return options.getModules();
  }
  return options.modules ?? [];
}

/** Returns the zTracker extension payload stored on a character card, if present. */
export function getCharacterZTrackerExtensionData(character: CharacterLike | undefined): Record<string, unknown> {
  const data = character?.data?.extensions?.[EXTENSION_KEY];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {};
  }
  const extensionData = data as Record<string, unknown>;
  migrateLegacyCharacterAutoModeExclusion(extensionData);
  migrateLegacyCharacterAutoModeOverrides(extensionData);
  return extensionData;
}

/** Moves the oldest single boolean exclusion into the legacy per-Module exclusion map's default slot. */
export function migrateLegacyCharacterAutoModeExclusion(extensionData: Record<string, unknown>): boolean {
  if (extensionData[LEGACY_CHARACTER_AUTO_MODE_EXCLUDED_FIELD] === undefined) {
    return false;
  }

  const exclusions =
    extensionData[LEGACY_CHARACTER_AUTO_MODE_EXCLUSIONS_FIELD]
    && typeof extensionData[LEGACY_CHARACTER_AUTO_MODE_EXCLUSIONS_FIELD] === 'object'
    && !Array.isArray(extensionData[LEGACY_CHARACTER_AUTO_MODE_EXCLUSIONS_FIELD])
      ? { ...(extensionData[LEGACY_CHARACTER_AUTO_MODE_EXCLUSIONS_FIELD] as Record<string, unknown>) }
      : {};

  if (exclusions[DEFAULT_MODULE_ID] === undefined) {
    exclusions[DEFAULT_MODULE_ID] = extensionData[LEGACY_CHARACTER_AUTO_MODE_EXCLUDED_FIELD] === true;
  }
  extensionData[LEGACY_CHARACTER_AUTO_MODE_EXCLUSIONS_FIELD] = exclusions;
  delete extensionData[LEGACY_CHARACTER_AUTO_MODE_EXCLUDED_FIELD];
  return true;
}

/** Moves the legacy per-Module boolean exclusion map into the tri-state override map (`true` -> `off`, `false`/absent -> `default`). */
export function migrateLegacyCharacterAutoModeOverrides(extensionData: Record<string, unknown>): boolean {
  const legacyExclusions = extensionData[LEGACY_CHARACTER_AUTO_MODE_EXCLUSIONS_FIELD];
  if (!legacyExclusions || typeof legacyExclusions !== 'object' || Array.isArray(legacyExclusions)) {
    return false;
  }

  const overrides =
    extensionData[CHARACTER_AUTO_MODE_OVERRIDES_FIELD]
    && typeof extensionData[CHARACTER_AUTO_MODE_OVERRIDES_FIELD] === 'object'
    && !Array.isArray(extensionData[CHARACTER_AUTO_MODE_OVERRIDES_FIELD])
      ? { ...(extensionData[CHARACTER_AUTO_MODE_OVERRIDES_FIELD] as Record<string, CharacterAutoModeOverride>) }
      : {};

  for (const [moduleId, excluded] of Object.entries(legacyExclusions as Record<string, unknown>)) {
    if (overrides[moduleId] === undefined) {
      overrides[moduleId] = excluded === true ? 'off' : 'default';
    }
  }

  extensionData[CHARACTER_AUTO_MODE_OVERRIDES_FIELD] = overrides;
  delete extensionData[LEGACY_CHARACTER_AUTO_MODE_EXCLUSIONS_FIELD];
  return true;
}

/** Reads the supplied character's stored override for one Module, defaulting to `'default'` when unset. */
export function getCharacterModuleOverride(character: CharacterLike | undefined, moduleId = DEFAULT_MODULE_ID): CharacterAutoModeOverride {
  const overrides = getCharacterZTrackerExtensionData(character)[CHARACTER_AUTO_MODE_OVERRIDES_FIELD];
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
    const value = (overrides as Record<string, unknown>)[moduleId];
    if (value === 'off' || value === 'on') {
      return value;
    }
  }
  return 'default';
}

/**
 * Resolves a Module's effective auto-generation state for one character, applying the override's
 * fallback rule: `off` forces disabled, `on` forces enabled using the Module's own direction, and
 * `default` passes the Module's own global state through unchanged.
 */
export function resolveEffectiveAutoModeState(module: TrackerModule, override: CharacterAutoModeOverride): EffectiveAutoModeState {
  if (override === 'off') {
    return { enabled: false, direction: module.auto.direction };
  }
  if (override === 'on') {
    return { enabled: true, direction: module.auto.direction };
  }
  return { enabled: module.auto.enabled, direction: module.auto.direction };
}

/** Reads whether the supplied character effectively auto-generates for at least one of the given Modules. */
export function isCharacterEffectivelyActiveForAnyModule(character: CharacterLike | undefined, modules: TrackerModule[]): boolean {
  return modules.some((module) => resolveEffectiveAutoModeState(module, getCharacterModuleOverride(character, module.id)).enabled);
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

/** Resolves whether a Module's effective state (for the given character, or `default` when unresolvable) permits one of `directions`. Shared by the incoming/outgoing checks below so the override-resolution + direction-membership logic isn't duplicated per direction. */
function isModuleDueForCharacter(character: CharacterLike | undefined, module: TrackerModule, directions: AutoModeOptions[]): boolean {
  const override = getCharacterModuleOverride(character, module.id);
  const effective = resolveEffectiveAutoModeState(module, override);
  return effective.enabled && directions.includes(effective.direction);
}

/** Determines whether a Module should auto-generate for an incoming (assistant) rendered message. */
export function shouldAutoGenerateForCharacterMessage(
  context: CharacterContextLike,
  messageId: number,
  module: TrackerModule,
): boolean {
  const message = context.chat?.[messageId];
  const characterId = resolveCharacterIdFromMessage(context.characters, message);
  const character = characterId === undefined ? undefined : context.characters?.[characterId];
  return isModuleDueForCharacter(character, module, INCOMING_AUTO_MODE_DIRECTIONS);
}

/** Determines whether a Module should auto-generate for an outgoing (user) rendered message for the active solo character. */
export function shouldAutoGenerateForUserMessage(context: CharacterContextLike, module: TrackerModule): boolean {
  const characterId = getCurrentCharacterId(context);
  const character = characterId === undefined ? undefined : context.characters?.[characterId];
  return isModuleDueForCharacter(character, module, OUTGOING_AUTO_MODE_DIRECTIONS);
}

/** Persists one Module's override for one character and mirrors it into the live SillyTavern context. */
export function setCharacterModuleOverride(
  context: CharacterContextLike,
  characterId: number,
  moduleId: string,
  override: CharacterAutoModeOverride,
): boolean {
  const characters = context.characters;
  if (!Array.isArray(characters) || characterId < 0 || characterId >= characters.length) {
    return false;
  }

  const character = characters[characterId] ?? {};
  const currentExtensionData = getCharacterZTrackerExtensionData(character);
  const currentOverrides =
    currentExtensionData[CHARACTER_AUTO_MODE_OVERRIDES_FIELD]
    && typeof currentExtensionData[CHARACTER_AUTO_MODE_OVERRIDES_FIELD] === 'object'
    && !Array.isArray(currentExtensionData[CHARACTER_AUTO_MODE_OVERRIDES_FIELD])
      ? currentExtensionData[CHARACTER_AUTO_MODE_OVERRIDES_FIELD] as Record<string, CharacterAutoModeOverride>
      : {};
  const nextExtensionData = {
    ...currentExtensionData,
    [CHARACTER_AUTO_MODE_OVERRIDES_FIELD]: { ...currentOverrides, [moduleId]: override },
  };

  character.data = character.data ?? {};
  character.data.extensions = character.data.extensions ?? {};
  character.data.extensions[EXTENSION_KEY] = nextExtensionData;

  context.writeExtensionField?.(characterId, EXTENSION_KEY, nextExtensionData);
  return true;
}

/** Cycles one Module's override (`default` -> `off` -> `on` -> `default`) for the currently active solo character. */
export function cycleCharacterModuleOverride(
  context: CharacterContextLike,
  moduleId: string,
): { characterId: number; override: CharacterAutoModeOverride } | null {
  const characterId = getCurrentCharacterId(context);
  if (characterId === undefined) {
    return null;
  }

  const nextOverride = OVERRIDE_CYCLE[getCharacterModuleOverride(context.characters?.[characterId], moduleId)];
  if (!setCharacterModuleOverride(context, characterId, moduleId, nextOverride)) {
    return null;
  }

  return { characterId, override: nextOverride };
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

/** Suffix appended to a tooltip when the owning Module is hard-disabled, since a disabled Module cannot generate regardless of any override set here. */
function disabledModuleSuffix(module: TrackerModule): string {
  return module.enabled ? '' : ' (Module is currently disabled and will not generate until re-enabled.)';
}

/** Builds the tooltip for the single-Module inline toggle, describing that Module's current override. */
function buildSingleModuleButtonTitle(hasCharacter: boolean, module: TrackerModule, override: CharacterAutoModeOverride): string {
  if (!hasCharacter) {
    return 'zTracker: Open a character card to set this Module\'s auto-mode override.';
  }
  const label = module.name || module.id;
  const suffix = disabledModuleSuffix(module);
  if (override === 'off') {
    return `zTracker: ${label} auto mode is off for this character. Click to force it on.${suffix}`;
  }
  if (override === 'on') {
    return `zTracker: ${label} auto mode is forced on for this character. Click to return to the default.${suffix}`;
  }
  return `zTracker: ${label} auto mode uses the Module's default setting for this character. Click to turn it off.${suffix}`;
}

/** Builds the tooltip for the multi-Module popup trigger, summarizing whether any Module is effectively active. */
function buildPopupTriggerButtonTitle(hasCharacter: boolean, active: boolean): string {
  if (!hasCharacter) {
    return 'zTracker: Open a character card to set each Module\'s auto-mode override.';
  }
  return active
    ? 'zTracker: Auto mode is active for this character on at least one Module. Click to review each Module\'s override.'
    : 'zTracker: Auto mode is inactive for this character on every Module. Click to review each Module\'s override.';
}

/** Builds the per-row tooltip shown inside the multi-Module override popup. */
function buildOverrideRowTitle(module: TrackerModule, override: CharacterAutoModeOverride): string {
  const label = module.name || module.id;
  const suffix = disabledModuleSuffix(module);
  if (override === 'off') {
    return `${label}: off for this character. Click to force it on.${suffix}`;
  }
  if (override === 'on') {
    return `${label}: forced on for this character. Click to return to the default.${suffix}`;
  }
  return `${label}: using the Module's default setting for this character. Click to turn it off.${suffix}`;
}

let activeOverridePopup: HTMLElement | null = null;
/** The trigger button whose click opened `activeOverridePopup`, excluded from the outside-click check below since that same click bubbles to `document` and would otherwise close the popup immediately after opening it. */
let activeOverrideAnchor: HTMLElement | null = null;
let overridePopupOutsideClickHandlerInstalled = false;

/**
 * Removes the currently open multi-Module override popup, if any. Exported so callers that
 * detect the active character or panel changed out from under an open popup (e.g. the
 * character-panel DOM observer in `character-panel-auto-mode.ts`) can proactively close it
 * instead of leaving it displaying a now-stale character's override state.
 */
export function closeActiveOverridePopup(): void {
  activeOverridePopup?.remove();
  activeOverridePopup = null;
  activeOverrideAnchor = null;
}

/**
 * Installs a single document-level listener that closes the popup on any outside click.
 * Not shared with `openManualModuleMenu` (`src/ui/ui-init.ts`): that menu's closing behavior is
 * wired into the broader per-message click-delegation system, and reusing it here would require
 * coupling this character-panel control to that unrelated message-action dispatch path.
 */
function installOverridePopupOutsideClickHandler(): void {
  if (overridePopupOutsideClickHandlerInstalled || typeof document === 'undefined') {
    return;
  }
  overridePopupOutsideClickHandlerInstalled = true;
  document.addEventListener('click', (event) => {
    if (!activeOverridePopup) {
      return;
    }
    const target = event.target as Node | null;
    if (target && (activeOverridePopup.contains(target) || activeOverrideAnchor?.contains(target))) {
      return;
    }
    closeActiveOverridePopup();
  });
}

/** Positions the popup near its anchor button, keeping it within the viewport and capping its height so a long Module list scrolls instead of overflowing off-screen. */
function positionOverridePopup(popup: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const viewportMargin = 8;
  const width = Math.max(popup.offsetWidth, 220);
  const left = Math.max(
    window.scrollX + viewportMargin,
    Math.min(rect.right + window.scrollX - width, window.scrollX + window.innerWidth - viewportMargin - width),
  );
  const top = rect.bottom + window.scrollY + 6;
  const maxHeight = Math.max(120, window.innerHeight - (top - window.scrollY) - viewportMargin);
  popup.style.left = `${Math.round(left)}px`;
  popup.style.top = `${Math.round(top)}px`;
  popup.style.maxHeight = `${Math.round(maxHeight)}px`;
  popup.style.overflowY = 'auto';
}

/** Opens the popup listing every configured Module with its own 3-state override cycling control. */
function openCharacterModuleOverridePopup(params: {
  modules: TrackerModule[];
  anchor: HTMLElement;
  options: CharacterPanelButtonSyncOptions;
  root: ParentNode;
}): void {
  const { modules, anchor, options, root } = params;
  closeActiveOverridePopup();
  installOverridePopupOutsideClickHandler();

  const context = resolveCharacterContext(options);
  const characterId = context ? getCurrentCharacterId(context) : undefined;
  const character = context && characterId !== undefined ? context.characters?.[characterId] : undefined;

  const popup = document.createElement('div');
  popup.className = 'ztracker-character-auto-mode-popup';
  popup.setAttribute('role', 'menu');
  popup.style.position = 'absolute';
  popup.style.visibility = 'hidden';
  popup.style.zIndex = '2147483647';

  for (const module of modules) {
    const row = document.createElement('div');
    row.className = 'ztracker-character-auto-mode-popup-row';

    const label = document.createElement('span');
    label.className = 'ztracker-character-auto-mode-popup-name';
    label.textContent = module.name || module.id;
    row.appendChild(label);

    const override = getCharacterModuleOverride(character, module.id);
    const cycleButton = document.createElement('button');
    cycleButton.type = 'button';
    cycleButton.className = 'menu_button ztracker-character-auto-mode-popup-cycle';
    cycleButton.dataset.ztrackerModule = module.id;
    cycleButton.dataset.override = override;
    cycleButton.textContent = OVERRIDE_LABELS[override];
    cycleButton.title = buildOverrideRowTitle(module, override);
    cycleButton.addEventListener('click', (event) => {
      event.stopPropagation();
      const clickContext = resolveCharacterContext(options);
      if (!clickContext) {
        return;
      }
      const result = cycleCharacterModuleOverride(clickContext, module.id);
      if (!result) {
        return;
      }
      cycleButton.dataset.override = result.override;
      cycleButton.textContent = OVERRIDE_LABELS[result.override];
      cycleButton.title = buildOverrideRowTitle(module, result.override);
      syncCharacterAutoModeButton({ ...options, root });
      options.onOverrideChange?.({ characterId: result.characterId, moduleId: module.id, override: result.override });
    });

    row.appendChild(cycleButton);
    popup.appendChild(row);
  }

  document.body.appendChild(popup);
  positionOverridePopup(popup, anchor);
  popup.style.visibility = 'visible';
  activeOverridePopup = popup;
  activeOverrideAnchor = anchor;
}

/** Creates or refreshes the character-panel auto-mode override control and keeps its state in sync. */
export function syncCharacterAutoModeButton(options: CharacterPanelButtonSyncOptions): HTMLElement | null {
  const { root = document } = options;
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
    // Resolve Modules fresh on every click, not just once at attach time: `options` here is
    // whichever sync call first created this button, but `getModules` (when supplied) re-reads
    // live settings on every invocation rather than freezing a list captured at creation.
    button.addEventListener('click', () => {
      const clickContext = resolveCharacterContext(options);
      if (!clickContext) {
        return;
      }
      const modules = resolveModules(options);
      if (modules.length === 0) {
        return;
      }

      if (modules.length === 1) {
        const result = cycleCharacterModuleOverride(clickContext, modules[0].id);
        if (!result) {
          return;
        }
        syncCharacterAutoModeButton({ ...options, root });
        options.onOverrideChange?.({ characterId: result.characterId, moduleId: modules[0].id, override: result.override });
        return;
      }

      openCharacterModuleOverridePopup({ modules, anchor: button as HTMLElement, options, root });
    });
    buttonRow.appendChild(button);
  }

  const modules = resolveModules(options);
  const characterId = getCurrentCharacterId(context);
  const character = characterId !== undefined ? context.characters?.[characterId] : undefined;
  const hasCharacter = characterId !== undefined;
  const active = hasCharacter && isCharacterEffectivelyActiveForAnyModule(character, modules);

  button.dataset.active = String(active);
  button.setAttribute('aria-pressed', String(active));
  button.style.color = active ? 'var(--SmartThemeQuoteColor, #e74c3c)' : '';

  if (modules.length === 1) {
    const override = getCharacterModuleOverride(character, modules[0].id);
    button.dataset.override = override;
    button.title = buildSingleModuleButtonTitle(hasCharacter, modules[0], override);
  } else {
    delete button.dataset.override;
    button.title = buildPopupTriggerButtonTitle(hasCharacter, active);
  }

  return button;
}