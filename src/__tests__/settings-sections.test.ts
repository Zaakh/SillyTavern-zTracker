/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

/** Covers the real settings subcomponents that were still missing focused UI tests. */

const getWorldInfosMock = jest.fn();
const getThirdPartyExtensionBasePathMock = jest.fn(() => '/scripts/extensions/third-party/ztracker');
const formatTrackerRequestDebugSnapshotMock = jest.fn(() => ['lastTrackerRequest:', 'prompt ok']);
const getLastTrackerRequestDebugSnapshotMock = jest.fn(() => ({ requestId: 'debug-1' }));

const presetSelectMock = jest.fn(
  ({
    label,
    value,
    items,
    onChange,
    onItemsChange,
  }: {
    label: string;
    value?: string;
    items: Array<{ value: string; label: string }>;
    onChange?: (value?: string) => void;
    onItemsChange?: (items: Array<{ value: string; label: string }>) => void;
  }) =>
    React.createElement(
      'div',
      null,
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
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': `preset-create-${label}`,
          onClick: () => onItemsChange?.([...items, { value: 'custom', label: 'Custom' }]),
        },
        'create preset',
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': `preset-rename-${label}`,
          onClick: () => onItemsChange?.(items.map((item) => (item.value === 'custom' ? { value: 'renamed', label: 'Renamed' } : item))),
        },
        'rename preset',
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': `preset-delete-${label}`,
          onClick: () => onItemsChange?.(items.filter((item) => item.value !== 'custom' && item.value !== 'renamed')),
        },
        'delete preset',
      ),
    ),
);

const buttonMock = jest.fn(
  ({ children, onClick, title, disabled }: { children?: React.ReactNode; onClick?: () => void; title?: string; disabled?: boolean }) =>
    React.createElement('button', { type: 'button', title, disabled, onClick }, children),
);

const textareaMock = jest.fn(
  ({ value, onChange, rows, placeholder }: { value?: string; onChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void; rows?: number; placeholder?: string }) =>
    React.createElement('textarea', { value: value ?? '', rows, placeholder, onChange }),
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

    return {
      activeKey: nextPresets[currentKey] ? currentKey : (nextPresets.default ? 'default' : newItems[0]?.value ?? 'default'),
      preservesActiveDrafts: false,
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

  return { key, preset };
});

jest.unstable_mockModule('sillytavern-utils-lib', () => ({
  getWorldInfos: getWorldInfosMock,
}));

jest.unstable_mockModule('sillytavern-utils-lib/components/react', () => ({
  STPresetSelect: presetSelectMock,
  STButton: buttonMock,
  STTextarea: textareaMock,
  PresetItem: class PresetItemMock {},
}));

jest.unstable_mockModule('../components/settings/preset-state.js', () => ({
  reconcilePresetItems: reconcilePresetItemsMock,
  resolvePresetSelection: resolvePresetSelectionMock,
}));

jest.unstable_mockModule('../extension-install.js', () => ({
  getThirdPartyExtensionBasePath: getThirdPartyExtensionBasePathMock,
}));

jest.unstable_mockModule('../ui/debug.js', () => ({
  formatTrackerRequestDebugSnapshot: formatTrackerRequestDebugSnapshotMock,
  getLastTrackerRequestDebugSnapshot: getLastTrackerRequestDebugSnapshotMock,
}));

const { SettingsSectionDrawer } = await import('../components/settings/SettingsSectionDrawer.js');
const { SystemPromptSettingsSection } = await import('../components/settings/SystemPromptSettingsSection.js');
const { WorldInfoPolicySection } = await import('../components/settings/WorldInfoPolicySection.js');
const { EmbedSnapshotTransformSection } = await import('../components/settings/EmbedSnapshotTransformSection.js');
const { DiagnosticsSection } = await import('../components/settings/DiagnosticsSection.js');
const { TrackerWorldInfoPolicyMode } = await import('../config.js');

/** Renders one React element into the shared jsdom root container. */
function renderElement(element: React.ReactElement) {
  const container = document.getElementById('root');
  if (!container) {
    throw new Error('Missing root container');
  }

  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, root };
}

