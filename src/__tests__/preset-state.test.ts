/**
 * @jest-environment node
 */

import { reconcilePresetItems, resolvePresetSelection } from '../components/settings/preset-state.js';

describe('preset-state helpers', () => {
  test('supports create-then-select flows using the updated preset list', () => {
    const state = reconcilePresetItems(
      {
        default: {
          name: 'Default',
          value: { scene: 'default' },
          html: '<div>default</div>',
        },
      },
      'default',
      [
        { value: 'default', label: 'Default' },
        { value: 'custom', label: 'Custom' },
      ],
    );

    const selection = resolvePresetSelection(state.presets, 'custom');

    expect(selection?.key).toBe('custom');
    expect(state.preservesActiveDrafts).toBe(true);
    expect(selection?.preset).toEqual({
      name: 'Custom',
      value: { scene: 'default' },
      html: '<div>default</div>',
    });
  });

  test('preserves local drafts when renaming the active preset without changing its key', () => {
    const state = reconcilePresetItems(
      {
        custom: {
          name: 'Custom',
          value: { scene: 'draft' },
          html: '<div>draft</div>',
        },
      },
      'custom',
      [{ value: 'custom', label: 'Renamed Custom' }],
    );

    expect(state.activeKey).toBe('custom');
    expect(state.preservesActiveDrafts).toBe(true);
    expect(state.presets.custom).toEqual({
      name: 'Renamed Custom',
      value: { scene: 'draft' },
      html: '<div>draft</div>',
    });
  });

  test('falls back to the default preset when the active preset is removed', () => {
    const state = reconcilePresetItems(
      {
        default: {
          name: 'Default',
          input: 'pretty_json',
          pattern: '',
          flags: 'g',
          replacement: '',
          codeFenceLang: 'json',
        },
        custom: {
          name: 'Custom',
          input: 'toon',
          pattern: 'scene',
          flags: 'g',
          replacement: 'tracker',
          codeFenceLang: 'text',
        },
      },
      'custom',
      [{ value: 'default', label: 'Default' }],
    );

    expect(state.activeKey).toBe('default');
    expect(state.preservesActiveDrafts).toBe(false);
    expect(state.presets).toEqual({
      default: {
        name: 'Default',
        input: 'pretty_json',
        pattern: '',
        flags: 'g',
        replacement: '',
        codeFenceLang: 'json',
      },
    });
  });
});
