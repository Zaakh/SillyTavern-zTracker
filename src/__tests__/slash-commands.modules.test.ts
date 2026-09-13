/**
 * @jest-environment jsdom
 */

import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const stEchoMock = jest.fn();

jest.unstable_mockModule('sillytavern-utils-lib/config', () => ({
  st_echo: stEchoMock,
}));

jest.unstable_mockModule('sillytavern-utils-lib/types/translate', () => ({
  AutoModeOptions: { NONE: 'none', RESPONSES: 'responses', BOTH: 'both', INPUT: 'input' },
}));

const { initializeSlashCommands } = await import('../ui/slash-commands.js');
const {
  createSlashCommandHarness,
  makeSlashCommandModule,
  makeSlashCommandSettings,
  makeSlashCommandSettingsManager,
} = await import('../test-utils/slash-command-test-helpers.js');

/** Boots zTracker's commands against a fresh fake host and returns the modules command. */
function bootModulesCommand(options: { modules?: any[] } = {}) {
  const harness = createSlashCommandHarness({ chat: [{}] });
  const settings = makeSlashCommandSettings(options.modules ?? []);
  const actions = {
    generateTracker: jest.fn(async () => true),
    generateTrackersForMessage: jest.fn(async () => true),
    deleteTracker: jest.fn(async () => true),
  };

  initializeSlashCommands({
    globalContext: harness.context,
    settingsManager: makeSlashCommandSettingsManager(settings),
    actions: actions as any,
  });

  const command = harness.commands.get('ztracker-modules');
  if (!command) {
    throw new Error('ztracker-modules was not registered');
  }

  return { ...harness, actions, command };
}

/** Three Modules: two enabled plus one disabled, deliberately out of order in the array. */
function threeModules() {
  return [
    makeSlashCommandModule({ id: 'plot-log', name: 'Plot Log', order: 2 }),
    makeSlashCommandModule({ id: 'scene-tracker', name: 'Scene Tracker', order: 1 }),
    makeSlashCommandModule({ id: 'plot-steer', name: 'Plot Steer', enabled: false, order: 3 }),
  ];
}

describe('ztracker-modules slash command', () => {
  beforeEach(() => {
    stEchoMock.mockClear();
  });

  test('registers the command with its alias, return contract, and arguments', () => {
    const { commands, context, command } = bootModulesCommand({ modules: threeModules() });

    expect(context.SlashCommandParser.addCommandObject).toHaveBeenCalledTimes(4);
    expect(commands.get('ztracker-list')).toBe(command);
    expect(command.returns).toBe('comma-separated Module ids, or comma-separated Module names with names=true');
    expect(command.unnamedArgumentList).toEqual([]);
    expect(command.namedArgumentList?.map((argument: any) => argument.name)).toEqual(['names', 'silent']);
  });

  test('lists every Module in Module order, including disabled ones, and returns their ids', () => {
    const { command } = bootModulesCommand({ modules: threeModules() });

    expect(command.callback({}, '')).toBe('scene-tracker, plot-log, plot-steer');
    expect(stEchoMock).toHaveBeenCalledWith(
      'info',
      'zTracker: 3 Modules: Scene Tracker (scene-tracker) · Plot Log (plot-log) · Plot Steer (plot-steer) - disabled',
    );
  });

  test('returns Module names with names=true', () => {
    const { command } = bootModulesCommand({ modules: threeModules() });

    expect(command.callback({ names: 'true' }, '')).toBe('Scene Tracker, Plot Log, Plot Steer');
    expect(stEchoMock).toHaveBeenCalledWith('info', expect.stringContaining('Plot Steer (plot-steer) - disabled'));
  });

  test('stays quiet with silent=true while still returning the list', () => {
    const { command } = bootModulesCommand({ modules: threeModules() });

    expect(command.callback({ silent: 'true' }, '')).toBe('scene-tracker, plot-log, plot-steer');
    expect(stEchoMock).not.toHaveBeenCalled();
  });

  test('lists the Module zTracker falls back to when none is configured', () => {
    const { command } = bootModulesCommand({ modules: [] });

    expect(command.callback({}, '')).toBe('default');
    expect(stEchoMock).toHaveBeenCalledWith('info', 'zTracker: 1 Module: Scene Tracker (default)');
  });

  test('uses the Module id as the label when a Module has no name', () => {
    const { command } = bootModulesCommand({
      modules: [makeSlashCommandModule({ id: 'scene-tracker', name: '   ', order: 1 })],
    });

    expect(command.callback({}, '')).toBe('scene-tracker');
    expect(stEchoMock).toHaveBeenCalledWith('info', 'zTracker: 1 Module: scene-tracker (scene-tracker)');
  });
});
