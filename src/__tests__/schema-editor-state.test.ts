/**
 * @jest-environment node
 */

import {
  formatSchemaHtml,
  formatSchemaText,
  getSchemaDraftState,
  getSchemaHtmlDraftState,
  shouldSyncSchemaHtmlFromSettings,
  shouldSyncSchemaTextFromSettings,
  validateSchemaDraft,
  validateSchemaHtmlDraft,
} from '../components/settings/schema-editor-state.js';

describe('schema-editor-state helpers', () => {
  test('reports JSON validation errors for invalid schema drafts', () => {
    expect(validateSchemaDraft('{"scene":')).toEqual(
      expect.objectContaining({
        isValid: false,
        errorMessage: expect.any(String),
      }),
    );
    expect(validateSchemaDraft('[1,2,3]')).toEqual({
      isValid: false,
      errorMessage: 'Schema JSON must be a top-level object.',
    });
    expect(validateSchemaDraft('{"scene":"kept"}')).toEqual({ isValid: true });
  });

  test('tracks dirty state for valid JSON drafts that differ from persisted settings', () => {
    expect(
      getSchemaDraftState({
        currentText: '{"scene":"kept"}',
        persistedText: `{
  "scene": "kept"
}`,
      }),
    ).toEqual({
      isDirty: true,
      isValid: true,
      canSave: true,
    });
  });

  test('does not allow saving an unchanged valid JSON draft', () => {
    expect(
      getSchemaDraftState({
        currentText: `{
  "scene": "kept"
}`,
        persistedText: `{
  "scene": "kept"
}`,
      }),
    ).toEqual({
      isDirty: false,
      isValid: true,
      canSave: false,
    });
  });

  test('preserves a valid unsaved JSON draft while staying on the same schema preset', () => {
    expect(
      shouldSyncSchemaTextFromSettings({
        currentText: '{"scene":"kept"}',
        persistedText: `{
  "scene": "kept"
}`,
        activePresetChanged: false,
      }),
    ).toBe(false);
  });

  test('preserves an invalid JSON draft while staying on the same schema preset', () => {
    expect(
      shouldSyncSchemaTextFromSettings({
        currentText: '{"scene":',
        persistedText: `{
  "scene": "kept"
}`,
        activePresetChanged: false,
      }),
    ).toBe(false);
  });

  test('resyncs the editor when the active schema preset changes', () => {
    expect(
      shouldSyncSchemaTextFromSettings({
        currentText: '{"scene":',
        persistedText: `{
  "scene": "kept"
}`,
        activePresetChanged: true,
      }),
    ).toBe(true);
  });

  test('formats persisted schema values for the editor', () => {
    expect(
      formatSchemaText({
        name: 'Custom',
        value: { scene: 'kept' },
        html: '<div></div>',
      }),
    ).toBe(`{
  "scene": "kept"
}`);
  });

  test('reports Handlebars validation errors for invalid HTML drafts', () => {
    expect(validateSchemaHtmlDraft('{{#if data.scene}}')).toEqual(
      expect.objectContaining({
        isValid: false,
        errorMessage: expect.any(String),
      }),
    );
    expect(validateSchemaHtmlDraft('<div>{{data.scene}}</div>')).toEqual({ isValid: true });
  });

  test('tracks dirty state for valid HTML drafts that differ from persisted settings', () => {
    expect(
      getSchemaHtmlDraftState({
        currentText: '<div>{{ data.scene }}</div>',
        persistedText: '<div>{{data.scene}}</div>',
      }),
    ).toEqual({
      isDirty: true,
      isValid: true,
      canSave: true,
    });
  });

  test('does not allow saving an unchanged valid HTML draft', () => {
    expect(
      getSchemaHtmlDraftState({
        currentText: '<div>{{data.scene}}</div>',
        persistedText: '<div>{{data.scene}}</div>',
      }),
    ).toEqual({
      isDirty: false,
      isValid: true,
      canSave: false,
    });
  });

  test('preserves a valid unsaved HTML draft while staying on the same schema preset', () => {
    expect(
      shouldSyncSchemaHtmlFromSettings({
        currentText: '<div>{{ data.scene }}</div>',
        persistedText: '<div>{{data.scene}}</div>',
        activePresetChanged: false,
      }),
    ).toBe(false);
  });

  test('preserves an invalid HTML draft while staying on the same schema preset', () => {
    expect(
      shouldSyncSchemaHtmlFromSettings({
        currentText: '{{#if data.scene}}',
        persistedText: '<div>{{data.scene}}</div>',
        activePresetChanged: false,
      }),
    ).toBe(false);
  });

  test('resyncs the HTML editor when the active schema preset changes', () => {
    expect(
      shouldSyncSchemaHtmlFromSettings({
        currentText: '{{#if data.scene}}',
        persistedText: '<div>{{data.scene}}</div>',
        activePresetChanged: true,
      }),
    ).toBe(true);
  });

  test('formats persisted schema HTML for the editor', () => {
    expect(
      formatSchemaHtml({
        name: 'Custom',
        value: { scene: 'kept' },
        html: '<div>{{data.scene}}</div>',
      }),
    ).toBe('<div>{{data.scene}}</div>');
  });
});