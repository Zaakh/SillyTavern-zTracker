/**
 * @jest-environment node
 */

import {
  formatSchemaHtml,
  formatSchemaText,
  hasUnsavedInvalidSchemaHtmlDraft,
  hasUnsavedInvalidSchemaDraft,
  shouldSyncSchemaHtmlFromSettings,
  shouldSyncSchemaTextFromSettings,
} from '../components/settings/schema-editor-state.js';

describe('schema-editor-state helpers', () => {
  test('detects invalid schema drafts that have not been persisted yet', () => {
    expect(hasUnsavedInvalidSchemaDraft('{"scene":')).toBe(true);
    expect(hasUnsavedInvalidSchemaDraft('{"scene":"kept"}')).toBe(false);
  });

  test('preserves an invalid draft while staying on the same schema preset', () => {
    expect(
      shouldSyncSchemaTextFromSettings({
        currentText: '{"scene":',
        activePresetChanged: false,
      }),
    ).toBe(false);
  });

  test('resyncs the editor when the active schema preset changes', () => {
    expect(
      shouldSyncSchemaTextFromSettings({
        currentText: '{"scene":',
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

  test('detects invalid Handlebars HTML drafts that have not been persisted yet', () => {
    expect(hasUnsavedInvalidSchemaHtmlDraft('{{#if data.scene}}')).toBe(true);
    expect(hasUnsavedInvalidSchemaHtmlDraft('<div>{{data.scene}}</div>')).toBe(false);
  });

  test('preserves an invalid HTML draft while staying on the same schema preset', () => {
    expect(
      shouldSyncSchemaHtmlFromSettings({
        currentText: '{{#if data.scene}}',
        activePresetChanged: false,
      }),
    ).toBe(false);
  });

  test('resyncs the HTML editor when the active schema preset changes', () => {
    expect(
      shouldSyncSchemaHtmlFromSettings({
        currentText: '{{#if data.scene}}',
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