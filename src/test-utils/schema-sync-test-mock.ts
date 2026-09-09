/**
 * Test-only mirror of the real shouldSyncSchemaTextFromSettings / shouldSyncSchemaHtmlFromSettings
 * logic (src/components/settings/schema-editor-state.ts). settings-ui.test.ts mocks that whole
 * module and needs a real implementation for these two functions so Settings.tsx's Module/preset
 * switch resync effect is exercised for real; neither jest.importActual nor
 * jest.unstable_importActual exists under this project's babel-jest + --experimental-vm-modules
 * setup, and a plain dynamic import() of the mocked module from within its own mock factory
 * self-recurses (observed: JS heap exhaustion), so the formula is duplicated here instead.
 *
 * schema-editor-state.test.ts cross-checks this mirror against the real functions for a set of
 * representative inputs, so a future change to the real resync formula fails a test here instead
 * of silently drifting out of sync with what settings-ui.test.ts exercises.
 */
export function shouldSyncSchemaDraftFromSettings(options: {
  currentText: string;
  persistedText: string;
  activeSelectionChanged: boolean;
}): boolean {
  return options.activeSelectionChanged || options.currentText === options.persistedText;
}
