/**
 * @jest-environment jsdom
 */

import { describe, expect, jest, test } from '@jest/globals';
import {
  DEFAULT_MODULE_ID,
  EXTENSION_KEY,
} from '../config.js';
import {
  CHARACTER_AUTO_MODE_BUTTON_ID,
  findCharacterPanelButtonRow,
  getCurrentCharacterId,
  isCharacterAutoModeExcluded,
  isCharacterFullyAutoModeExcluded,
  isCharacterPartiallyAutoModeExcluded,
  resolveCharacterIdFromMessage,
  setCharacterAutoModeExcluded,
  shouldAutoGenerateForCharacterMessage,
  shouldAutoGenerateForUserMessage,
  syncCharacterAutoModeButton,
  toggleCurrentCharacterAutoModeExcluded,
} from '../ui/character-auto-mode-exclusion.js';

describe('character auto-mode exclusion helpers', () => {
  test('resolves a character id from message original_avatar', () => {
    expect(
      resolveCharacterIdFromMessage(
        [{ avatar: 'alice.png' }, { avatar: 'bob.png' }],
        { original_avatar: 'bob.png' },
      ),
    ).toBe(1);
  });

  test('reads exclusion state from the zTracker character extension payload', () => {
    expect(
      isCharacterAutoModeExcluded({
        data: { extensions: { [EXTENSION_KEY]: { autoModeExcluded: true } } },
      }),
    ).toBe(true);
  });

  test('migrates the legacy exclusion boolean into the default module slot', () => {
    const character = {
      data: { extensions: { [EXTENSION_KEY]: { autoModeExcluded: true } } },
    };

    expect(isCharacterAutoModeExcluded(character)).toBe(true);
    expect(character.data.extensions[EXTENSION_KEY]).toEqual({
      autoModeExclusions: { [DEFAULT_MODULE_ID]: true },
    });
  });

  test('accepts string character ids from the live SillyTavern host context', () => {
    expect(getCurrentCharacterId({ characterId: '2' })).toBe(2);
  });

  test('skips incoming auto mode when the rendered character is excluded', () => {
    expect(
      shouldAutoGenerateForCharacterMessage(
        {
          chat: [{ original_avatar: 'alice.png' }],
          characters: [{ avatar: 'alice.png', data: { extensions: { [EXTENSION_KEY]: { autoModeExcluded: true } } } }],
        },
        0,
      ),
    ).toBe(false);
  });

  test('skips outgoing auto mode when the active chat character is excluded', () => {
    expect(
      shouldAutoGenerateForUserMessage({
        characterId: '0',
        characters: [{ avatar: 'alice.png', data: { extensions: { [EXTENSION_KEY]: { autoModeExcluded: true } } } }],
      }),
    ).toBe(false);
  });

  test('persists exclusion via writeExtensionField and mirrors it locally', () => {
    const writeExtensionField = jest.fn();
    const context = {
      characters: [{ avatar: 'alice.png', data: { extensions: { [EXTENSION_KEY]: { existing: 'value' } } } }],
      writeExtensionField,
    };

    expect(setCharacterAutoModeExcluded(context, 0, true, [DEFAULT_MODULE_ID])).toBe(true);
    expect(writeExtensionField).toHaveBeenCalledWith(0, EXTENSION_KEY, {
      existing: 'value',
      autoModeExclusions: { [DEFAULT_MODULE_ID]: true },
    });
    expect(context.characters[0].data.extensions[EXTENSION_KEY]).toEqual({
      existing: 'value',
      autoModeExclusions: { [DEFAULT_MODULE_ID]: true },
    });
  });

  test('reports fully excluded only when every configured Module id is excluded', () => {
    const character = {
      data: { extensions: { [EXTENSION_KEY]: { autoModeExclusions: { sceneMod: true, agendaMod: false } } } },
    };

    expect(isCharacterFullyAutoModeExcluded(character, ['sceneMod'])).toBe(true);
    expect(isCharacterFullyAutoModeExcluded(character, ['sceneMod', 'agendaMod'])).toBe(false);
  });

  test('reports partially excluded only when some but not all configured Module ids are excluded', () => {
    const character = {
      data: { extensions: { [EXTENSION_KEY]: { autoModeExclusions: { sceneMod: true, agendaMod: false } } } },
    };

    expect(isCharacterPartiallyAutoModeExcluded(character, ['sceneMod', 'agendaMod'])).toBe(true);
    expect(isCharacterPartiallyAutoModeExcluded(character, ['sceneMod'])).toBe(false);
    expect(isCharacterPartiallyAutoModeExcluded(character, ['agendaMod'])).toBe(false);
  });

  test('toggling with multiple configured Modules excludes all of them in one click', () => {
    const writeExtensionField = jest.fn();
    const context = {
      characterId: 0,
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      writeExtensionField,
    };

    const result = toggleCurrentCharacterAutoModeExcluded(context, ['sceneMod', 'agendaMod']);

    expect(result).toEqual({ characterId: 0, excluded: true });
    expect(writeExtensionField).toHaveBeenCalledWith(0, EXTENSION_KEY, {
      autoModeExclusions: { sceneMod: true, agendaMod: true },
    });
  });

  test('toggling a fully excluded character includes it for every configured Module again', () => {
    const writeExtensionField = jest.fn();
    const context = {
      characterId: 0,
      characters: [
        {
          avatar: 'alice.png',
          data: { extensions: { [EXTENSION_KEY]: { autoModeExclusions: { sceneMod: true, agendaMod: true } } } },
        },
      ],
      writeExtensionField,
    };

    const result = toggleCurrentCharacterAutoModeExcluded(context, ['sceneMod', 'agendaMod']);

    expect(result).toEqual({ characterId: 0, excluded: false });
    expect(writeExtensionField).toHaveBeenCalledWith(0, EXTENSION_KEY, {
      autoModeExclusions: { sceneMod: false, agendaMod: false },
    });
  });

  test('toggling a partially excluded character normalizes to fully excluded for all configured Modules', () => {
    const writeExtensionField = jest.fn();
    const context = {
      characterId: 0,
      characters: [
        {
          avatar: 'alice.png',
          data: { extensions: { [EXTENSION_KEY]: { autoModeExclusions: { sceneMod: true, agendaMod: false } } } },
        },
      ],
      writeExtensionField,
    };

    const result = toggleCurrentCharacterAutoModeExcluded(context, ['sceneMod', 'agendaMod']);

    expect(result).toEqual({ characterId: 0, excluded: true });
    expect(writeExtensionField).toHaveBeenCalledWith(0, EXTENSION_KEY, {
      autoModeExclusions: { sceneMod: true, agendaMod: true },
    });
  });
});

