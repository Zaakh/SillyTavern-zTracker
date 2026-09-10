/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import { defaultSettings, getOrderedTrackerModules, getTrackerModule, ExtensionSettings } from '../config.js';
import { DEFAULT_MODULE_ID } from '../extension-metadata.js';

// sillytavern-utils-lib/config's real st_echo pulls in a browser-only SillyTavern module chain
// that isn't resolvable under Jest (see settings-ui.test.ts for the same pattern) - mock it so
// fresh-install-seeding.ts's default `st_echo` import doesn't break module resolution. Individual
// tests still pass their own `stEcho` stub to assert on warning-toast behavior.
jest.unstable_mockModule('sillytavern-utils-lib/config', () => ({
  st_echo: jest.fn(async () => undefined),
}));

const { seedStarterTrackerModules } = await import('../fresh-install-seeding.js');

function makeStarterTemplate(id: string, name: string, includeModules?: Array<{ target: string; count: number }>) {
  return {
    version: 1,
    module: {
      id,
      name,
      enabled: true,
      order: 0,
      systemPrompt: { mode: 'saved', savedName: `zTracker-${id}-1.0`, content: `${name} system prompt content` },
      ...(includeModules ? { generation: { includeModules } } : {}),
    },
  };
}

/** Builds a fetchImpl that serves the given templates by name and 404s for any other. */
function makeFetchImpl(templates: Record<string, unknown>) {
  return jest.fn(async (url: unknown) => {
    const href = String(url);
    const matchedName = Object.keys(templates).find((name) => href.includes(`${name}.json`));
    if (!matchedName) {
      return { ok: false, status: 404, text: async () => '' } as Response;
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(templates[matchedName]) } as Response;
  }) as unknown as typeof fetch;
}

function makeSettingsManager(initial: ExtensionSettings) {
  const saveSettings = jest.fn();
  return { getSettings: () => initial, saveSettings };
}

describe('seedStarterTrackerModules', () => {
  let extensionSettingsRecord: Record<string, unknown>;
  // jsdom's jest environment doesn't expose structuredClone by default; mirror the polyfill used
  // by other jsdom-environment suites in this repo (see tracker-actions.*.test.ts).
  const originalStructuredClone = globalThis.structuredClone;

  beforeAll(() => {
    globalThis.structuredClone = originalStructuredClone ?? ((value: unknown) => JSON.parse(JSON.stringify(value)));
  });

  afterAll(() => {
    globalThis.structuredClone = originalStructuredClone;
  });

  beforeEach(() => {
    extensionSettingsRecord = { zTracker: defaultSettings };
    (globalThis as any).SillyTavern = {
      getContext: () => ({
        getPresetManager: () => ({
          getCompletionPresetByName: () => undefined,
          getPresetList: () => ({ presets: [], preset_names: [] }),
          savePreset: jest.fn(async () => undefined),
        }),
      }),
    };
  });

  test('seeds all three templates with correct ids, order, and enabled flags, without a warning toast', async () => {
    const settingsManager = makeSettingsManager(structuredClone(defaultSettings));
    const fetchImpl = makeFetchImpl({
      'scene-tracker': makeStarterTemplate('scene-tracker', 'Scene Tracker'),
      'plot-log': makeStarterTemplate('plot-log', 'Plot Log'),
      'plot-steer': makeStarterTemplate('plot-steer', 'Plot Steer', [
        { target: 'self', count: 1 },
        { target: 'plot-log', count: 3 },
      ]),
    });
    const stEcho = jest.fn(async () => undefined);

    const seeded = await seedStarterTrackerModules({
      settingsManager,
      importMetaUrl: 'file:///dist/index.js',
      context: { extensionSettings: extensionSettingsRecord },
      fetchImpl,
      stEcho,
    });

    expect(seeded.map((module) => module.id)).toEqual(['scene-tracker', 'plot-log', 'plot-steer']);
    expect(seeded.map((module) => module.order)).toEqual([0, 1, 2]);
    expect(seeded.map((module) => module.enabled)).toEqual([true, false, false]);
    expect(settingsManager.getSettings().modules).toBe(seeded);
    expect(settingsManager.saveSettings).toHaveBeenCalledTimes(1);
    // A fully-successful seed is not degraded, so it must stay silent - no toast noise on the happy path.
    expect(stEcho).not.toHaveBeenCalled();
  });

  test('one template failing to fetch still seeds the other two, and shows a partial-failure warning', async () => {
    const settingsManager = makeSettingsManager(structuredClone(defaultSettings));
    // plot-log deliberately missing from the served templates, simulating a 404.
    const fetchImpl = makeFetchImpl({
      'scene-tracker': makeStarterTemplate('scene-tracker', 'Scene Tracker'),
      'plot-steer': makeStarterTemplate('plot-steer', 'Plot Steer'),
    });
    const stEcho = jest.fn(async () => undefined);

    const seeded = await seedStarterTrackerModules({
      settingsManager,
      importMetaUrl: 'file:///dist/index.js',
      context: { extensionSettings: extensionSettingsRecord },
      fetchImpl,
      stEcho,
    });

    expect(seeded.map((module) => module.id)).toEqual(['scene-tracker', 'plot-steer']);
    // order is reassigned from the templates that actually succeeded, so plot-steer becomes order 1.
    expect(seeded.map((module) => module.order)).toEqual([0, 1]);
    expect(stEcho).toHaveBeenCalledTimes(1);
    expect(stEcho).toHaveBeenCalledWith('warning', expect.stringContaining('could not set up all'));
  });

  test('every template failing leaves settings.modules empty, shows a full-failure warning, and a subsequent read still recovers a Module', async () => {
    const settingsManager = makeSettingsManager(structuredClone(defaultSettings));
    const fetchImpl = makeFetchImpl({});
    const stEcho = jest.fn(async () => undefined);

    const seeded = await seedStarterTrackerModules({
      settingsManager,
      importMetaUrl: 'file:///dist/index.js',
      context: { extensionSettings: extensionSettingsRecord },
      fetchImpl,
      stEcho,
    });

    expect(seeded).toEqual([]);
    expect(settingsManager.getSettings().modules).toEqual([]);
    expect(stEcho).toHaveBeenCalledTimes(1);
    expect(stEcho).toHaveBeenCalledWith('warning', expect.stringContaining('could not automatically set up'));

    // The existing read-time recovery fallback still produces a Module under the legacy id.
    const recovered = getTrackerModule(settingsManager.getSettings());
    expect(recovered.id).toBe(DEFAULT_MODULE_ID);
    expect(getOrderedTrackerModules(settingsManager.getSettings())).toHaveLength(1);
  });

  test('never mutates the shared defaultSettings constant', async () => {
    const settingsManager = makeSettingsManager(structuredClone(defaultSettings));
    const fetchImpl = makeFetchImpl({
      'scene-tracker': makeStarterTemplate('scene-tracker', 'Scene Tracker'),
    });
    // Only one of three templates is served here (a partial failure), which now triggers a
    // warning toast - pass a stub so this test doesn't depend on the real st_echo's behavior.
    const stEcho = jest.fn(async () => undefined);

    await seedStarterTrackerModules({
      settingsManager,
      importMetaUrl: 'file:///dist/index.js',
      context: { extensionSettings: extensionSettingsRecord },
      fetchImpl,
      stEcho,
    });

    expect(defaultSettings.modules).toEqual([]);
    expect(extensionSettingsRecord.zTracker).not.toBe(defaultSettings);
  });
});
