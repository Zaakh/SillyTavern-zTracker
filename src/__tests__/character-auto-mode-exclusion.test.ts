/**
 * @jest-environment jsdom
 */

import { describe, expect, jest, test } from '@jest/globals';
import {
  createDefaultTrackerModule,
  DEFAULT_MODULE_ID,
  EXTENSION_KEY,
} from '../config.js';
import {
  CHARACTER_AUTO_MODE_BUTTON_ID,
  cycleCharacterModuleOverride,
  findCharacterPanelButtonRow,
  getCharacterModuleOverride,
  getCurrentCharacterId,
  isCharacterEffectivelyActiveForAnyModule,
  resolveCharacterIdFromMessage,
  resolveEffectiveAutoModeState,
  setCharacterModuleOverride,
  shouldAutoGenerateForCharacterMessage,
  shouldAutoGenerateForUserMessage,
  syncCharacterAutoModeButton,
} from '../ui/character-auto-mode-exclusion.js';

/** Builds a minimal Module fixture with a given global enabled/direction state. */
function makeModule(id: string, enabled: boolean, direction: 'inputs' | 'responses' | 'both' = 'both') {
  const module = createDefaultTrackerModule({ id, name: id, order: 0 });
  module.auto = { enabled, direction: direction as any };
  return module;
}

describe('resolveEffectiveAutoModeState', () => {
  test('default override follows the module\'s own global state', () => {
    const enabledModule = makeModule('scene', true, 'responses');
    expect(resolveEffectiveAutoModeState(enabledModule, 'default')).toEqual({ enabled: true, direction: 'responses' });

    const disabledModule = makeModule('scene', false, 'responses');
    expect(resolveEffectiveAutoModeState(disabledModule, 'default')).toEqual({ enabled: false, direction: 'responses' });
  });

  test('off override disables regardless of the module\'s global state', () => {
    const module = makeModule('scene', true, 'both');
    expect(resolveEffectiveAutoModeState(module, 'off')).toEqual({ enabled: false, direction: 'both' });
  });

  test('on override enables using the module\'s configured direction, even while globally disabled', () => {
    const module = makeModule('scene', false, 'inputs');
    expect(resolveEffectiveAutoModeState(module, 'on')).toEqual({ enabled: true, direction: 'inputs' });
  });
});

