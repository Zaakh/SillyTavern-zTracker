/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

const selectMock = jest.fn(
  ({ children, value, onChange, title }: { children?: React.ReactNode; value?: string; onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void; title?: string }) =>
    React.createElement('select', { 'data-testid': title?.includes('modifying') ? 'default-schema-select' : 'current-chat-schema-select', value: value ?? '', onChange, title }, children),
);

const buttonMock = jest.fn(
  ({ title, disabled, onClick }: { title?: string; disabled?: boolean; onClick?: () => void }) =>
    React.createElement('button', { type: 'button', title, disabled, onClick }),
);

const textareaMock = jest.fn(
  ({ value, onChange, className, placeholder }: { value?: string; onChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void; className?: string; placeholder?: string }) =>
    React.createElement('textarea', { value: value ?? '', onChange, className, placeholder }),
);

jest.unstable_mockModule('sillytavern-utils-lib/components/react', () => ({
  STButton: buttonMock,
  STSelect: selectMock,
  STTextarea: textareaMock,
  PresetItem: class PresetItemMock {},
}));

const stEchoMock = jest.fn();

jest.unstable_mockModule('sillytavern-utils-lib/config', () => ({
  st_echo: stEchoMock,
}));

const { SchemaPresetSection } = await import('../components/settings/SchemaPresetSection.js');

describe('SchemaPresetSection', () => {
  let root: Root | undefined;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="root"></div>';
    selectMock.mockClear();
    buttonMock.mockClear();
    textareaMock.mockClear();
    stEchoMock.mockClear();
    (globalThis as any).SillyTavern = {
      getContext: () => ({
        Popup: {
          show: {
            input: jest.fn(),
            confirm: jest.fn(),
          },
        },
      }),
    };
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
  });

  function renderSection(overrides: Record<string, unknown> = {}) {
    const container = document.getElementById('root');
    if (!container) {
      throw new Error('Missing root container');
    }

    root = createRoot(container);
    act(() => {
      root?.render(
        React.createElement(SchemaPresetSection, {
          schemaPresetKey: 'default',
          schemaPresetItems: [
            { value: 'default', label: 'Default' },
            { value: 'alternate', label: 'Alternate' },
          ],
          currentChatSchemaPresetKey: 'default',
          currentChatSchemaPresetLabel: 'Default',
          currentChatSchemaPresetUsesDefault: true,
          currentChatSchemaPresetAvailable: true,
          currentChatSchemaPresetHasStoredValue: false,
          currentChatSchemaPresetHasValidStoredValue: false,
          handleSchemaPresetChange: jest.fn(),
          handleSchemaPresetRename: jest.fn(),
          handleCurrentChatSchemaPresetChange: jest.fn(),
          handleSchemaPresetsListChange: jest.fn(),
          schemaText: '{\n  "type": "object"\n}',
          schemaTextHasError: false,
          schemaTextHasUnsavedChanges: true,
          schemaTextCanSave: true,
          schemaHtmlText: '<div>{{data.scene}}</div>',
          schemaHtmlTextHasError: false,
          schemaHtmlTextHasUnsavedChanges: true,
          schemaHtmlTextCanSave: true,
          handleSchemaValueChange: jest.fn(),
          handleSchemaHtmlChange: jest.fn(),
          saveSchemaValue: jest.fn(),
          saveSchemaHtmlValue: jest.fn(),
          restoreSchemaToDefault: jest.fn(async () => undefined),
          ...overrides,
        }),
      );
    });
    return container;
  }

  test('shows preset pair validation errors and disables both save buttons', () => {
    const container = renderSection({
      schemaTextCanSave: false,
      schemaHtmlTextCanSave: false,
      schemaPresetPairError: 'Schema JSON and HTML must stay coupled for both full and minimal tracker data.',
    });

    expect(container.textContent).toContain('Schema JSON and HTML must stay coupled for both full and minimal tracker data.');

    const saveButtons = container.querySelectorAll('button[title="Save the current schema preset pair (JSON and HTML)"]');
    const [saveJsonButton, saveHtmlButton] = Array.from(saveButtons);

    expect(saveJsonButton).toHaveProperty('disabled', true);
    expect(saveHtmlButton).toHaveProperty('disabled', true);
  });

  test('shows an explicit global preset selector next to the schema editors', () => {
    const container = renderSection();

    const defaultSchemaSelect = container.querySelector('[data-testid="default-schema-select"]');
    expect(defaultSchemaSelect).not.toBeNull();
    expect(container.querySelector('button[title="Create a new schema preset"]')).not.toBeNull();
    expect(container.querySelector('button[title="Rename selected schema preset"]')).not.toBeNull();
    expect(container.querySelector('button[title="Delete selected schema preset"]')).not.toBeNull();
  });

  test('disables rename and delete for the read-only default preset', () => {
    const container = renderSection({ schemaPresetKey: 'default' });

    const renameButton = container.querySelector('button[title="Rename selected schema preset"]');
    const deleteButton = container.querySelector('button[title="Delete selected schema preset"]');

    expect(renameButton).toHaveProperty('disabled', true);
    expect(deleteButton).toHaveProperty('disabled', true);
  });
});