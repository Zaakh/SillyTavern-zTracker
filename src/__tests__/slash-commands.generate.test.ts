/**
 * @jest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

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
  makeTrackedMessage,
} = await import('../test-utils/slash-command-test-helpers.js');

/** Boots zTracker's commands against a fresh fake host and returns the generate command. */
function bootGenerateCommand(
  options: {
    chat?: any[];
    modules?: any[];
    generateTracker?: jest.Mock<any>;
    generateTrackersForMessage?: jest.Mock<any>;
  } = {},
) {
  const harness = createSlashCommandHarness({ chat: options.chat ?? [] });
  const settings = makeSlashCommandSettings(options.modules ?? [makeSlashCommandModule({ id: 'scene-tracker', name: 'Scene Tracker' })]);
  const actions = {
    generateTracker: options.generateTracker ?? jest.fn(async () => true),
    generateTrackersForMessage: options.generateTrackersForMessage ?? jest.fn(async () => true),
  };

  initializeSlashCommands({
    globalContext: harness.context,
    settingsManager: makeSlashCommandSettingsManager(settings),
    actions: actions as any,
  });

  const command = harness.commands.get('ztracker-generate');
  if (!command) {
    throw new Error('ztracker-generate was not registered');
  }

  return { ...harness, actions, command };
}

/** Stores tracker data on a chat message, emulating what a successful generation run persists. */
function storeTrackerOnMessage(chat: any[], messageId: number, moduleIds: string[]): void {
  chat[messageId].extra = {
    zTracker: { byId: Object.fromEntries(moduleIds.map((moduleId) => [moduleId, { value: {} }])) },
  };
}

