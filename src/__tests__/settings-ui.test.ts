/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

let mockSettings: any = createMockSettings();
const saveSettingsMock = jest.fn();
const profileSelectMock = jest.fn(({ initialSelectedProfileId }: { initialSelectedProfileId?: string }) =>
  React.createElement('div', { 'data-testid': 'profile-select' }, initialSelectedProfileId ?? 'none'),
);

const presetSelectMock = jest.fn(
  ({
    label,
    value,
    items,
    onChange,
  }: {
    label: string;
    value?: string;
    items: Array<{ value: string; label: string }>;
    onChange?: (value?: string) => void;
  }) =>
    React.createElement(
      'label',
      null,
      label,
      React.createElement(
        'select',
        {
          'data-testid': `preset-select-${label}`,
          value: value ?? '',
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange?.(event.target.value),
        },
        items.map((item) => React.createElement('option', { key: item.value, value: item.value }, item.label)),
      ),
    ),
);

const buttonMock = jest.fn(({ onClick, title }: { onClick?: () => void; title?: string }) =>
  React.createElement('button', { type: 'button', title, onClick }),
);

const textareaMock = jest.fn(
  ({
    value,
    onChange,
    className,
  }: {
    value?: string;
    onChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
    className?: string;
  }) =>
    React.createElement('textarea', {
      value: value ?? '',
      className,
      onChange,
    }),
);

const reconcilePresetItemsMock = jest.fn(
  (currentPresets: Record<string, any> | undefined, activeKey: string | undefined, newItems: Array<{ value: string; label: string }>) => {
    const presets = currentPresets ?? {};
    const currentKey = activeKey ?? 'default';
    const fallbackPreset = presets[currentKey] ?? presets.default ?? Object.values(presets)[0];
    const nextPresets: Record<string, any> = {};

    newItems.forEach((item) => {
      const sourcePreset = presets[item.value] ?? fallbackPreset;
      if (!sourcePreset) {
        return;
      }

      nextPresets[item.value] = JSON.parse(JSON.stringify(sourcePreset));
      nextPresets[item.value].name = item.label;
    });

    const fallbackKey = nextPresets.default ? 'default' : newItems[0]?.value ?? 'default';
    const nextActiveKey = nextPresets[currentKey] ? currentKey : fallbackKey;

    return {
      activeKey: nextActiveKey,
      preservesActiveDrafts: nextActiveKey === currentKey,
      presets: nextPresets,
    };
  },
);

const resolvePresetSelectionMock = jest.fn((presets: Record<string, any> | undefined, newValue?: string) => {
  const key = newValue ?? 'default';
  const preset = presets?.[key];
  if (!preset) {
    return undefined;
  }

  return {
    key,
    preset,
  };
});

class MockExtensionSettingsManager {
  getSettings() {
    return mockSettings;
  }

  saveSettings() {
    saveSettingsMock();
  }
}

function createMockSettings() {
  return {
    version: '0.1.0',
    formatVersion: 'F_1.0',
    connectionSource: 'active',
    profileId: 'profile-1',
    trackerSystemPromptMode: 'profile',
    trackerSystemPromptSavedName: '',
    maxResponseToken: 512,
    autoMode: 'none',
    sequentialPartGeneration: false,
    schemaPreset: 'default',
    schemaPresets: {
      default: {
        name: 'Default',
        value: { type: 'object', properties: {}, required: [] },
        html: '<div></div>',
      },
    },
    prompt: 'Generate tracker JSON',
    promptJson: '',
    promptXml: '',
    promptToon: '',
    skipFirstXMessages: 0,
    includeLastXMessages: 0,
    skipCharacterCardInTrackerGeneration: false,
    trackerGenerationConversationRoleMode: 'preserve',
    includeLastXZTrackerMessages: 0,
    embedZTrackerRole: 'user',
    embedZTrackerAsCharacter: false,
    embedZTrackerSnapshotHeader: 'Tracker:',
    embedZTrackerSnapshotTransformPreset: 'default',
    embedZTrackerSnapshotTransformPresets: {},
    promptEngineeringMode: 'native',
    debugLogging: false,
    trackerWorldInfoPolicyMode: 'include_all',
    trackerWorldInfoAllowlistBookNames: [],
    trackerWorldInfoAllowlistEntryIds: [],
  };
}