describe('character-card override storage', () => {
  test('reads default when no override is stored', () => {
    expect(getCharacterModuleOverride({ data: { extensions: {} } }, 'scene')).toBe('default');
  });

  test('reads a stored override for a specific module', () => {
    const character = {
      data: { extensions: { [EXTENSION_KEY]: { autoModeOverrides: { scene: 'off', agenda: 'on' } } } },
    };
    expect(getCharacterModuleOverride(character, 'scene')).toBe('off');
    expect(getCharacterModuleOverride(character, 'agenda')).toBe('on');
    expect(getCharacterModuleOverride(character, 'unconfigured')).toBe('default');
  });

  test('migrates the oldest single exclusion boolean into a per-module off override', () => {
    const character = {
      data: { extensions: { [EXTENSION_KEY]: { autoModeExcluded: true } } },
    };

    expect(getCharacterModuleOverride(character, DEFAULT_MODULE_ID)).toBe('off');
    expect((character.data.extensions[EXTENSION_KEY] as any).autoModeOverrides).toEqual({ [DEFAULT_MODULE_ID]: 'off' });
    expect((character.data.extensions[EXTENSION_KEY] as any).autoModeExcluded).toBeUndefined();
    expect((character.data.extensions[EXTENSION_KEY] as any).autoModeExclusions).toBeUndefined();
  });

  test('migrates a legacy per-module exclusion map into the tri-state override map', () => {
    const character = {
      data: { extensions: { [EXTENSION_KEY]: { autoModeExclusions: { scene: true, agenda: false } } } },
    };

    expect(getCharacterModuleOverride(character, 'scene')).toBe('off');
    expect(getCharacterModuleOverride(character, 'agenda')).toBe('default');
    expect((character.data.extensions[EXTENSION_KEY] as any).autoModeExclusions).toBeUndefined();
  });

  test('does not re-migrate data that already uses the tri-state override map', () => {
    const character = {
      data: { extensions: { [EXTENSION_KEY]: { autoModeOverrides: { scene: 'on' } } } },
    };

    expect(getCharacterModuleOverride(character, 'scene')).toBe('on');
    expect((character.data.extensions[EXTENSION_KEY] as any).autoModeOverrides).toEqual({ scene: 'on' });
  });

  test('merges a legacy exclusion map into an already-partially-migrated override map without clobbering existing entries', () => {
    // Mixed state: 'scene' was already migrated (and since re-toggled to 'on'), while 'agenda'
    // still only exists in the legacy boolean map (e.g. from a Module added between two migration
    // passes). Migration must fill in the missing 'agenda' entry without touching 'scene'.
    const character = {
      data: {
        extensions: {
          [EXTENSION_KEY]: {
            autoModeOverrides: { scene: 'on' },
            autoModeExclusions: { scene: true, agenda: true },
          },
        },
      },
    };

    expect(getCharacterModuleOverride(character, 'scene')).toBe('on');
    expect(getCharacterModuleOverride(character, 'agenda')).toBe('off');
    expect((character.data.extensions[EXTENSION_KEY] as any).autoModeOverrides).toEqual({ scene: 'on', agenda: 'off' });
    expect((character.data.extensions[EXTENSION_KEY] as any).autoModeExclusions).toBeUndefined();
  });

  test('persists an override via writeExtensionField and mirrors it locally without touching other modules', () => {
    const writeExtensionField = jest.fn();
    const context = {
      characters: [
        {
          avatar: 'alice.png',
          data: { extensions: { [EXTENSION_KEY]: { autoModeOverrides: { agenda: 'on' } } } },
        },
      ],
      writeExtensionField,
    };

    expect(setCharacterModuleOverride(context, 0, 'scene', 'off')).toBe(true);
    expect(writeExtensionField).toHaveBeenCalledWith(0, EXTENSION_KEY, {
      autoModeOverrides: { agenda: 'on', scene: 'off' },
    });
    expect(context.characters[0].data.extensions[EXTENSION_KEY]).toEqual({
      autoModeOverrides: { agenda: 'on', scene: 'off' },
    });
  });

  test('cycles default -> off -> on -> default for the active character', () => {
    const context = {
      characterId: 0,
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      writeExtensionField: jest.fn(),
    };

    expect(cycleCharacterModuleOverride(context, 'scene')).toEqual({ characterId: 0, override: 'off' });
    expect(cycleCharacterModuleOverride(context, 'scene')).toEqual({ characterId: 0, override: 'on' });
    expect(cycleCharacterModuleOverride(context, 'scene')).toEqual({ characterId: 0, override: 'default' });
  });

  test('isCharacterEffectivelyActiveForAnyModule is true when any module resolves to enabled', () => {
    const character = {
      data: { extensions: { [EXTENSION_KEY]: { autoModeOverrides: { scene: 'off', agenda: 'on' } } } },
    };
    const sceneModule = makeModule('scene', true);
    const agendaModule = makeModule('agenda', false);

    expect(isCharacterEffectivelyActiveForAnyModule(character, [sceneModule, agendaModule])).toBe(true);
    expect(isCharacterEffectivelyActiveForAnyModule(character, [sceneModule])).toBe(false);
  });
});