/** Updates one controlled text input or textarea through the native DOM setter so React sees the change. */
function setTextControlValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Updates one controlled select through the native DOM setter so React sees the change. */
function setSelectValue(element: HTMLSelectElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Updates one controlled checkbox through the native DOM setter so React sees the change. */
function setCheckboxValue(element: HTMLInputElement, checked: boolean): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
  descriptor?.set?.call(element, checked);
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('settings sections', () => {
  let root: Root | undefined;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="root"></div>';
    getWorldInfosMock.mockReset();
    getThirdPartyExtensionBasePathMock.mockClear();
    formatTrackerRequestDebugSnapshotMock.mockClear();
    getLastTrackerRequestDebugSnapshotMock.mockClear();
    presetSelectMock.mockClear();
    buttonMock.mockClear();
    textareaMock.mockClear();
    reconcilePresetItemsMock.mockClear();
    resolvePresetSelectionMock.mockClear();
    (globalThis as any).fetch = jest.fn();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
  });

  test('calls the drawer toggle callback and reflects open state changes', () => {
    const onToggle = jest.fn();
    ({ root } = renderElement(
      React.createElement(SettingsSectionDrawer, { title: 'Tracker Generation', isOpen: false, onToggle }, React.createElement('div', null, 'content')),
    ));

    const header = document.querySelector('.inline-drawer-header');
    const content = document.querySelector('.inline-drawer-content') as HTMLDivElement | null;
    if (!(header instanceof HTMLDivElement) || !(content instanceof HTMLDivElement)) {
      throw new Error('Drawer elements not found');
    }

    expect(content.style.display).toBe('none');

    act(() => {
      header.click();
    });

    expect(onToggle).toHaveBeenCalledTimes(1);

    act(() => {
      root?.render(
        React.createElement(SettingsSectionDrawer, { title: 'Tracker Generation', isOpen: true, onToggle }, React.createElement('div', null, 'content')),
      );
    });

    expect((document.querySelector('.inline-drawer-content') as HTMLDivElement | null)?.style.display).toBe('block');
  });

  test('updates the saved system prompt selection and refreshes the prompt state on demand', () => {
    const settings = { trackerSystemPromptMode: 'saved', trackerSystemPromptSavedName: 'Prompt A' } as any;
    const refreshSystemPromptState = jest.fn();
    const updateAndRefresh = (updater: (current: any) => void) => updater(settings);

    ({ root } = renderElement(
      React.createElement(SystemPromptSettingsSection, {
        settings,
        updateAndRefresh,
        systemPromptItems: [
          { value: 'Prompt A', label: 'Prompt A' },
          { value: 'Prompt B', label: 'Prompt B' },
        ],
        refreshSystemPromptState,
        showMissingSavedSystemPromptWarning: false,
        showSharedSystemPromptWarning: false,
      }),
    ));

    const selects = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
    const savedPromptSelect = selects[1];
    if (!(savedPromptSelect instanceof HTMLSelectElement)) {
      throw new Error('Saved prompt select not found');
    }

    act(() => {
      setSelectValue(savedPromptSelect, 'Prompt B');
    });

    expect(settings.trackerSystemPromptSavedName).toBe('Prompt B');

    const refreshButton = document.querySelector('button[title="Refresh the saved prompt list and current global prompt warning"]');
    if (!(refreshButton instanceof HTMLButtonElement)) {
      throw new Error('Refresh prompt button not found');
    }

    act(() => {
      refreshButton.click();
    });

    expect(refreshSystemPromptState).toHaveBeenCalledTimes(1);
  });

  test('updates the world-info mode from the settings surface', () => {
    const settings = {
      trackerWorldInfoPolicyMode: TrackerWorldInfoPolicyMode.INCLUDE_ALL,
      trackerWorldInfoAllowlistBookNames: [],
      trackerWorldInfoAllowlistEntryIds: [],
    } as any;
    const updateAndRefresh = (updater: (current: any) => void) => updater(settings);

    ({ root } = renderElement(React.createElement(WorldInfoPolicySection, { settings, updateAndRefresh })));

    const policySelect = document.querySelector('select[title="Controls whether SillyTavern World Info is included when zTracker builds the prompt for tracker generation."]');
    if (!(policySelect instanceof HTMLSelectElement)) {
      throw new Error('World Info policy select not found');
    }

    act(() => {
      setSelectValue(policySelect, TrackerWorldInfoPolicyMode.ALLOWLIST);
    });

    expect(settings.trackerWorldInfoPolicyMode).toBe(TrackerWorldInfoPolicyMode.ALLOWLIST);
  });

  test('refreshes, filters, adds, removes, and manually edits world-info allowlists', async () => {
    const settings = {
      trackerWorldInfoPolicyMode: TrackerWorldInfoPolicyMode.ALLOWLIST,
      trackerWorldInfoAllowlistBookNames: ['Existing'],
      trackerWorldInfoAllowlistEntryIds: [],
    } as any;
    const updateAndRefresh = (updater: (current: any) => void) => updater(settings);
    getWorldInfosMock.mockResolvedValue({ 'Lore B': {}, 'Lore A': {} });

    ({ root } = renderElement(React.createElement(WorldInfoPolicySection, { settings, updateAndRefresh })));

    const refreshButton = document.querySelector('button[title="Refresh detected books"]');
    if (!(refreshButton instanceof HTMLButtonElement)) {
      throw new Error('Refresh book list button not found');
    }

    await act(async () => {
      refreshButton.click();
      await Promise.resolve();
    });

    expect(getWorldInfosMock).toHaveBeenCalledWith(['global', 'chat', 'character', 'persona'], true);

    const searchInput = document.querySelector('input[placeholder="Search detected books…"]');
    const addSelect = document.querySelector('select[title="Select a detected lorebook to add to the allowlist."]');
    if (!(searchInput instanceof HTMLInputElement) || !(addSelect instanceof HTMLSelectElement)) {
      throw new Error('World info picker controls not found');
    }

    act(() => {
      setTextControlValue(searchInput, 'Lore B');
    });

    act(() => {
      setSelectValue(addSelect, 'Lore B');
    });

    const addButton = document.querySelector('button[title="Add selected book"]');
    if (!(addButton instanceof HTMLButtonElement)) {
      throw new Error('Add book button not found');
    }

    act(() => {
      addButton.click();
    });

    expect(settings.trackerWorldInfoAllowlistBookNames).toEqual(['Existing', 'Lore B']);

    const removeButton = document.querySelector('button[title="Remove"]');
    if (!(removeButton instanceof HTMLButtonElement)) {
      throw new Error('Remove book button not found');
    }

    act(() => {
      removeButton.click();
    });

    expect(settings.trackerWorldInfoAllowlistBookNames).toEqual(['Lore B']);

    const textareas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
    const booksTextarea = textareas[0];
    const idsTextarea = textareas[1];
    if (!(booksTextarea instanceof HTMLTextAreaElement) || !(idsTextarea instanceof HTMLTextAreaElement)) {
      throw new Error('World info textareas not found');
    }

    act(() => {
      setTextControlValue(booksTextarea, 'Lore B\nlore b\nOther');
    });

    expect(settings.trackerWorldInfoAllowlistBookNames).toEqual(['Lore B', 'Other']);

    act(() => {
      setTextControlValue(idsTextarea, '12 42, 12 -1 foo 7.9');
    });

    expect(settings.trackerWorldInfoAllowlistEntryIds).toEqual([12, 42, 7]);
  });

  test('updates transform preset selection, CRUD, and field edits from the settings surface', () => {
    const settings = {
      embedZTrackerSnapshotHeader: 'Tracker:',
      embedZTrackerSnapshotTransformPreset: 'default',
      embedZTrackerSnapshotTransformPresets: {
        default: {
          name: 'Default',
          input: 'pretty_json',
          pattern: '',
          flags: '',
          replacement: '',
          codeFenceLang: 'json',
          wrapInCodeFence: true,
        },
        custom: {
          name: 'Custom',
          input: 'top_level_lines',
          pattern: 'time',
          flags: 'gi',
          replacement: 'clock',
          codeFenceLang: 'text',
          wrapInCodeFence: false,
        },
      },
    } as any;
    const updateAndRefresh = (updater: (current: any) => void) => updater(settings);

    ({ root } = renderElement(React.createElement(EmbedSnapshotTransformSection, { settings, updateAndRefresh })));

    const headerInput = document.querySelector('input[title="Header line to prepend before the embedded zTracker snapshot in normal generations. Set empty to omit."]');
    const presetSelect = document.querySelector('[data-testid="preset-select-Embed snapshot transform preset"]');
    if (!(headerInput instanceof HTMLInputElement) || !(presetSelect instanceof HTMLSelectElement)) {
      throw new Error('Transform header or preset select not found');
    }

    act(() => {
      setTextControlValue(headerInput, 'Scene:');
    });

    expect(settings.embedZTrackerSnapshotHeader).toBe('Scene:');

    act(() => {
      setSelectValue(presetSelect, 'custom');
    });

    expect(settings.embedZTrackerSnapshotTransformPreset).toBe('custom');

    act(() => {
      root?.render(React.createElement(EmbedSnapshotTransformSection, { settings, updateAndRefresh }));
    });

    const transformInputSelect = document.querySelector('select[title="Controls what text the regex runs against."]');
    const regexFlagsInput = document.querySelector('input[title="JavaScript regex flags (e.g. g, i, m)."]');
    const codeFenceLangInput = document.querySelector('input[title="Language tag used for the Markdown code fence when wrapping is enabled (e.g. json, text). Ignored if wrapping is disabled."]');
    const wrapCheckbox = document.querySelector('input[title="When enabled, wraps the embedded snapshot in a Markdown code fence for readability (example: ```json ... ```)."]');
    const textareas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
    const patternTextarea = textareas[0];
    const replacementTextarea = textareas[1];

    if (!(transformInputSelect instanceof HTMLSelectElement)
      || !(regexFlagsInput instanceof HTMLInputElement)
      || !(codeFenceLangInput instanceof HTMLInputElement)
      || !(wrapCheckbox instanceof HTMLInputElement)
      || !(patternTextarea instanceof HTMLTextAreaElement)
      || !(replacementTextarea instanceof HTMLTextAreaElement)) {
      throw new Error('Transform field controls not found');
    }

    act(() => {
      setSelectValue(transformInputSelect, 'toon');
      setTextControlValue(patternTextarea, 'scene');
      setTextControlValue(regexFlagsInput, 'm');
      setTextControlValue(replacementTextarea, 'place');
      setTextControlValue(codeFenceLangInput, 'yaml');
    });

    act(() => {
      wrapCheckbox.click();
    });

    expect(settings.embedZTrackerSnapshotTransformPresets.custom).toMatchObject({
      input: 'toon',
      pattern: 'scene',
      flags: 'm',
      replacement: 'place',
      codeFenceLang: 'yaml',
      wrapInCodeFence: true,
    });

    const createButton = document.querySelector('[data-testid="preset-create-Embed snapshot transform preset"]');
    const renameButton = document.querySelector('[data-testid="preset-rename-Embed snapshot transform preset"]');
    const deleteButton = document.querySelector('[data-testid="preset-delete-Embed snapshot transform preset"]');
    if (!(createButton instanceof HTMLButtonElement) || !(renameButton instanceof HTMLButtonElement) || !(deleteButton instanceof HTMLButtonElement)) {
      throw new Error('Transform preset CRUD buttons not found');
    }

    act(() => {
      createButton.click();
    });
    expect(settings.embedZTrackerSnapshotTransformPresets.custom).toBeDefined();

    act(() => {
      root?.render(React.createElement(EmbedSnapshotTransformSection, { settings, updateAndRefresh }));
    });

    act(() => {
      renameButton.click();
    });
    expect(settings.embedZTrackerSnapshotTransformPresets.renamed?.name).toBe('Renamed');

    act(() => {
      root?.render(React.createElement(EmbedSnapshotTransformSection, { settings, updateAndRefresh }));
    });

    act(() => {
      deleteButton.click();
    });
    expect(settings.embedZTrackerSnapshotTransformPresets.renamed).toBeUndefined();
  });

  test('toggles debug logging and writes diagnostics output from the diagnostics surface', async () => {
    const setDebugLogging = jest.fn();
    const setDiagnosticsText = jest.fn();
    const consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    (globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    ({ root } = renderElement(
      React.createElement(DiagnosticsSection, {
        debugLogging: false,
        setDebugLogging,
        diagnosticsText: '',
        setDiagnosticsText,
      }),
    ));

    const checkbox = document.querySelector('input[title="Enables extra console logging and exposes a diagnostics helper for template URLs."]');
    const runButton = document.querySelector('button[title="Run diagnostics"]');
    if (!(checkbox instanceof HTMLInputElement) || !(runButton instanceof HTMLButtonElement)) {
      throw new Error('Diagnostics controls not found');
    }

    act(() => {
      checkbox.click();
    });

    expect(setDebugLogging).toHaveBeenCalledWith(true);

    await act(async () => {
      runButton.click();
      await Promise.resolve();
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost/scripts/extensions/third-party/ztracker/dist/templates/buttons.html',
      { cache: 'no-store' },
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost/scripts/extensions/third-party/ztracker/dist/templates/modify_schema_popup.html',
      { cache: 'no-store' },
    );
    expect(setDiagnosticsText).toHaveBeenCalledWith(expect.stringContaining('template: dist/templates/buttons'));
    expect(setDiagnosticsText).toHaveBeenCalledWith(expect.stringContaining('lastTrackerRequest:'));
    expect(consoleDebugSpy).toHaveBeenCalledWith(expect.stringContaining('prompt ok'));
  });
});