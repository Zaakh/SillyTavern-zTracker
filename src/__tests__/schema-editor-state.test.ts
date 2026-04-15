/**
 * @jest-environment node
 */

import {
  formatSchemaText,
  hasUnsavedInvalidSchemaDraft,
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
});