jest.unstable_mockModule('sillytavern-utils-lib', () => ({
  ExtensionSettingsManager: MockExtensionSettingsManager,
}));

jest.unstable_mockModule('sillytavern-utils-lib/components/react', () => ({
  STConnectionProfileSelect: profileSelectMock,
  STPresetSelect: presetSelectMock,
  STButton: buttonMock,
  STTextarea: textareaMock,
  PresetItem: class PresetItemMock {},
}));

jest.unstable_mockModule('../system-prompt.js', () => ({
  getCurrentGlobalSystemPromptName: () => undefined,
  hasSystemPromptPreset: () => false,
  listSystemPromptPresetNames: () => [],
  shouldWarnAboutSharedSystemPromptSelection: () => false,
}));

jest.unstable_mockModule('../components/settings/preset-state.js', () => ({
  reconcilePresetItems: reconcilePresetItemsMock,
  resolvePresetSelection: resolvePresetSelectionMock,
}));

jest.unstable_mockModule('../components/settings/schema-editor-state.js', () => ({
  formatSchemaHtml: jest.fn(() => '<div></div>'),
  formatSchemaText: jest.fn(() => '{\n}'),
  getSchemaDraftState: jest.fn(() => ({ isValid: true, errorMessage: '', isDirty: false, canSave: false })),
  getSchemaHtmlDraftState: jest.fn(() => ({ isValid: true, errorMessage: '', isDirty: false, canSave: false })),
  shouldSyncSchemaHtmlFromSettings: jest.fn(() => false),
  shouldSyncSchemaTextFromSettings: jest.fn(() => false),
  validateSchemaDraft: jest.fn(() => ({ isValid: true, errorMessage: '' })),
  validateSchemaHtmlDraft: jest.fn(() => ({ isValid: true, errorMessage: '' })),
  validateSchemaPresetDraftPair: jest.fn(() => ({ isValid: true, errorMessage: '' })),
}));

jest.unstable_mockModule('../components/settings/SettingsSectionDrawer.js', () => ({
  SettingsSectionDrawer: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));

jest.unstable_mockModule('../components/settings/TrackerGenerationSection.js', () => ({
  TrackerGenerationSection: ({
    schemaPresetItems,
    currentChatSchemaPresetAvailable,
    currentChatSchemaPresetKey,
    currentChatSchemaPresetLabel,
    currentChatSchemaPresetStoredKey,
    currentChatSchemaPresetUsesDefault,
    currentChatSchemaPresetHasStoredValue,
    currentChatSchemaPresetHasValidStoredValue,
    handleCurrentChatSchemaPresetChange,
    handleSchemaPresetsListChange,
  }: {
    schemaPresetItems: Array<{ value: string; label: string }>;
    currentChatSchemaPresetAvailable: boolean;
    currentChatSchemaPresetKey?: string;
    currentChatSchemaPresetLabel?: string;
    currentChatSchemaPresetStoredKey?: string;
    currentChatSchemaPresetUsesDefault: boolean;
    currentChatSchemaPresetHasStoredValue: boolean;
    currentChatSchemaPresetHasValidStoredValue: boolean;
    handleCurrentChatSchemaPresetChange: (value?: string) => void;
    handleSchemaPresetsListChange: (newItems: Array<{ value: string; label: string }>) => void;
  }) =>
    React.createElement(
      'div',
      null,
      React.createElement('div', null, 'Default Schema Preset'),
      currentChatSchemaPresetAvailable
        ? React.createElement(
            React.Fragment,
            null,
            React.createElement('div', null, 'Current Chat Schema Preset'),
            React.createElement(
              'label',
              null,
              'Current Chat Schema Preset',
              React.createElement(
                'select',
                {
                  'data-testid': 'preset-select-Current Chat Schema Preset',
                  value: currentChatSchemaPresetKey ?? '',
                  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => handleCurrentChatSchemaPresetChange(event.target.value),
                },
                schemaPresetItems.map((item) => React.createElement('option', { key: item.value, value: item.value }, item.label)),
              ),
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                'data-testid': 'delete-custom-preset',
                onClick: () => handleSchemaPresetsListChange([{ value: 'default', label: 'Default' }]),
              },
              'delete custom preset',
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                'data-testid': 'rename-custom-preset',
                onClick: () =>
                  handleSchemaPresetsListChange([
                    { value: 'default', label: 'Default' },
                    { value: 'custom', label: 'Renamed Custom' },
                  ]),
              },
              'rename custom preset',
            ),
          )
        : null,
    ),
}));

