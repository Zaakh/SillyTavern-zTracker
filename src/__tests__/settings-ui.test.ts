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
  PresetItem: class PresetItemMock {},
}));

jest.unstable_mockModule('../system-prompt.js', () => ({
  getCurrentGlobalSystemPromptName: () => undefined,
  hasSystemPromptPreset: () => false,
  listSystemPromptPresetNames: () => [],
  shouldWarnAboutSharedSystemPromptSelection: () => false,
}));

jest.unstable_mockModule('../components/settings/preset-state.js', () => ({
  reconcilePresetItems: jest.fn(),
  resolvePresetSelection: jest.fn(),
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
}));

jest.unstable_mockModule('../components/settings/SettingsSectionDrawer.js', () => ({
  SettingsSectionDrawer: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));

jest.unstable_mockModule('../components/settings/TrackerGenerationSection.js', () => ({
  TrackerGenerationSection: () => React.createElement('div', null, 'generation'),
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
    document.body.innerHTML = '<div id="root"></div>';
    (globalThis as any).SillyTavern = {
      getContext: () => ({ Popup: { show: { confirm: jest.fn() } } }),
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
});