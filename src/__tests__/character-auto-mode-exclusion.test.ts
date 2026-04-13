/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import {
  EXTENSION_KEY,
} from '../config.js';
import {
  CHARACTER_AUTO_MODE_BUTTON_ID,
  findCharacterPanelButtonRow,
  isCharacterAutoModeExcluded,
  resolveCharacterIdFromMessage,
  setCharacterAutoModeExcluded,
  shouldAutoGenerateForCharacterMessage,
  shouldAutoGenerateForUserMessage,
  syncCharacterAutoModeButton,
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
        characterId: 0,
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

    expect(setCharacterAutoModeExcluded(context, 0, true)).toBe(true);
    expect(writeExtensionField).toHaveBeenCalledWith(0, EXTENSION_KEY, { existing: 'value', autoModeExcluded: true });
    expect(context.characters[0].data.extensions[EXTENSION_KEY]).toEqual({ existing: 'value', autoModeExcluded: true });
  });
});

describe('character auto-mode exclusion button sync', () => {
  test('injects the button into the avatar action row and toggles the current character state', () => {
    document.body.innerHTML = '<div id="form_create"><div class="avatar_button_row"></div></div>';
    const context = {
      characterId: 0,
      characters: [{ avatar: 'alice.png', data: { extensions: {} } }],
      writeExtensionField: jest.fn(),
    };

    const buttonRow = findCharacterPanelButtonRow();
    expect(buttonRow).not.toBeNull();

    const button = syncCharacterAutoModeButton({ context, autoModeEnabled: true });
    expect(button?.id).toBe(CHARACTER_AUTO_MODE_BUTTON_ID);
    expect(buttonRow?.querySelector(`#${CHARACTER_AUTO_MODE_BUTTON_ID}`)).toBe(button);
    expect(button?.dataset.excluded).toBe('false');

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(context.writeExtensionField).toHaveBeenCalledWith(0, EXTENSION_KEY, { autoModeExcluded: true });
    expect(button?.dataset.excluded).toBe('true');
  });
});