jest.unstable_mockModule('../components/settings/TrackerInjectionSection.js', () => ({
  TrackerInjectionSection: () => React.createElement('div', null, 'injection'),
}));

jest.unstable_mockModule('../components/settings/DiagnosticsSection.js', () => ({
  DiagnosticsSection: () => React.createElement('div', null, 'diagnostics'),
}));

const { ZTrackerSettings } = await import('../components/Settings.js');

describe('zTracker settings connection source UI', () => {
  let root: Root | undefined;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    mockSettings = createMockSettings();
    saveSettingsMock.mockReset();
    profileSelectMock.mockClear();
    presetSelectMock.mockClear();
    buttonMock.mockClear();
    textareaMock.mockClear();
    reconcilePresetItemsMock.mockClear();
    resolvePresetSelectionMock.mockClear();
    document.body.innerHTML = '<div id="root"></div>';
    (globalThis as any).SillyTavern = {
      getContext: () => ({
        chatMetadata: { zTracker: { schemaKey: 'default' } },
        saveMetadataDebounced: jest.fn(),
        Popup: { show: { confirm: jest.fn() } },
      }),
    };
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
  });

  function renderSettings() {
    const container = document.getElementById('root');
    if (!container) {
      throw new Error('Missing root container');
    }

    root = createRoot(container);
    act(() => {
      root?.render(React.createElement(ZTrackerSettings));
    });
    return container;
  }

  test('hides the saved profile picker in active connection mode', () => {
    const container = renderSettings();

    expect(container.textContent).toContain('zTracker follows the live SillyTavern connection currently in use');
    expect(container.querySelector('[data-testid="profile-select"]')).toBeNull();
  });

  test('shows the saved profile picker after switching to saved connection mode', () => {
    const container = renderSettings();
    const select = container.querySelector('select');
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error('Connection source select not found');
    }

    act(() => {
      select.value = 'saved';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(mockSettings.connectionSource).toBe('saved');
    expect(saveSettingsMock).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="profile-select"]')).not.toBeNull();
  });

  test('shows separate default and current chat schema preset selectors', () => {
    const container = renderSettings();

    expect(container.textContent).toContain('Default Schema Preset');
    expect(container.textContent).toContain('Current Chat Schema Preset');
  });

  test('changing the current chat schema preset updates chat metadata without changing the global default', () => {
    mockSettings.schemaPresets.alternate = {
      name: 'Alternate',
      value: { type: 'object', properties: { weather: { type: 'string' } }, required: ['weather'] },
      html: '<div>alternate</div>',
    };

    const saveMetadataDebounced = jest.fn();
    const context = {
      chatMetadata: { zTracker: { schemaKey: 'default' } },
      saveMetadataDebounced,
      Popup: { show: { confirm: jest.fn() } },
    };
    (globalThis as any).SillyTavern = {
      getContext: () => context,
    };

    const container = renderSettings();
    const select = container.querySelector('[data-testid="preset-select-Current Chat Schema Preset"]');
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error('Current chat schema preset select not found');
    }

    act(() => {
      select.value = 'alternate';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(context.chatMetadata).toEqual({ zTracker: { schemaKey: 'alternate' } });
    expect(saveMetadataDebounced).toHaveBeenCalledTimes(1);
    expect(mockSettings.schemaPreset).toBe('default');
    expect(saveSettingsMock).not.toHaveBeenCalled();
  });

  test('current chat schema selector falls back to the global default when the chat has no stored schema key', () => {
    const context = {
      chatMetadata: {},
      saveMetadataDebounced: jest.fn(),
      Popup: { show: { confirm: jest.fn() } },
    };
    (globalThis as any).SillyTavern = {
      getContext: () => context,
    };

    const container = renderSettings();
    const select = container.querySelector('[data-testid="preset-select-Current Chat Schema Preset"]');
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error('Current chat schema preset select not found');
    }

    expect(select.value).toBe('default');
  });

  test('deleting the active current chat schema preset immediately persists the fallback preset', () => {
    mockSettings.schemaPreset = 'default';
    mockSettings.schemaPresets = {
      default: {
        name: 'Default',
        value: { type: 'object', properties: {}, required: [] },
        html: '<div>default</div>',
      },
      custom: {
        name: 'Custom',
        value: { type: 'object', properties: { scene: { type: 'string' } }, required: ['scene'] },
        html: '<div>custom</div>',
      },
    };

    const saveMetadataDebounced = jest.fn();
    const context = {
      chatMetadata: { zTracker: { schemaKey: 'custom' } },
      saveMetadataDebounced,
      Popup: { show: { confirm: jest.fn() } },
    };
    (globalThis as any).SillyTavern = {
      getContext: () => context,
    };

    const container = renderSettings();
    const deleteButton = container.querySelector('[data-testid="delete-custom-preset"]');
    if (!(deleteButton instanceof HTMLButtonElement)) {
      throw new Error('Delete custom preset button not found');
    }

    act(() => {
      deleteButton.click();
    });

    expect(context.chatMetadata).toEqual({ zTracker: { schemaKey: 'default' } });
    expect(saveMetadataDebounced).toHaveBeenCalledTimes(1);
    expect(saveSettingsMock).toHaveBeenCalled();
  });

  test('renaming a preset keeps the current chat schema key unchanged', () => {
    mockSettings.schemaPreset = 'custom';
    mockSettings.schemaPresets = {
      default: {
        name: 'Default',
        value: { type: 'object', properties: {}, required: [] },
        html: '<div>default</div>',
      },
      custom: {
        name: 'Custom',
        value: { type: 'object', properties: { scene: { type: 'string' } }, required: ['scene'] },
        html: '<div>custom</div>',
      },
    };

    const saveMetadataDebounced = jest.fn();
    const context = {
      chatMetadata: { zTracker: { schemaKey: 'custom' } },
      saveMetadataDebounced,
      Popup: { show: { confirm: jest.fn() } },
    };
    (globalThis as any).SillyTavern = {
      getContext: () => context,
    };

    const container = renderSettings();
    const renameButton = container.querySelector('[data-testid="rename-custom-preset"]');
    if (!(renameButton instanceof HTMLButtonElement)) {
      throw new Error('Rename custom preset button not found');
    }

    act(() => {
      renameButton.click();
    });

    expect(context.chatMetadata).toEqual({ zTracker: { schemaKey: 'custom' } });
    expect(saveMetadataDebounced).not.toHaveBeenCalled();
    expect(saveSettingsMock).toHaveBeenCalled();
  });

  test('stale current chat schema state still resolves the fallback preset in the selector', () => {
    mockSettings.schemaPresets = {
      default: {
        name: 'Default',
        value: { type: 'object', properties: {}, required: [] },
        html: '<div>default</div>',
      },
    };

    const context = {
      chatMetadata: { zTracker: { schemaKey: 'removed' } },
      saveMetadataDebounced: jest.fn(),
      Popup: { show: { confirm: jest.fn() } },
    };
    (globalThis as any).SillyTavern = {
      getContext: () => context,
    };

    const container = renderSettings();
    const select = container.querySelector('[data-testid="preset-select-Current Chat Schema Preset"]');
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error('Current chat schema preset select not found');
    }

    expect(select.value).toBe('default');
  });
});