describe('character auto-mode exclusion button sync', () => {
  test('matches the live SillyTavern character panel button row selector', () => {
    document.body.innerHTML = '<div id="form_create"><div class="form_create_bottom_buttons_block buttons_block"></div></div>';

    const buttonRow = findCharacterPanelButtonRow();

    expect(buttonRow).not.toBeNull();
    expect(buttonRow?.className).toBe('form_create_bottom_buttons_block buttons_block');
  });

  test('injects the button into the avatar action row and toggles the current character state', () => {
    document.body.innerHTML = '<div id="form_create"><div class="avatar_button_row"></div></div>';
    const context = {
      characterId: 0,
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      writeExtensionField: jest.fn(),
    };

    const buttonRow = findCharacterPanelButtonRow();
    expect(buttonRow).not.toBeNull();

    const button = syncCharacterAutoModeButton({ getContext: () => context, autoModeEnabled: true });
    expect(button?.id).toBe(CHARACTER_AUTO_MODE_BUTTON_ID);
    expect(buttonRow?.querySelector(`#${CHARACTER_AUTO_MODE_BUTTON_ID}`)).toBe(button);
    expect(button?.dataset.excluded).toBe('false');

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(context.writeExtensionField).toHaveBeenCalledWith(0, EXTENSION_KEY, {
      autoModeExclusions: { [DEFAULT_MODULE_ID]: true },
    });
    expect(button?.dataset.excluded).toBe('true');
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

    syncCharacterAutoModeButton({ getContext: () => context, autoModeEnabled: true });
    context.characterId = 1;
    const button = syncCharacterAutoModeButton({ getContext: () => context, autoModeEnabled: true });

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(writeExtensionField).toHaveBeenCalledWith(1, EXTENSION_KEY, {
      autoModeExclusions: { [DEFAULT_MODULE_ID]: true },
    });
    expect((context.characters[1].data.extensions as Record<string, unknown>)[EXTENSION_KEY]).toEqual({
      autoModeExclusions: { [DEFAULT_MODULE_ID]: true },
    });
    expect((context.characters[0].data.extensions as Record<string, unknown>)[EXTENSION_KEY]).toBeUndefined();
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
    expect(syncCharacterAutoModeButton({ getContext: () => ({ characterId: 0, characters: [] }), autoModeEnabled: true })).toBeNull();
  });

  test('displays included when the character is excluded from only some configured Modules', () => {
    document.body.innerHTML = '<div id="form_create"><div class="avatar_button_row"></div></div>';
    const context = {
      characterId: 0,
      characters: [
        {
          avatar: 'alice.png',
          data: { extensions: { [EXTENSION_KEY]: { autoModeExclusions: { sceneMod: true, agendaMod: false } } } },
        },
      ],
    };

    const button = syncCharacterAutoModeButton({
      getContext: () => context,
      autoModeEnabled: true,
      moduleIds: ['sceneMod', 'agendaMod'],
    });

    expect(button?.dataset.excluded).toBe('false');
  });

  test('clicking while partially excluded normalizes storage to fully excluded for all configured Modules', () => {
    document.body.innerHTML = '<div id="form_create"><div class="avatar_button_row"></div></div>';
    const writeExtensionField = jest.fn();
    const context = {
      characterId: 0,
      characters: [
        {
          avatar: 'alice.png',
          data: { extensions: { [EXTENSION_KEY]: { autoModeExclusions: { sceneMod: true, agendaMod: false } } } },
        },
      ],
      writeExtensionField,
    };

    const button = syncCharacterAutoModeButton({
      getContext: () => context,
      autoModeEnabled: true,
      moduleIds: ['sceneMod', 'agendaMod'],
    });
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(writeExtensionField).toHaveBeenCalledWith(0, EXTENSION_KEY, {
      autoModeExclusions: { sceneMod: true, agendaMod: true },
    });
    expect(button?.dataset.excluded).toBe('true');
  });

  test('shows a distinct tooltip when the character is excluded from only some configured Modules', () => {
    document.body.innerHTML = '<div id="form_create"><div class="avatar_button_row"></div></div>';
    const context = {
      characterId: 0,
      characters: [
        {
          avatar: 'alice.png',
          data: { extensions: { [EXTENSION_KEY]: { autoModeExclusions: { sceneMod: true, agendaMod: false } } } },
        },
      ],
    };

    const button = syncCharacterAutoModeButton({
      getContext: () => context,
      autoModeEnabled: true,
      moduleIds: ['sceneMod', 'agendaMod'],
    });

    expect(button?.title).toBe('zTracker: Auto mode excluded for some Modules for this character. Click to exclude for all.');
  });

  test('resolves getModuleIds fresh on every click instead of freezing the list from button creation', () => {
    document.body.innerHTML = '<div id="form_create"><div class="avatar_button_row"></div></div>';
    const writeExtensionField = jest.fn();
    const context = {
      characterId: 0,
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      writeExtensionField,
    };
    // Simulates a Module added in Settings after the button was first created: the live
    // getter must reflect the mutation at click time, not the list captured on first sync.
    let configuredModuleIds = ['sceneMod'];
    const getModuleIds = () => configuredModuleIds;

    const button = syncCharacterAutoModeButton({ getContext: () => context, autoModeEnabled: true, getModuleIds });
    configuredModuleIds = ['sceneMod', 'agendaMod'];
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(writeExtensionField).toHaveBeenCalledWith(0, EXTENSION_KEY, {
      autoModeExclusions: { sceneMod: true, agendaMod: true },
    });
  });

  test('reads a narrower scope than it writes when write and read module ids differ', () => {
    document.body.innerHTML = '<div id="form_create"><div class="avatar_button_row"></div></div>';
    const context = {
      characterId: 0,
      characters: [
        {
          avatar: 'alice.png',
          // Only the enabled Module is excluded; the disabled one (write-only scope) is not.
          data: { extensions: { [EXTENSION_KEY]: { autoModeExclusions: { enabledMod: true } } } },
        },
      ],
    };

    const button = syncCharacterAutoModeButton({
      getContext: () => context,
      autoModeEnabled: true,
      moduleIds: ['enabledMod', 'disabledMod'],
      readModuleIds: ['enabledMod'],
    });

    // Fully excluded when read over the enabled-only scope, even though the disabled Module
    // (write scope only) has no exclusion entry at all.
    expect(button?.dataset.excluded).toBe('true');
  });
});