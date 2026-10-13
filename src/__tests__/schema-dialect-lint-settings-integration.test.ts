/**
 * @jest-environment jsdom
 */

/**
 * Exercises the REAL `Settings.tsx` -> `TrackerGenerationSection.tsx` -> `SchemaPresetSection.tsx`
 * -> `schema-editor-state.ts` -> `schema-dialect-lint.ts` wiring end to end (openspec:
 * add-schema-dialect-lint task 4.5). Unlike `settings-ui.test.ts`, this suite does NOT mock
 * `schema-editor-state.js`/`TrackerGenerationSection.js`/`SchemaPresetSection.js`, so the actual
 * dialect lint runs against real component state - covering the spec scenario "a pre-existing
 * error still blocks an unrelated JSON edit" and "restoring the default clears a blocking error".
 */
import { jest } from '@jest/globals';
import Handlebars from 'handlebars';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

// `join` is only registered globally in src/index.tsx (not imported in tests); the DEFAULT_SCHEMA_HTML
// template used by "Restore Default" needs it, matching the convention in generate-schema-html.test.ts.
if (!Handlebars.helpers['join']) {
  Handlebars.registerHelper('join', function (array: unknown, separator: unknown) {
    return Array.isArray(array) ? array.join(typeof separator === 'string' ? separator : ', ') : '';
  });
}

const buttonMock = jest.fn(
  ({ title, disabled, onClick, className }: { title?: string; disabled?: boolean; onClick?: () => void; className?: string }) =>
    React.createElement('button', { type: 'button', title, disabled, onClick, className }),
);
const selectMock = jest.fn(
  ({ children, value, onChange, title }: { children?: React.ReactNode; value?: string; onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void; title?: string }) =>
    React.createElement('select', { value: value ?? '', onChange, title }, children),
);
const textareaMock = jest.fn(
  ({ value, onChange, className }: { value?: string; onChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void; className?: string }) =>
    React.createElement('textarea', { value: value ?? '', onChange, className }),
);
const presetSelectMock = jest.fn(() => React.createElement('div', null));
const connectionProfileSelectMock = jest.fn(() => React.createElement('div', null));

jest.unstable_mockModule('sillytavern-utils-lib/components/react', () => ({
  STButton: buttonMock,
  STSelect: selectMock,
  STTextarea: textareaMock,
  STPresetSelect: presetSelectMock,
  STConnectionProfileSelect: connectionProfileSelectMock,
  PresetItem: class PresetItemMock {},
}));

jest.unstable_mockModule('sillytavern-utils-lib/config', () => ({
  st_echo: jest.fn(),
}));

jest.unstable_mockModule('sillytavern-utils-lib', () => ({
  ExtensionSettingsManager: class {
    getSettings() {
      return mockSettings;
    }
    saveSettings() {
      // no-op: assertions read the same mutable mockSettings object directly.
    }
  },
  getWorldInfos: jest.fn(async () => ({})),
}));

jest.unstable_mockModule('../file-picker.js', () => ({
  readTextFileViaPicker: jest.fn(async () => null),
}));

jest.unstable_mockModule('../system-prompt.js', () => ({
  getCurrentGlobalSystemPromptName: () => undefined,
  hasSystemPromptPreset: () => false,
  listSystemPromptPresetNames: () => [],
  shouldWarnAboutSharedSystemPromptSelection: () => false,
  ensureModuleSystemPromptPresetInstalled: jest.fn(async () => false),
  checkModuleSystemPromptPresetExists: () => true,
}));

const { ZTrackerSettings } = await import('../components/Settings.js');

// A schema whose "tags" property is an array with no item definition - the dialect lint's
// error-level rule (an array node with no item definition, D1) - paired with HTML that renders
// fine regardless (tags always example-generates as `[]`), so only the dialect finding blocks
// the Schema JSON save action, not the JSON/HTML pair-render validation.
const ERRORING_SCHEMA_VALUE = {
  type: 'object',
  description: 'A tracker with a dialect error',
  properties: {
    name: { type: 'string', description: 'A name' },
    tags: { type: 'array' },
  },
  required: ['name'],
};
// Deliberately does not reference "data.tags" at all - avoids depending on the `join` Handlebars
// helper (only registered globally in src/index.tsx, not imported by tests) while still pairing
// validly against the schema, since a template does not need to reference every schema field.
const ERRORING_SCHEMA_HTML = '<div>{{data.name}}</div>';

let mockSettings: any;

function createMockSettings(schemaValue: object = ERRORING_SCHEMA_VALUE, schemaHtml: string = ERRORING_SCHEMA_HTML) {
  return {
    modules: [
      {
        id: 'default',
        name: 'Default',
        enabled: true,
        order: 0,
        auto: { enabled: false, direction: 'both' },
        schema: {
          preset: 'default',
          presets: {
            default: { name: 'Default', value: schemaValue, html: schemaHtml },
          },
        },
        prompts: {
          prompt: '',
          promptEngineeringMode: 'json',
          promptJson: '',
          promptXml: '',
          promptToon: '',
          grammarEnforcementEnabled: false,
        },
        systemPrompt: { mode: 'profile', savedName: '', content: '' },
        connection: { source: 'active', profileId: '' },
        generation: {
          mode: 'full',
          maxResponseToken: 512,
          skipFirstXMessages: 0,
          includeLastXMessages: 0,
          skipCharacterCardInTrackerGeneration: false,
          conversationRoleMode: 'preserve',
          worldInfoPolicyMode: 'include_all',
          worldInfoAllowlist: [],
          includeModules: [{ target: 'self', count: 1 }],
        },
        injection: {
          includeLastXMessages: 0,
          embedRole: 'user',
          embedAsCharacter: false,
          snapshotHeader: 'Tracker:',
          transformPreset: 'default',
          transformPresets: {
            default: { name: 'Default (JSON)', input: 'pretty_json', pattern: '', flags: 'g', replacement: '', codeFenceLang: 'json', wrapInCodeFence: true },
          },
        },
      },
    ],
    debugLogging: false,
  };
}