describe('auto-generation direction checks', () => {
  test('resolves a character id from message original_avatar', () => {
    expect(
      resolveCharacterIdFromMessage(
        [{ avatar: 'alice.png' }, { avatar: 'bob.png' }],
        { original_avatar: 'bob.png' },
      ),
    ).toBe(1);
  });

  test('accepts string character ids from the live SillyTavern host context', () => {
    expect(getCurrentCharacterId({ characterId: '2' })).toBe(2);
  });

  test('skips incoming auto mode when the rendered character is off-overridden', () => {
    const module = makeModule(DEFAULT_MODULE_ID, true, 'responses');
    const context = {
      chat: [{ original_avatar: 'alice.png' }],
      characters: [{ avatar: 'alice.png', data: { extensions: { [EXTENSION_KEY]: { autoModeOverrides: { [DEFAULT_MODULE_ID]: 'off' } } } } }],
    };

    expect(shouldAutoGenerateForCharacterMessage(context, 0, module)).toBe(false);
  });

  test('forces incoming auto mode when the rendered character is on-overridden despite the module being globally disabled', () => {
    const module = makeModule(DEFAULT_MODULE_ID, false, 'responses');
    const context = {
      chat: [{ original_avatar: 'alice.png' }],
      characters: [{ avatar: 'alice.png', data: { extensions: { [EXTENSION_KEY]: { autoModeOverrides: { [DEFAULT_MODULE_ID]: 'on' } } } } }],
    };

    expect(shouldAutoGenerateForCharacterMessage(context, 0, module)).toBe(true);
  });

  test('default override respects the module\'s own direction for incoming messages', () => {
    const inputOnlyModule = makeModule(DEFAULT_MODULE_ID, true, 'inputs');
    const context = {
      chat: [{ original_avatar: 'alice.png' }],
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
    };

    expect(shouldAutoGenerateForCharacterMessage(context, 0, inputOnlyModule)).toBe(false);
  });

  test('skips outgoing auto mode when the active chat character is off-overridden', () => {
    const module = makeModule(DEFAULT_MODULE_ID, true, 'inputs');
    const context = {
      characterId: '0',
      characters: [{ avatar: 'alice.png', data: { extensions: { [EXTENSION_KEY]: { autoModeOverrides: { [DEFAULT_MODULE_ID]: 'off' } } } } }],
    };

    expect(shouldAutoGenerateForUserMessage(context, module)).toBe(false);
  });

  test('forces outgoing auto mode when the active chat character is on-overridden despite the module being globally disabled', () => {
    const module = makeModule(DEFAULT_MODULE_ID, false, 'inputs');
    const context = {
      characterId: '0',
      characters: [{ avatar: 'alice.png', data: { extensions: { [EXTENSION_KEY]: { autoModeOverrides: { [DEFAULT_MODULE_ID]: 'on' } } } } }],
    };

    expect(shouldAutoGenerateForUserMessage(context, module)).toBe(true);
  });

  test('no resolvable character falls back to the module\'s own default state', () => {
    const enabledModule = makeModule(DEFAULT_MODULE_ID, true, 'both');
    expect(shouldAutoGenerateForCharacterMessage({ chat: [], characters: [] }, 0, enabledModule)).toBe(true);

    const disabledModule = makeModule(DEFAULT_MODULE_ID, false, 'both');
    expect(shouldAutoGenerateForUserMessage({ characters: [] }, disabledModule)).toBe(false);
  });
});

