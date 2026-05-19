/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

const presetSelectMock = jest.fn(
  ({ label, items, value, onChange }: { label: string; items: Array<{ value: string; label: string }>; value?: string; onChange?: (value?: string) => void }) =>
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

const selectMock = jest.fn(
  ({ children, value, onChange, title }: { children?: React.ReactNode; value?: string; onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void; title?: string }) =>
    React.createElement('select', { 'data-testid': 'current-chat-schema-select', value: value ?? '', onChange, title }, children),
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
  STPresetSelect: presetSelectMock,
  STSelect: selectMock,
  STTextarea: textareaMock,
  PresetItem: class PresetItemMock {},
}));

const { SchemaPresetSection } = await import('../components/settings/SchemaPresetSection.js');

describe('SchemaPresetSection', () => {
  let root: Root | undefined;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="root"></div>';
    presetSelectMock.mockClear();
    selectMock.mockClear();
    buttonMock.mockClear();
    textareaMock.mockClear();
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

    const saveJsonButton = container.querySelector('button[title="Save JSON schema"]');
    const saveHtmlButton = container.querySelector('button[title="Save schema HTML"]');

    expect(saveJsonButton).toHaveProperty('disabled', true);
    expect(saveHtmlButton).toHaveProperty('disabled', true);
  });
});