describe('Schema dialect lint wired into the real Settings UI (openspec: add-schema-dialect-lint)', () => {
  let root: Root | undefined;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    mockSettings = createMockSettings();
    document.body.innerHTML = '<div id="root"></div>';
    (globalThis as any).SillyTavern = {
      getContext: () => ({
        chatMetadata: undefined,
        chat: [],
        Popup: { show: { confirm: jest.fn(async () => true), input: jest.fn() } },
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
      root?.render(React.createElement(ZTrackerSettings, { testGrammarSchemaEnforcement: jest.fn(async () => ({ supported: true, message: '' })) }));
    });
    return container;
  }

  /** Updates one controlled textarea through the native DOM setter so React sees the change (matches settings-sections.test.ts's convention). */
  function setTextareaValue(element: HTMLTextAreaElement, value: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function getSchemaControls(container: HTMLElement) {
    // SchemaPresetSection renders exactly two `.ztracker-schema-textarea`s: JSON first, then HTML.
    const [schemaJsonTextarea, schemaHtmlTextarea] = Array.from(container.querySelectorAll('textarea.ztracker-schema-textarea'));
    const saveSchemaJsonButton = Array.from(container.querySelectorAll('button')).find((button) => button.title.startsWith('Save the current Schema JSON'));
    const saveSchemaHtmlButton = Array.from(container.querySelectorAll('button')).find((button) => button.title.startsWith('Save the current Schema HTML'));
    const restoreDefaultButton = Array.from(container.querySelectorAll('button')).find((button) => button.title === 'Restore default schema JSON and HTML');

    if (!(schemaJsonTextarea instanceof HTMLTextAreaElement) || !(schemaHtmlTextarea instanceof HTMLTextAreaElement)) {
      throw new Error('Schema textareas not found');
    }
    if (!saveSchemaJsonButton || !saveSchemaHtmlButton || !restoreDefaultButton) {
      throw new Error('Schema editor buttons not found');
    }
    return { schemaJsonTextarea, schemaHtmlTextarea, saveSchemaJsonButton, saveSchemaHtmlButton, restoreDefaultButton };
  }

  test('renaming a field in both editors can be saved in one step, even though neither side renders against the other\'s saved version', async () => {
    const cleanSchema = { type: 'object', description: 'x', properties: { mood: { type: 'string', description: 'x' } }, required: ['mood'] };
    mockSettings = createMockSettings(cleanSchema, '<div>{{data.mood}}</div>');
    const container = renderSettings();
    let controls = getSchemaControls(container);

    await act(async () => {
      setTextareaValue(controls.schemaJsonTextarea, JSON.stringify({ ...cleanSchema, properties: { feeling: { type: 'string', description: 'x' } }, required: ['feeling'] }, null, 2));
      setTextareaValue(controls.schemaHtmlTextarea, '<div>{{data.feeling}}</div>');
      await Promise.resolve();
    });

    controls = getSchemaControls(container);
    expect(controls.saveSchemaJsonButton.disabled).toBe(false);
    expect(controls.saveSchemaHtmlButton.disabled).toBe(false);

    await act(async () => {
      controls.saveSchemaHtmlButton.click();
      await Promise.resolve();
    });

    const preset = mockSettings.modules[0].schema.presets.default;
    expect(preset.html).toBe('<div>{{data.feeling}}</div>');
    expect(Object.keys(preset.value.properties)).toEqual(['feeling']);
  });

  test('a pre-existing dialect error blocks Schema JSON save but not an unrelated Schema HTML save, and Restore Default clears it', async () => {
    const container = renderSettings();

    let controls = getSchemaControls(container);
    expect(container.textContent).toContain('Cannot save Schema JSON:');
    expect(controls.saveSchemaJsonButton.disabled).toBe(true);

    // Make an unrelated (harmless) edit to the HTML draft - it doesn't touch the erroring "tags"
    // field, and must remain independently savable despite the JSON draft's dialect error (D11).
    await act(async () => {
      setTextareaValue(controls.schemaHtmlTextarea, `${ERRORING_SCHEMA_HTML}<!-- unrelated -->`);
      await Promise.resolve();
    });

    controls = getSchemaControls(container);
    expect(controls.saveSchemaHtmlButton.disabled).toBe(false);
    expect(controls.saveSchemaJsonButton.disabled).toBe(true);

    // Restore Default clears the persisted error-level finding entirely.
    await act(async () => {
      controls.restoreDefaultButton.click();
      await Promise.resolve();
    });

    controls = getSchemaControls(container);
    expect(container.textContent).not.toContain('Cannot save Schema JSON:');

    // The restored draft now matches the persisted default exactly (not dirty), so there is
    // nothing pending to save yet - a further trivial edit demonstrates the save action is
    // "usable" (no longer blocked by the old error) rather than perpetually disabled.
    await act(async () => {
      const restoredSchema = JSON.parse(controls.schemaJsonTextarea.value);
      setTextareaValue(controls.schemaJsonTextarea, JSON.stringify({ ...restoredSchema, description: 'Edited after restore' }, null, 2));
      await Promise.resolve();
    });

    controls = getSchemaControls(container);
    expect(controls.saveSchemaJsonButton.disabled).toBe(false);
  });
});