describe('character auto-mode override button sync', () => {
  test('matches the live SillyTavern character panel button row selector', () => {
    document.body.innerHTML = '<div id="form_create"><div class="form_create_bottom_buttons_block buttons_block"></div></div>';

    const buttonRow = findCharacterPanelButtonRow();

    expect(buttonRow).not.toBeNull();
    expect(buttonRow?.className).toBe('form_create_bottom_buttons_block buttons_block');
  });

  test('does not guess a generic button row when the avatar action row is missing', () => {
    document.body.innerHTML = `
      <div id="form_create">
        <div>
          <button type="button">One</button>
          <button type="button">Two</button>
        </div>
      </div>
    `;

    expect(findCharacterPanelButtonRow()).toBeNull();
    expect(syncCharacterAutoModeButton({ getContext: () => ({ characterId: 0, characters: [] }), modules: [] })).toBeNull();
  });

  test('single configured module cycles inline without opening a popup', () => {
    document.body.innerHTML = '<div id="form_create"><div class="avatar_button_row"></div></div>';
    const context = {
      characterId: 0,
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      writeExtensionField: jest.fn(),
    };
    const modules = [makeModule('scene', true)];

    const button = syncCharacterAutoModeButton({ getContext: () => context, modules });
    expect(button?.id).toBe(CHARACTER_AUTO_MODE_BUTTON_ID);
    expect(button?.dataset.override).toBe('default');

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(context.writeExtensionField).toHaveBeenCalledWith(0, EXTENSION_KEY, {
      autoModeOverrides: { scene: 'off' },
    });
    expect(button?.dataset.override).toBe('off');
    expect(document.querySelector('.ztracker-character-auto-mode-popup')).toBeNull();
  });

  test('multi-module setup opens a popup with one 3-state control per module', () => {
    document.body.innerHTML = '<div id="form_create"><div class="avatar_button_row"></div></div>';
    const context = {
      characterId: 0,
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      writeExtensionField: jest.fn(),
    };
    const modules = [makeModule('scene', true), makeModule('agenda', false)];

    const button = syncCharacterAutoModeButton({ getContext: () => context, modules });
    expect(button?.dataset.override).toBeUndefined();

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const popup = document.querySelector('.ztracker-character-auto-mode-popup');
    expect(popup).not.toBeNull();
    const rows = popup?.querySelectorAll('.ztracker-character-auto-mode-popup-cycle');
    expect(rows).toHaveLength(2);
    expect(rows?.[0].getAttribute('data-ztracker-module')).toBe('scene');
    expect(rows?.[1].getAttribute('data-ztracker-module')).toBe('agenda');
  });

  test('clicking a module row in the popup cycles only that module\'s override', () => {
    document.body.innerHTML = '<div id="form_create"><div class="avatar_button_row"></div></div>';
    const writeExtensionField = jest.fn();
    const context = {
      characterId: 0,
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      writeExtensionField,
    };
    const modules = [makeModule('scene', true), makeModule('agenda', false)];

    const button = syncCharacterAutoModeButton({ getContext: () => context, modules });
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const sceneRow = document.querySelector('[data-ztracker-module="scene"]') as HTMLElement;
    sceneRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(writeExtensionField).toHaveBeenCalledWith(0, EXTENSION_KEY, {
      autoModeOverrides: { scene: 'off' },
    });
    expect(sceneRow.dataset.override).toBe('off');
  });

  test('reflects active state when any module effectively auto-generates for the character', () => {
    document.body.innerHTML = '<div id="form_create"><div class="avatar_button_row"></div></div>';
    const context = {
      characterId: 0,
      characters: [
        {
          avatar: 'alice.png',
          data: { extensions: { [EXTENSION_KEY]: { autoModeOverrides: { scene: 'off', agenda: 'on' } } } },
        },
      ],
    };
    const modules = [makeModule('scene', true), makeModule('agenda', false)];

    const button = syncCharacterAutoModeButton({ getContext: () => context, modules });

    expect(button?.dataset.active).toBe('true');
  });

  test('reflects inactive state when no module effectively auto-generates for the character', () => {
    document.body.innerHTML = '<div id="form_create"><div class="avatar_button_row"></div></div>';
    const context = {
      characterId: 0,
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
    };
    const modules = [makeModule('scene', false), makeModule('agenda', false)];

    const button = syncCharacterAutoModeButton({ getContext: () => context, modules });

    expect(button?.dataset.active).toBe('false');
  });

  test('resolves getModules fresh on every click instead of freezing the list from button creation', () => {
    document.body.innerHTML = '<div id="form_create"><div class="avatar_button_row"></div></div>';
    const writeExtensionField = jest.fn();
    const context = {
      characterId: 0,
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      writeExtensionField,
    };
    // Simulates a Module added in Settings after the button was first created: the live
    // getter must reflect the mutation at click time, not the list captured on first sync.
    let configuredModules = [makeModule('scene', true)];
    const getModules = () => configuredModules;

    const button = syncCharacterAutoModeButton({ getContext: () => context, getModules });
    configuredModules = [makeModule('scene', true), makeModule('agenda', true)];
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // With two modules now configured, the click should open the popup rather than cycle inline.
    expect(document.querySelector('.ztracker-character-auto-mode-popup')).not.toBeNull();
  });

  test('uses fresh host context when the active character changes before toggling', () => {
    document.body.innerHTML = '<div id="form_create"><div class="avatar_button_row"></div></div>';
    const writeExtensionField = jest.fn();
    const context = {
      characterId: 0,
      characters: [
        { avatar: 'alice.png', data: { extensions: {} } },
        { avatar: 'bob.png', data: { extensions: {} } },
      ],
      writeExtensionField,
    };
    const modules = [makeModule('scene', true)];

    syncCharacterAutoModeButton({ getContext: () => context, modules });
    context.characterId = 1;
    const button = syncCharacterAutoModeButton({ getContext: () => context, modules });

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(writeExtensionField).toHaveBeenCalledWith(1, EXTENSION_KEY, {
      autoModeOverrides: { scene: 'off' },
    });
    expect((context.characters[1].data.extensions as Record<string, unknown>)[EXTENSION_KEY]).toEqual({
      autoModeOverrides: { scene: 'off' },
    });
    expect((context.characters[0].data.extensions as Record<string, unknown>)[EXTENSION_KEY]).toBeUndefined();
  });
});