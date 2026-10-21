/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

/** Covers the real settings subcomponents that were still missing focused UI tests. */

const getWorldInfosMock = jest.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>();
type FetchResult = { ok: boolean; status: number };
const fetchMock = () => globalThis.fetch as unknown as jest.Mock<() => Promise<FetchResult>>;
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

const buttonMock = jest.fn(({ children, className, ...props }: any) =>
  React.createElement('button', { type: 'button', ...props, className: ['menu_button', 'interactable', className].filter(Boolean).join(' ') }, children),
);

const textareaMock = jest.fn(
  ({
    value,
    onChange,
    rows,
    placeholder,
    disabled,
  }: {
    value?: string;
    onChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
    rows?: number;
    placeholder?: string;
    disabled?: boolean;
  }) => React.createElement('textarea', { value: value ?? '', rows, placeholder, disabled, onChange }),
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
const { IncludeModulesSection } = await import('../components/settings/IncludeModulesSection.js');
const { GenerationPromptTemplatesSection } = await import('../components/settings/GenerationPromptTemplatesSection.js');
const { TrackerWorldInfoPolicyMode, PromptEngineeringMode, createDefaultTrackerModule } = await import('../config.js');

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
    (globalThis as any).fetch = jest.fn<() => Promise<FetchResult>>();
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
      React.createElement(SettingsSectionDrawer, { title: 'Tracker Generation', isOpen: false, onToggle, children: React.createElement('div', null, 'content') }),
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
        React.createElement(SettingsSectionDrawer, { title: 'Tracker Generation', isOpen: true, onToggle, children: React.createElement('div', null, 'content') }),
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
        showRecreateSystemPromptAction: false,
        recreateModuleSystemPromptPreset: () => undefined,
        isRecreatingSystemPrompt: false,
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
      trackerWorldInfoAllowlist: [],
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

  test('disables the Prompt field outside Native mode and re-enables it back in Native mode', () => {
    const settings = {
      promptEngineeringMode: PromptEngineeringMode.NATIVE,
      prompt: 'native prompt',
      promptJson: 'json prompt',
      promptXml: 'xml prompt',
      promptToon: 'toon prompt',
      grammarEnforcementEnabled: false,
    } as any;
    const updateAndRefresh = (updater: (current: any) => void) => updater(settings);
    const testGrammarSchemaEnforcement = jest.fn(async () => ({ supported: true, message: 'ok' }));

    ({ root } = renderElement(
      React.createElement(GenerationPromptTemplatesSection, { settings, updateAndRefresh, moduleId: 'default', testGrammarSchemaEnforcement }),
    ));

    const getPromptTextarea = () => document.querySelectorAll('textarea')[0] as HTMLTextAreaElement;
    const getRestoreButton = () => document.querySelector('button[title="Restore Prompt to default"]') as HTMLButtonElement | null;

    expect(getPromptTextarea().disabled).toBe(false);
    expect(getRestoreButton()?.disabled).toBe(false);
    expect(document.body.textContent).not.toContain('use the matching');

    act(() => {
      settings.promptEngineeringMode = PromptEngineeringMode.JSON;
      root?.render(
        React.createElement(GenerationPromptTemplatesSection, { settings, updateAndRefresh, moduleId: 'default', testGrammarSchemaEnforcement }),
      );
    });

    expect(getPromptTextarea().disabled).toBe(true);
    expect(getRestoreButton()?.disabled).toBe(true);
    expect(document.body.textContent).toContain('use the matching');

    act(() => {
      settings.promptEngineeringMode = PromptEngineeringMode.NATIVE;
      root?.render(
        React.createElement(GenerationPromptTemplatesSection, { settings, updateAndRefresh, moduleId: 'default', testGrammarSchemaEnforcement }),
      );
    });

    expect(getPromptTextarea().disabled).toBe(false);
    expect(getRestoreButton()?.disabled).toBe(false);
    expect(document.body.textContent).not.toContain('use the matching');
  });

  test('hides the grammar/schema enforcement setting outside JSON mode and shows it in JSON mode', () => {
    const settings = {
      promptEngineeringMode: PromptEngineeringMode.NATIVE,
      prompt: 'native prompt',
      promptJson: 'json prompt',
      promptXml: 'xml prompt',
      promptToon: 'toon prompt',
      grammarEnforcementEnabled: false,
    } as any;
    const updateAndRefresh = (updater: (current: any) => void) => updater(settings);
    const testGrammarSchemaEnforcement = jest.fn(async () => ({ supported: true, message: 'ok' }));

    ({ root } = renderElement(
      React.createElement(GenerationPromptTemplatesSection, { settings, updateAndRefresh, moduleId: 'default', testGrammarSchemaEnforcement }),
    ));

    expect(document.body.textContent).not.toContain('Enforce schema via grammar sampling');

    act(() => {
      settings.promptEngineeringMode = PromptEngineeringMode.JSON;
      root?.render(
        React.createElement(GenerationPromptTemplatesSection, { settings, updateAndRefresh, moduleId: 'default', testGrammarSchemaEnforcement }),
      );
    });

    expect(document.body.textContent).toContain('Enforce schema via grammar sampling');

    act(() => {
      settings.promptEngineeringMode = PromptEngineeringMode.XML;
      root?.render(
        React.createElement(GenerationPromptTemplatesSection, { settings, updateAndRefresh, moduleId: 'default', testGrammarSchemaEnforcement }),
      );
    });

    expect(document.body.textContent).not.toContain('Enforce schema via grammar sampling');
  });

  test('toggles the grammar/schema enforcement checkbox and persists the change onto settings', () => {
    const settings = {
      promptEngineeringMode: PromptEngineeringMode.JSON,
      prompt: 'native prompt',
      promptJson: 'json prompt',
      promptXml: 'xml prompt',
      promptToon: 'toon prompt',
      grammarEnforcementEnabled: false,
    } as any;
    const updateAndRefresh = (updater: (current: any) => void) => updater(settings);
    const testGrammarSchemaEnforcement = jest.fn(async () => ({ supported: true, message: 'ok' }));

    ({ root } = renderElement(
      React.createElement(GenerationPromptTemplatesSection, { settings, updateAndRefresh, moduleId: 'default', testGrammarSchemaEnforcement }),
    ));

    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    if (!(checkbox instanceof HTMLInputElement)) {
      throw new Error('Grammar enforcement checkbox not found');
    }

    act(() => {
      checkbox.click();
    });

    expect(settings.grammarEnforcementEnabled).toBe(true);
  });

  test('runs the Test action and renders a pass result, then a fail result on the next run', async () => {
    const settings = {
      promptEngineeringMode: PromptEngineeringMode.JSON,
      prompt: 'native prompt',
      promptJson: 'json prompt',
      promptXml: 'xml prompt',
      promptToon: 'toon prompt',
      grammarEnforcementEnabled: true,
    } as any;
    const updateAndRefresh = (updater: (current: any) => void) => updater(settings);
    const testGrammarSchemaEnforcement = jest
      .fn<() => Promise<{ supported: boolean; message: string }>>()
      .mockResolvedValueOnce({ supported: true, message: 'Schema enforcement is supported.' })
      .mockResolvedValueOnce({ supported: false, message: 'Not confirmed for this connection.' });

    ({ root } = renderElement(
      React.createElement(GenerationPromptTemplatesSection, { settings, updateAndRefresh, moduleId: 'my-module', testGrammarSchemaEnforcement }),
    ));

    const testButton = document.querySelector('button.menu_button') as HTMLButtonElement | null;
    if (!(testButton instanceof HTMLButtonElement)) {
      throw new Error('Test button not found');
    }

    await act(async () => {
      testButton.click();
      await Promise.resolve();
    });

    expect(testGrammarSchemaEnforcement).toHaveBeenCalledWith('my-module');
    expect(document.body.textContent).toContain('Schema enforcement is supported.');

    await act(async () => {
      testButton.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('Not confirmed for this connection.');
  });

  test('Test button sits in its own row beside the result, and restore icons name the value they restore', async () => {
    const settings = {
      promptEngineeringMode: PromptEngineeringMode.JSON,
      prompt: 'native prompt',
      promptJson: 'json prompt',
      promptXml: 'xml prompt',
      promptToon: 'toon prompt',
      grammarEnforcementEnabled: true,
    } as any;
    const testGrammarSchemaEnforcement = jest.fn<any>().mockResolvedValue({ supported: true, message: 'Supported.' });

    ({ root } = renderElement(
      React.createElement(GenerationPromptTemplatesSection, { settings, updateAndRefresh: jest.fn(), moduleId: 'm', testGrammarSchemaEnforcement }),
    ));

    const testButton = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Test') as HTMLButtonElement;
    expect(testButton.closest('label')).toBeNull();
    const row = testButton.closest('.ztracker-button-row') as HTMLElement;
    await act(async () => {
      testButton.click();
      await Promise.resolve();
    });
    expect(testGrammarSchemaEnforcement).toHaveBeenCalledWith('m');
    expect(row.textContent).toContain('Supported.');

    expect(document.querySelector('button[aria-label="Restore Prompt to its default value"]')).not.toBeNull();
  });

  test('discards a stale Test result that resolves after the selected Module has changed', async () => {
    // Regression test for a module-switch race: an in-flight Test request for the previously
    // selected Module must not overwrite the newly selected Module's (reset) result once it
    // resolves, since it describes a connection the user is no longer looking at.
    const settingsA = {
      promptEngineeringMode: PromptEngineeringMode.JSON,
      prompt: 'native prompt',
      promptJson: 'json prompt',
      promptXml: 'xml prompt',
      promptToon: 'toon prompt',
      grammarEnforcementEnabled: true,
    } as any;
    const settingsB = { ...settingsA };
    const updateAndRefreshA = (updater: (current: any) => void) => updater(settingsA);
    const updateAndRefreshB = (updater: (current: any) => void) => updater(settingsB);

    let resolveTestForModuleA: (value: { supported: boolean; message: string }) => void = () => undefined;
    const testGrammarSchemaEnforcement = jest.fn(
      () => new Promise<{ supported: boolean; message: string }>((resolve) => {
        resolveTestForModuleA = resolve;
      }),
    );

    ({ root } = renderElement(
      React.createElement(GenerationPromptTemplatesSection, {
        settings: settingsA,
        updateAndRefresh: updateAndRefreshA,
        moduleId: 'module-a',
        testGrammarSchemaEnforcement,
      }),
    ));

    const testButton = document.querySelector('button.menu_button') as HTMLButtonElement | null;
    if (!(testButton instanceof HTMLButtonElement)) {
      throw new Error('Test button not found');
    }

    act(() => {
      testButton.click();
    });

    expect(testGrammarSchemaEnforcement).toHaveBeenCalledWith('module-a');

    // Switch the selected Module while module-a's request is still pending.
    act(() => {
      root?.render(
        React.createElement(GenerationPromptTemplatesSection, {
          settings: settingsB,
          updateAndRefresh: updateAndRefreshB,
          moduleId: 'module-b',
          testGrammarSchemaEnforcement,
        }),
      );
    });

    // The stale request for module-a resolves only now, after the switch.
    await act(async () => {
      resolveTestForModuleA({ supported: true, message: 'Schema enforcement is supported for module-a.' });
      await Promise.resolve();
    });

    expect(document.body.textContent).not.toContain('module-a');
    expect(document.body.textContent).not.toContain('Schema enforcement is supported');
  });

  function renderAllowlist(rows: any[]) {
    const settings = { trackerWorldInfoPolicyMode: TrackerWorldInfoPolicyMode.ALLOWLIST, trackerWorldInfoAllowlist: rows } as any;
    const rerender = () => {
      act(() => root!.render(React.createElement(WorldInfoPolicySection, { settings, updateAndRefresh })));
    };
    const updateAndRefresh = (updater: (current: any) => void) => {
      updater(settings);
      rerender();
    };
    ({ root } = renderElement(React.createElement(WorldInfoPolicySection, { settings, updateAndRefresh })));
    return settings;
  }

  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const rowTexts = () => Array.from(document.querySelectorAll('[data-testid="world-info-row"]')).map((r) => r.textContent ?? '');

  test('refreshes, filters, adds (as engine rows, ignoring duplicates) and removes allowlisted books', async () => {
    const settings = renderAllowlist([{ book: 'Existing', activeVia: [], entryIds: [], trigger: 'always' }]);
    getWorldInfosMock.mockResolvedValue({ 'Lore B': {}, 'Lore A': {} });

    const refreshButton = document.querySelector('button[title="Refresh detected books"]') as HTMLButtonElement;
    await act(async () => {
      refreshButton.click();
      await Promise.resolve();
    });
    expect(getWorldInfosMock).toHaveBeenCalledWith(['global', 'chat', 'character', 'persona'], true);

    const searchInput = document.querySelector('input[placeholder="Search detected books…"]') as HTMLInputElement;
    const addSelect = document.querySelector('select[title="Select a detected lorebook to add to the allowlist."]') as HTMLSelectElement;
    act(() => setTextControlValue(searchInput, 'Lore B'));
    act(() => setSelectValue(addSelect, 'Lore B'));

    const addButton = document.querySelector('button[title="Add selected book"]') as HTMLButtonElement;
    act(() => addButton.click());
    expect(settings.trackerWorldInfoAllowlist).toEqual([
      { book: 'Existing', activeVia: [], entryIds: [], trigger: 'always' },
      { book: 'Lore B', activeVia: [], entryIds: [], trigger: 'engine' },
    ]);

    act(() => addButton.click());
    expect(settings.trackerWorldInfoAllowlist).toHaveLength(2);

    act(() => (document.querySelector('button[title="Remove"]') as HTMLButtonElement).click());
    expect(settings.trackerWorldInfoAllowlist).toEqual([{ book: 'Lore B', activeVia: [], entryIds: [], trigger: 'engine' }]);
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  test('add row reads Search, Select, Add; Refresh and Recheck are grouped apart; remove names the book', () => {
    renderAllowlist([{ book: 'Lore A', activeVia: [], entryIds: [] }]);

    const rows = Array.from(document.querySelectorAll('.ztracker-worldinfo-allowlist > .ztracker-button-row'));
    expect(rows).toHaveLength(2);
    const [addRow, secondaryRow] = rows;
    expect(Array.from(addRow.children).map((el) => el.tagName)).toEqual(['INPUT', 'SELECT', 'BUTTON']);
    expect(addRow.querySelector('button')?.textContent).toBe('Add');
    expect(Array.from(secondaryRow.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Refresh book list', 'Recheck']);

    const remove = document.querySelector('[data-testid="world-info-row"] button[title="Remove"]') as HTMLButtonElement;
    expect(remove.getAttribute('aria-label')).toBe('Remove Lore A');
    expect(remove.querySelector('i.fa-xmark')).not.toBeNull();
  });

  test('toggling scope checkboxes and the UID field persist onto the row', () => {
    const settings = renderAllowlist([{ book: 'Lore A', activeVia: [], entryIds: [] }]);
    const [card, global] = Array.from(document.querySelectorAll('[data-testid="world-info-row"] input[type="checkbox"]')) as HTMLInputElement[];

    act(() => card.click());
    expect(settings.trackerWorldInfoAllowlist[0].activeVia).toEqual(['card']);
    act(() => global.click());
    expect(settings.trackerWorldInfoAllowlist[0].activeVia).toEqual(['card', 'global']);
    act(() => card.click());
    expect(settings.trackerWorldInfoAllowlist[0].activeVia).toEqual(['global']);

    const uidInput = document.querySelector('input[placeholder="Entry UIDs (empty = all)"]') as HTMLInputElement;
    act(() => {
      setTextControlValue(uidInput, '12 42, 12 -1 foo 7.9');
      uidInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(settings.trackerWorldInfoAllowlist[0].entryIds).toEqual([12, 42, 7]);
  });

  test('the per-row trigger select switches between engine and always', () => {
    const settings = renderAllowlist([{ book: 'Lore A', activeVia: [], entryIds: [], trigger: 'always' }]);
    const select = document.querySelector('select[aria-label="Activation for Lore A"]') as HTMLSelectElement;
    expect(select.value).toBe('always');

    act(() => setSelectValue(select, 'engine'));
    expect(settings.trackerWorldInfoAllowlist[0].trigger).toBe('engine');
    act(() => setSelectValue(select, 'always'));
    expect(settings.trackerWorldInfoAllowlist[0].trigger).toBe('always');
  });

  describe('scope status', () => {
    const originalSillyTavern = (globalThis as any).SillyTavern;
    afterEach(() => {
      (globalThis as any).SillyTavern = originalSillyTavern;
    });

    function installChat(chatId: string | undefined) {
      (globalThis as any).SillyTavern = {
        getContext: () => ({
          chatId,
          chatMetadata: {},
          characters: [{ avatar: 'a.png', data: { extensions: { world: 'Attached' } } }],
          characterId: 0,
          executeSlashCommandsWithOptions: jest.fn(async () => ({ pipe: '[]' })),
        }),
      };
    }

    test('warns for a skipped scoped row, never for an always row, and Recheck re-runs the check', async () => {
      installChat('chat-1');
      renderAllowlist([
        { book: 'Attached', activeVia: ['card'], entryIds: [] },
        { book: 'Detached', activeVia: ['card'], entryIds: [] },
        { book: 'Always', activeVia: [], entryIds: [] },
      ]);
      await flush();

      const [attached, detached, always] = rowTexts();
      expect(attached).not.toContain('Skipped');
      expect(detached).toContain('Skipped for the open chat');
      expect(always).not.toContain('Skipped');
      expect(always).not.toContain('cannot be checked');

      installChat(undefined);
      await act(async () => {
        (document.querySelector('button[title="Recheck scope against the open chat"]') as HTMLButtonElement).click();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(rowTexts()[1]).toContain('cannot be checked');
      expect(rowTexts()[1]).not.toContain('Skipped');
    });

    test('makes no host calls when no row has a scope', async () => {
      const getContext = jest.fn();
      (globalThis as any).SillyTavern = { getContext };
      renderAllowlist([{ book: 'Always', activeVia: [], entryIds: [] }]);
      await flush();
      expect(getContext).not.toHaveBeenCalled();
    });
  });

  describe('transform preset editor (global list)', () => {
    const preset = (name: string, extra: Record<string, unknown> = {}) => ({
      name,
      input: 'pretty_json',
      pattern: '',
      flags: '',
      replacement: '',
      codeFenceLang: 'json',
      wrapInCodeFence: true,
      ...extra,
    });

    /** Extension-wide state plus the flattened view of the first Module, rebuilt on every render like Settings.tsx does. */
    function setup(selections: string[]) {
      const global: any = {
        transformPresets: {
          default: preset('Default'),
          minimal: preset('Minimal', { input: 'top_level_lines' }),
          toon: preset('TOON', { input: 'toon' }),
          flat: preset('Flat', { input: 'flat_lines' }),
          custom: preset('Custom', { input: 'top_level_lines', pattern: 'time', flags: 'gi', replacement: 'clock', wrapInCodeFence: false }),
        },
        modules: selections.map((transformPreset) => ({ injection: { transformPreset } })),
      };
      const draft = { embedZTrackerSnapshotHeader: 'Tracker:' } as any;
      const flat = () => ({
        ...global,
        ...draft,
        embedZTrackerSnapshotTransformPreset: global.modules[0].injection.transformPreset,
        embedZTrackerSnapshotTransformPresets: global.transformPresets,
      });
      const updateAndRefresh = (updater: (current: any) => void) => {
        const view = flat();
        updater(view);
        draft.embedZTrackerSnapshotHeader = view.embedZTrackerSnapshotHeader;
        global.modules[0].injection.transformPreset = view.embedZTrackerSnapshotTransformPreset;
      };
      const updateGlobal = (updater: (current: any) => void) => updater(global);
      const render = () =>
        act(() => {
          const element = React.createElement(EmbedSnapshotTransformSection, { settings: flat() as any, updateAndRefresh, updateGlobal });
          if (root) root.render(element);
          else ({ root } = renderElement(element));
        });
      render();
      return { global, render };
    }

    const control = (id: string) => document.querySelector(`[data-testid="preset-${id}-Embed snapshot transform preset"]`) as any;

    test('selection writes the Module key and field edits write the global list', () => {
      const { global, render } = setup(['default']);

      act(() => {
        setSelectValue(control('select'), 'custom');
      });
      expect(global.modules[0].injection.transformPreset).toBe('custom');
      render();

      const flags = document.querySelector('input[title="JavaScript regex flags (e.g. g, i, m)."]') as HTMLInputElement;
      const patternTextarea = document.querySelectorAll('textarea')[0] as HTMLTextAreaElement;
      const wrap = document.querySelector('input[title^="When enabled, wraps the embedded snapshot"]') as HTMLInputElement;
      act(() => {
        setTextControlValue(patternTextarea, 'scene');
        setTextControlValue(flags, 'm');
      });
      act(() => {
        wrap.click();
      });

      expect(global.transformPresets.custom).toMatchObject({ pattern: 'scene', flags: 'm', wrapInCodeFence: true });
    });

    test('create and rename update the global list', () => {
      const { global, render } = setup(['default']);
      delete global.transformPresets.custom;
      render();

      act(() => {
        control('create').click();
      });
      expect(global.transformPresets.custom?.name).toBe('Custom');
      render();

      act(() => {
        control('rename').click();
      });
      expect(global.transformPresets.renamed?.name).toBe('Renamed');
      expect(global.transformPresets.custom).toBeUndefined();
    });

    test('deleting a user preset repoints every Module that selected it to a surviving key', () => {
      const { global } = setup(['custom', 'custom', 'minimal']);

      act(() => {
        control('delete').click();
      });

      expect(global.transformPresets.custom).toBeUndefined();
      expect(global.modules.map((m: any) => global.transformPresets[m.injection.transformPreset] !== undefined)).toEqual([true, true, true]);
      expect(global.modules[2].injection.transformPreset).toBe('minimal');
      expect(global.modules[1].injection.transformPreset).toBe('default');
    });

    test('built-in presets cannot be deleted but stay editable', () => {
      const { global } = setup(['minimal']);

      // The list writer re-adds a built-in even if the widget drops it.
      const props = presetSelectMock.mock.calls.at(-1)![0] as any;
      act(() => {
        props.onItemsChange([{ value: 'default', label: 'Default' }]);
      });
      expect(Object.keys(global.transformPresets)).toEqual(expect.arrayContaining(['default', 'minimal', 'toon']));
      expect(global.transformPresets.minimal.name).toBe('Minimal');

      const flags = document.querySelector('input[title="JavaScript regex flags (e.g. g, i, m)."]') as HTMLInputElement;
      act(() => {
        setTextControlValue(flags, 'x');
      });
      expect(global.transformPresets.minimal.flags).toBe('x');
    });

    test('renaming a user preset moves every Module that selected it to the new key', () => {
      const { global } = setup(['custom', 'custom', 'minimal']);

      act(() => {
        control('rename').click();
      });

      expect(global.transformPresets.renamed?.name).toBe('Renamed');
      expect(global.modules.map((m: any) => m.injection.transformPreset)).toEqual(['renamed', 'renamed', 'minimal']);
    });

    test('renaming a built-in keeps the built-in and follows the rename', () => {
      const { global } = setup(['minimal']);
      const props = presetSelectMock.mock.calls.at(-1)![0] as any;
      const items = props.items.map((i: any) => (i.value === 'minimal' ? { value: 'mine', label: 'Mine' } : i));

      act(() => {
        props.onItemsChange(items);
      });

      expect(global.transformPresets.minimal.name).toBe('Minimal');
      expect(global.transformPresets.mine.name).toBe('Mine');
      expect(global.modules[0].injection.transformPreset).toBe('mine');
    });

    test('shows how many Modules share the selected preset', () => {
      setup(['custom', 'custom', 'minimal']);
      expect(document.body.textContent).toContain('currently shared by 2 Modules');
    });

    test('does not claim sharing for a preset only one Module selects', () => {
      setup(['custom', 'minimal']);
      expect(document.body.textContent).not.toContain('currently shared by');
    });
  });

  test('edits the snapshot header on the Module draft', () => {
    const settings = { embedZTrackerSnapshotHeader: 'Tracker:', embedZTrackerSnapshotTransformPreset: 'default', embedZTrackerSnapshotTransformPresets: {}, modules: [] } as any;
    ({ root } = renderElement(
      React.createElement(EmbedSnapshotTransformSection, {
        settings,
        updateAndRefresh: (updater: (current: any) => void) => updater(settings),
        updateGlobal: jest.fn(),
      }),
    ));
    const headerInput = document.querySelector('input[title="Header line to prepend before the embedded zTracker snapshot in normal generations. Set empty to omit."]') as HTMLInputElement;
    act(() => {
      setTextControlValue(headerInput, 'Scene:');
    });
    expect(settings.embedZTrackerSnapshotHeader).toBe('Scene:');
  });

  test('toggles debug logging and writes diagnostics output from the diagnostics surface', async () => {
    const setDebugLogging = jest.fn();
    const setDiagnosticsText = jest.fn();
    const consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    fetchMock()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    ({ root } = renderElement(
      React.createElement(DiagnosticsSection, {
        settings: { modules: [], debugLogging: false } as any,
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

  test('sweeps schema dialect findings across every module and preset without modifying settings (openspec: add-schema-dialect-lint)', async () => {
    const setDebugLogging = jest.fn();
    const setDiagnosticsText = jest.fn();
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    fetchMock().mockResolvedValueOnce({ ok: true, status: 200 }).mockResolvedValueOnce({ ok: true, status: 200 });

    const moduleWithMultiplePresets = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    moduleWithMultiplePresets.schema.presets = {
      default: moduleWithMultiplePresets.schema.presets.default,
      custom: {
        name: 'Custom',
        // Array with no item definition - triggers the error-level dialect rule.
        value: { type: 'object', description: 'x', properties: { tags: { type: 'array' } }, required: ['tags'] },
        html: '<div></div>',
      },
    };
    const cleanModule = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 1 });

    const settings = { modules: [moduleWithMultiplePresets, cleanModule], debugLogging: false } as any;
    const settingsSnapshot = JSON.parse(JSON.stringify(settings));

    ({ root } = renderElement(
      React.createElement(DiagnosticsSection, { settings, debugLogging: false, setDebugLogging, diagnosticsText: '', setDiagnosticsText }),
    ));

    const runButton = document.querySelector('button[title="Run diagnostics"]');
    if (!(runButton instanceof HTMLButtonElement)) {
      throw new Error('Diagnostics run button not found');
    }

    await act(async () => {
      runButton.click();
      await Promise.resolve();
    });

    const report = (setDiagnosticsText as jest.Mock).mock.calls.at(-1)?.[0] as string;
    expect(report).toContain('Schema dialect findings:');
    expect(report).toContain('module: Scene (scene), preset: Custom (custom)');
    expect(report).toContain('[error]');
    expect(report).toContain('tags');
    // The clean module/preset combination contributes no lines of its own (only presets that
    // actually carry findings are attributed) and settings are left untouched by the sweep.
    expect(report).not.toContain('module: Agenda');
    expect(settings).toEqual(settingsSnapshot);
  });

  test('lists the self entry with an editable count and no delete control', () => {
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    scene.generation.includeModules = [{ target: 'self', count: 2 }];
    const settings = { modules: [scene], includeModules: scene.generation.includeModules } as any;
    const updateAndRefresh = (updater: (current: any) => void) => updater(settings);

    ({ root } = renderElement(
      React.createElement(IncludeModulesSection, { settings, selectedModule: scene, updateAndRefresh }),
    ));

    const rows = document.querySelectorAll('.ztracker-include-module-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('.ztracker-include-module-name')?.textContent).toBe('Self (this module)');
    expect(rows[0].querySelector('button')).toBeNull();

    const countInput = rows[0].querySelector('input[type="number"]');
    if (!(countInput instanceof HTMLInputElement)) {
      throw new Error('Self entry count input not found');
    }
    expect(countInput.value).toBe('2');
  });

  test('offers only enabled, strictly-earlier-order modules in the add picker and adds a chained entry', () => {
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    const disabledEarlier = createDefaultTrackerModule({ id: 'disabled-earlier', name: 'Disabled Earlier', order: 1 });
    disabledEarlier.enabled = false;
    const agenda = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 2 });
    agenda.generation.includeModules = [{ target: 'self', count: 1 }];
    const laterModule = createDefaultTrackerModule({ id: 'later', name: 'Later', order: 3 });
    const settings = {
      modules: [scene, disabledEarlier, agenda, laterModule],
      includeModules: agenda.generation.includeModules,
    } as any;
    const updateAndRefresh = (updater: (current: any) => void) => updater(settings);

    ({ root } = renderElement(
      React.createElement(IncludeModulesSection, { settings, selectedModule: agenda, updateAndRefresh }),
    ));

    const picker = document.querySelector('.ztracker-include-modules-body select');
    if (!(picker instanceof HTMLSelectElement)) {
      throw new Error('Add chained module picker not found');
    }
    const optionValues = Array.from(picker.options).map((option) => option.value);
    expect(optionValues).toEqual(['', 'scene']);

    act(() => {
      setSelectValue(picker, 'scene');
    });

    expect(agenda.generation.includeModules).toEqual([
      { target: 'self', count: 1 },
      { target: 'scene', count: 1 },
    ]);

    act(() => {
      root?.render(React.createElement(IncludeModulesSection, { settings, selectedModule: agenda, updateAndRefresh }));
    });

    const rows = document.querySelectorAll('.ztracker-include-module-row');
    expect(rows).toHaveLength(2);
    expect(rows[1].querySelector('.ztracker-include-module-name')?.textContent).toBe('Scene');
    expect(rows[1].querySelector('button')).not.toBeNull();
  });

  test('renders without throwing when a Module has a malformed (missing/non-array) include list', () => {
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    const agenda = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 1 });
    (agenda.generation as any).includeModules = undefined;
    const settings = { modules: [scene, agenda], includeModules: agenda.generation.includeModules } as any;
    const updateAndRefresh = (updater: (current: any) => void) => updater(settings);

    expect(() => {
      ({ root } = renderElement(
        React.createElement(IncludeModulesSection, { settings, selectedModule: agenda, updateAndRefresh }),
      ));
    }).not.toThrow();

    // resolveTrackerModuleIncludeEntries defaults a missing list to [], so no rows render, but
    // the section itself (and its add-chained-module picker) still renders safely.
    expect(document.querySelectorAll('.ztracker-include-module-row')).toHaveLength(0);
    expect(document.querySelector('.ztracker-include-modules-body select')).not.toBeNull();
  });

  test('flags a dormant chained entry without altering its stored count', () => {
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    scene.enabled = false;
    const agenda = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 1 });
    agenda.generation.includeModules = [
      { target: 'self', count: 1 },
      { target: 'scene', count: 5 },
    ];
    const settings = { modules: [scene, agenda], includeModules: agenda.generation.includeModules } as any;
    const updateAndRefresh = (updater: (current: any) => void) => updater(settings);

    ({ root } = renderElement(
      React.createElement(IncludeModulesSection, { settings, selectedModule: agenda, updateAndRefresh }),
    ));

    const dormantRow = document.querySelector('.ztracker-include-module-row.is-dormant');
    if (!dormantRow) {
      throw new Error('Dormant row not found');
    }
    expect(dormantRow.querySelector('.ztracker-include-module-dormant-flag')).not.toBeNull();
    const countInput = dormantRow.querySelector('input[type="number"]');
    expect(countInput instanceof HTMLInputElement && countInput.value).toBe('5');
    expect(agenda.generation.includeModules[1]).toEqual({ target: 'scene', count: 5 });
  });

  test('removes a chained entry via its Remove button', () => {
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    const agenda = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 1 });
    agenda.generation.includeModules = [
      { target: 'self', count: 1 },
      { target: 'scene', count: 2 },
    ];
    const settings = { modules: [scene, agenda], includeModules: agenda.generation.includeModules } as any;
    const updateAndRefresh = (updater: (current: any) => void) => updater(settings);

    ({ root } = renderElement(
      React.createElement(IncludeModulesSection, { settings, selectedModule: agenda, updateAndRefresh }),
    ));

    const removeButton = document.querySelector('.ztracker-include-module-row button');
    if (!(removeButton instanceof HTMLButtonElement)) {
      throw new Error('Remove button not found');
    }

    act(() => {
      removeButton.click();
    });

    expect(agenda.generation.includeModules).toEqual([{ target: 'self', count: 1 }]);
  });
});