describe('ztracker-generate slash command', () => {
  beforeEach(() => {
    stEchoMock.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('registers the command with its alias and generation return contract', () => {
    const { commands, context, command } = bootGenerateCommand();

    expect(context.SlashCommandParser.addCommandObject).toHaveBeenCalledTimes(4);
    expect(commands.get('ztracker-regenerate')).toBe(command);
    expect(command.returns).toBe('true when generation succeeded and tracker data is stored for every targeted Module');
    expect(command.unnamedArgumentList?.[0]).toEqual({ description: expect.any(String), typeList: ['number'] });
  });

  test('defaults to the last message in the chat', async () => {
    const chat: any[] = [{ extra: {} }, { extra: {} }];
    const generateTracker = jest.fn(async (messageId: number) => {
      storeTrackerOnMessage(chat, messageId, ['scene-tracker']);
      return true;
    });
    const { command } = bootGenerateCommand({ chat, generateTracker });

    expect(await command.callback({}, '')).toBe('true');
    expect(generateTracker).toHaveBeenCalledWith(1, { moduleId: 'scene-tracker', silent: false, showStatusIndicator: true });
  });

  test('forces generation for one module=<id> and reports the stored result', async () => {
    const chat: any[] = [{ extra: {} }];
    const generateTracker = jest.fn(async (messageId: number) => {
      storeTrackerOnMessage(chat, messageId, ['agenda']);
      return true;
    });
    const { command, actions } = bootGenerateCommand({
      chat,
      modules: [makeSlashCommandModule({ id: 'agenda', name: 'Agenda' })],
      generateTracker,
    });

    expect(await command.callback({ module: 'agenda' }, '0')).toBe('true');
    expect(generateTracker).toHaveBeenCalledWith(0, { moduleId: 'agenda', silent: false, showStatusIndicator: true });
    expect(actions.generateTrackersForMessage).not.toHaveBeenCalled();
    expect(stEchoMock).toHaveBeenCalledWith('success', 'zTracker: generated a tracker for message #0 (Agenda).');
  });

  test('generates for every enabled Module when module=<id> is omitted', async () => {
    const chat: any[] = [{ extra: {} }];
    const generateTrackersForMessage = jest.fn(async (messageId: number) => {
      storeTrackerOnMessage(chat, messageId, ['scene-tracker', 'agenda']);
      return true;
    });
    const { command, actions } = bootGenerateCommand({
      chat,
      modules: [
        makeSlashCommandModule({ id: 'scene-tracker', name: 'Scene Tracker', order: 0 }),
        makeSlashCommandModule({ id: 'agenda', name: 'Agenda', order: 1 }),
        makeSlashCommandModule({ id: 'disabled', name: 'Disabled', enabled: false, order: 2 }),
      ],
      generateTrackersForMessage,
    });

    expect(await command.callback({}, '0')).toBe('true');
    expect(generateTrackersForMessage).toHaveBeenCalledWith(0, {
      moduleIds: ['scene-tracker', 'agenda'],
      silent: false,
      showStatusIndicator: true,
    });
    expect(actions.generateTracker).not.toHaveBeenCalled();
    expect(stEchoMock).toHaveBeenCalledWith(
      'success',
      'zTracker: generated a tracker for message #0 (Scene Tracker, Agenda).',
    );
  });

  test('maps silent=true to a silent run without the progress badge', async () => {
    const chat: any[] = [makeTrackedMessage('agenda', { items: [] })];
    const generateTracker = jest.fn(async () => true);
    const { command } = bootGenerateCommand({
      chat,
      modules: [makeSlashCommandModule({ id: 'agenda' })],
      generateTracker,
    });

    expect(await command.callback({ silent: 'true' }, '0')).toBe('true');
    expect(generateTracker).toHaveBeenCalledWith(0, { moduleId: 'agenda', silent: true, showStatusIndicator: false });
    expect(stEchoMock).not.toHaveBeenCalled();
  });

  test('honors an explicit module=<id> for a disabled Module', async () => {
    const chat: any[] = [makeTrackedMessage('agenda', { items: [] })];
    const generateTracker = jest.fn(async () => true);
    const { command, actions } = bootGenerateCommand({
      chat,
      modules: [makeSlashCommandModule({ id: 'agenda', name: 'Agenda', enabled: false })],
      generateTracker,
    });

    expect(await command.callback({ module: 'agenda' }, '')).toBe('true');
    expect(generateTracker).toHaveBeenCalledWith(0, { moduleId: 'agenda', silent: false, showStatusIndicator: true });
    expect(actions.generateTrackersForMessage).not.toHaveBeenCalled();
  });

  test('reports false with a Skip First X Messages hint when nothing was stored', async () => {
    const generateTracker = jest.fn(async () => false);
    const { command } = bootGenerateCommand({
      chat: [{ extra: {} }],
      modules: [makeSlashCommandModule({ id: 'scene-tracker' })],
      generateTracker,
    });

    expect(await command.callback({}, '0')).toBe('false');
    expect(stEchoMock).toHaveBeenCalledWith('warning', expect.stringContaining('Skip First X Messages'));
  });

  test('reports false when generation claims success without storing tracker data', async () => {
    const generateTracker = jest.fn(async () => true);
    const { command } = bootGenerateCommand({
      chat: [{ extra: {} }],
      modules: [makeSlashCommandModule({ id: 'scene-tracker' })],
      generateTracker,
    });

    expect(await command.callback({}, '0')).toBe('false');
    expect(stEchoMock).toHaveBeenCalledWith('warning', expect.stringContaining('no tracker was stored on message #0'));
  });

  test('stays quiet for silent=true when nothing was stored', async () => {
    const generateTracker = jest.fn(async () => false);
    const { command } = bootGenerateCommand({
      chat: [{ extra: {} }],
      modules: [makeSlashCommandModule({ id: 'scene-tracker' })],
      generateTracker,
    });

    expect(await command.callback({ silent: 'true' }, '0')).toBe('false');
    expect(stEchoMock).not.toHaveBeenCalled();
  });

  test('reports an error toast and false when generation throws', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const generateTracker = jest.fn(async () => {
      throw new Error('boom');
    });
    const { command } = bootGenerateCommand({
      chat: [{ extra: {} }],
      modules: [makeSlashCommandModule({ id: 'scene-tracker' })],
      generateTracker,
    });

    expect(await command.callback({ module: 'scene-tracker' }, '0')).toBe('false');
    expect(stEchoMock).toHaveBeenCalledWith('error', 'zTracker: tracker generation failed: boom');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test('does not call the generation actions for invalid targets', async () => {
    const { command, actions } = bootGenerateCommand({ chat: [{ extra: {} }] });

    expect(await command.callback({}, '7')).toBe('false');
    expect(await command.callback({ module: 'missing' }, '0')).toBe('false');
    expect(actions.generateTracker).not.toHaveBeenCalled();
    expect(actions.generateTrackersForMessage).not.toHaveBeenCalled();
  });
});
