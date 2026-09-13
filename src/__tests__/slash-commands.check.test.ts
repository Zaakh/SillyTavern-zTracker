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
  makeLegacyTrackedMessage,
  makeSlashCommandModule,
  makeSlashCommandSettings,
  makeSlashCommandSettingsManager,
  makeTrackedMessage,
} = await import('../test-utils/slash-command-test-helpers.js');

/** Boots zTracker's commands against a fresh fake host and returns the check command. */
function bootCheckCommand(options: { chat?: unknown[]; modules?: any[] } = {}) {
  const harness = createSlashCommandHarness({ chat: options.chat ?? [] });
  const settings = makeSlashCommandSettings(options.modules ?? [makeSlashCommandModule({ id: 'scene-tracker', name: 'Scene Tracker' })]);
  const actions = { generateTracker: jest.fn(), generateTrackersForMessage: jest.fn() };

  initializeSlashCommands({
    globalContext: harness.context,
    settingsManager: makeSlashCommandSettingsManager(settings),
    actions: actions as any,
  });

  const command = harness.commands.get('ztracker-check');
  if (!command) {
    throw new Error('ztracker-check was not registered');
  }

  return { ...harness, actions, command };
}

describe('ztracker-check slash command', () => {
  beforeEach(() => {
    stEchoMock.mockClear();
  });

  test('registers the command with its alias, return contract, and Module autocomplete', () => {
    const { commands, context, command } = bootCheckCommand();

    expect(context.SlashCommandParser.addCommandObject).toHaveBeenCalledTimes(4);
    expect(commands.get('ztracker-status')).toBe(command);
    expect(command.returns).toBe('true when a tracker is stored for the message, false otherwise');
    expect(command.unnamedArgumentList?.[0]).toEqual({ description: expect.any(String), typeList: ['number'] });

    const moduleArgument = command.namedArgumentList?.[0] as any;
    expect(moduleArgument.name).toBe('module');
    expect(moduleArgument.enumProvider().map((option: any) => option.value)).toEqual(['scene-tracker']);
    expect(command.namedArgumentList?.[1]).toEqual(
      expect.objectContaining({ name: 'silent', typeList: ['bool'], defaultValue: 'false' }),
    );
  });

  test('reports true when the last message has a tracker for an enabled Module', async () => {
    const chat = [{ extra: {} }, makeTrackedMessage('scene-tracker', { time: '09:00' })];
    const { command } = bootCheckCommand({ chat });

    expect(await command.callback({}, '')).toBe('true');
    expect(stEchoMock).toHaveBeenCalledWith('info', 'zTracker: message #1 has a tracker for Scene Tracker.');
  });

  test('reports false with an info toast when the message has no tracker', async () => {
    const { command } = bootCheckCommand({ chat: [{ extra: {} }] });

    expect(await command.callback({}, undefined)).toBe('false');
    expect(stEchoMock).toHaveBeenCalledWith('info', 'zTracker: no tracker is stored on message #0.');
  });

  test('defaults to the last message and validates an explicit message index', async () => {
    const chat = [makeTrackedMessage('scene-tracker', { time: '09:00' }), { extra: {} }];
    const { command } = bootCheckCommand({ chat });

    expect(await command.callback({}, '0')).toBe('true');
    expect(await command.callback({}, '')).toBe('false');
    expect(await command.callback({}, '2')).toBe('false');
    expect(stEchoMock).toHaveBeenCalledWith('error', 'zTracker: message index must be a whole number between 0 and 1.');
  });

  test('narrows the check to one Module with module=<id>', async () => {
    const chat = [makeTrackedMessage('agenda', { items: [] })];
    const modules = [
      makeSlashCommandModule({ id: 'scene-tracker', name: 'Scene Tracker', order: 0 }),
      makeSlashCommandModule({ id: 'agenda', name: 'Agenda', order: 1 }),
    ];
    const { command } = bootCheckCommand({ chat, modules });

    expect(await command.callback({ module: 'agenda' }, '')).toBe('true');
    expect(stEchoMock).toHaveBeenCalledWith('info', 'zTracker: message #0 has a tracker for Agenda.');

    expect(await command.callback({ module: 'scene-tracker' }, '')).toBe('false');
    expect(stEchoMock).toHaveBeenLastCalledWith('info', 'zTracker: no tracker is stored on message #0.');
  });

  test('skips disabled Modules by default but honors an explicit disabled Module id', async () => {
    const chat = [makeTrackedMessage('agenda', { items: [] })];
    const modules = [
      makeSlashCommandModule({ id: 'scene-tracker', name: 'Scene Tracker', enabled: true, order: 0 }),
      makeSlashCommandModule({ id: 'agenda', name: 'Agenda', enabled: false, order: 1 }),
    ];
    const { command } = bootCheckCommand({ chat, modules });

    expect(await command.callback({}, '')).toBe('false');
    expect(await command.callback({ module: 'agenda' }, '')).toBe('true');
  });

  test('counts legacy pre-Modules tracker data as stored', async () => {
    const chat = [makeLegacyTrackedMessage({ time: '09:00' })];
    const { command } = bootCheckCommand({ chat, modules: [makeSlashCommandModule({ id: 'default', name: 'Default' })] });

    expect(await command.callback({}, '')).toBe('true');
  });

  test('reports an error and false for an unknown Module id', async () => {
    const { command } = bootCheckCommand({ chat: [{ extra: {} }] });

    expect(await command.callback({ module: 'missing' }, '')).toBe('false');
    expect(stEchoMock).toHaveBeenCalledWith('error', 'zTracker: no Module with id "missing".');
  });

  test('hints at name=value syntax when a flag-style argument is mistyped', async () => {
    const { command } = bootCheckCommand({ chat: [{ extra: {} }] });

    expect(await command.callback({}, '--module=scene-tracker')).toBe('false');
    expect(stEchoMock).toHaveBeenCalledWith('error', expect.stringContaining('without dashes'));
  });

  test('hints that named arguments must come before the message index', async () => {
    const { command } = bootCheckCommand({ chat: [{ extra: {} }] });

    expect(await command.callback({}, '0 module=scene-tracker')).toBe('false');
    expect(stEchoMock).toHaveBeenCalledWith('error', expect.stringContaining('must come first'));
  });

  test('returns its result as a string, which SillyTavern accepts for piping', async () => {
    const chat = [makeTrackedMessage('scene-tracker', { time: '09:00' })];
    const { command } = bootCheckCommand({ chat });

    const result = await command.callback({ silent: 'true' }, '');
    expect(typeof result).toBe('string');
    expect(result).toBe('true');
  });

  test('reports an error and false when no Module is enabled', async () => {
    const modules = [makeSlashCommandModule({ id: 'scene-tracker', enabled: false })];
    const { command } = bootCheckCommand({ chat: [{ extra: {} }], modules });

    expect(await command.callback({}, '')).toBe('false');
    expect(stEchoMock).toHaveBeenCalledWith(
      'error',
      'zTracker: no Modules are enabled. Enable a Module or pass module=<id>.',
    );
  });

  test('reports an error and false when the chat is empty', async () => {
    const { command } = bootCheckCommand({ chat: [] });

    expect(await command.callback({}, '')).toBe('false');
    expect(stEchoMock).toHaveBeenCalledWith('error', 'zTracker: there is no chat message to target.');
  });

  test('suppresses toasts for silent=true while still returning the result', async () => {
    const chat = [makeTrackedMessage('scene-tracker', { time: '09:00' })];
    const { command } = bootCheckCommand({ chat });

    expect(await command.callback({ silent: 'true' }, '')).toBe('true');
    expect(stEchoMock).not.toHaveBeenCalled();
  });

  test('registers once per host parser instance', () => {
    const harness = createSlashCommandHarness({ chat: [] });
    const runtime = {
      globalContext: harness.context,
      settingsManager: makeSlashCommandSettingsManager(
        makeSlashCommandSettings([makeSlashCommandModule({ id: 'scene-tracker' })]),
      ),
      actions: { generateTracker: jest.fn(), generateTrackersForMessage: jest.fn() } as any,
    };

    initializeSlashCommands(runtime);
    initializeSlashCommands(runtime);

    expect(harness.addCommandObject).toHaveBeenCalledTimes(4);
  });

  test('does nothing when the host exposes no slash command parser', () => {
    expect(() =>
      initializeSlashCommands({
        globalContext: {},
        settingsManager: makeSlashCommandSettingsManager(makeSlashCommandSettings([])),
        actions: {} as any,
      }),
    ).not.toThrow();
  });
});
