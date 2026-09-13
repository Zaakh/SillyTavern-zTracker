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
  makeTrackedMessage,
} = await import('../test-utils/slash-command-test-helpers.js');

/** Boots zTracker's commands against a fresh fake host and returns the delete command. */
function bootDeleteCommand(options: { chat?: any[]; modules?: any[]; deleteTracker?: jest.Mock<any> } = {}) {
  const chat = options.chat ?? [];
  const harness = createSlashCommandHarness({ chat });
  const settings = makeSlashCommandSettings(options.modules ?? [makeSlashCommandModule({ id: 'scene-tracker', name: 'Scene Tracker' })]);
  const actions = {
    generateTracker: jest.fn(async () => true),
    generateTrackersForMessage: jest.fn(async () => true),
    // Mirrors the extension: removes the Module record from the message and reports whether it did.
    deleteTracker:
      options.deleteTracker ??
      jest.fn(async (messageId: number, moduleId: string) => {
        const records = chat[messageId]?.extra?.zTracker?.byId;
        if (!records || records[moduleId] === undefined) {
          return false;
        }
        delete records[moduleId];
        return true;
      }),
  };

  initializeSlashCommands({
    globalContext: harness.context,
    settingsManager: makeSlashCommandSettingsManager(settings),
    actions: actions as any,
  });

  const command = harness.commands.get('ztracker-delete');
  if (!command) {
    throw new Error('ztracker-delete was not registered');
  }

  return { ...harness, actions, command, chat };
}

/** Two tracked Modules, the second one disabled, both carrying stored tracker data. */
function twoTrackedModules() {
  return [
    makeSlashCommandModule({ id: 'scene-tracker', name: 'Scene Tracker', order: 0 }),
    makeSlashCommandModule({ id: 'plot-log', name: 'Plot Log', enabled: false, order: 1 }),
  ];
}

describe('ztracker-delete slash command', () => {
  beforeEach(() => {
    stEchoMock.mockClear();
  });

  test('registers the command with its alias, return contract, and arguments', () => {
    const { commands, context, command } = bootDeleteCommand();

    expect(context.SlashCommandParser.addCommandObject).toHaveBeenCalledTimes(4);
    expect(commands.get('ztracker-clear')).toBe(command);
    expect(command.returns).toBe('true when no targeted Module has stored tracker data left on the message');
    expect(command.unnamedArgumentList?.[0]).toEqual({ description: expect.any(String), typeList: ['number'] });
    expect(command.namedArgumentList?.map((argument: any) => argument.name)).toEqual(['module', 'silent']);
  });

  test('clears every Module that has a tracker, including disabled ones', async () => {
    const chat: any[] = [
      {
        extra: {
          zTracker: { byId: { 'scene-tracker': { value: { time: '09:00' } }, 'plot-log': { value: { arc: 'intro' } } } },
        },
      },
    ];
    const { command, actions, chat: targetChat } = bootDeleteCommand({ chat, modules: twoTrackedModules() });

    expect(await command.callback({}, '')).toBe('true');
    expect(actions.deleteTracker).toHaveBeenCalledTimes(2);
    expect(actions.deleteTracker).toHaveBeenCalledWith(0, 'scene-tracker', {
      skipConfirmation: true,
      skipSuccessToast: true,
    });
    expect(actions.deleteTracker).toHaveBeenCalledWith(0, 'plot-log', {
      skipConfirmation: true,
      skipSuccessToast: true,
    });
    expect(targetChat[0].extra.zTracker.byId).toEqual({});
    expect(stEchoMock).toHaveBeenCalledWith(
      'success',
      'zTracker: deleted the tracker on message #0 (Scene Tracker, Plot Log).',
    );
  });

  test('reports success with an info toast when there is nothing to delete', async () => {
    const { command, actions } = bootDeleteCommand({ chat: [{ extra: {} }] });

    expect(await command.callback({}, '0')).toBe('true');
    expect(actions.deleteTracker).not.toHaveBeenCalled();
    expect(stEchoMock).toHaveBeenCalledWith('info', 'zTracker: there is no tracker to delete on message #0.');
  });

  test('narrows the deletion to module=<id> and leaves other Modules alone', async () => {
    const chat: any[] = [
      {
        extra: {
          zTracker: { byId: { 'scene-tracker': { value: { time: '09:00' } }, 'plot-log': { value: { arc: 'intro' } } } },
        },
      },
    ];
    const { command, actions, chat: targetChat } = bootDeleteCommand({ chat, modules: twoTrackedModules() });

    expect(await command.callback({ module: 'plot-log' }, '')).toBe('true');
    expect(actions.deleteTracker).toHaveBeenCalledTimes(1);
    expect(actions.deleteTracker).toHaveBeenCalledWith(0, 'plot-log', expect.any(Object));
    expect(targetChat[0].extra.zTracker.byId['scene-tracker']).toEqual({ value: { time: '09:00' } });
    expect(stEchoMock).toHaveBeenCalledWith('success', 'zTracker: deleted the tracker on message #0 (Plot Log).');
  });

  test('targets the requested message index only', async () => {
    const chat: any[] = [makeTrackedMessage('scene-tracker', { time: '08:00' }), makeTrackedMessage('scene-tracker', { time: '09:00' })];
    const { command, actions, chat: targetChat } = bootDeleteCommand({ chat });

    expect(await command.callback({}, '0')).toBe('true');
    expect(actions.deleteTracker).toHaveBeenCalledWith(0, 'scene-tracker', expect.any(Object));
    expect(targetChat[1].extra.zTracker.byId['scene-tracker']).toEqual({ value: { time: '09:00' } });
  });

  test('reports an error and false for an unknown Module id', async () => {
    const { command, actions } = bootDeleteCommand({ chat: [makeTrackedMessage('scene-tracker', { time: '09:00' })] });

    expect(await command.callback({ module: 'missing' }, '')).toBe('false');
    expect(actions.deleteTracker).not.toHaveBeenCalled();
    expect(stEchoMock).toHaveBeenCalledWith('error', 'zTracker: no Module with id "missing".');
  });

  test('reports false with a warning when tracker data is still stored afterwards', async () => {
    const deleteTracker = jest.fn(async () => false);
    const { command } = bootDeleteCommand({
      chat: [makeTrackedMessage('scene-tracker', { time: '09:00' })],
      deleteTracker,
    });

    expect(await command.callback({}, '')).toBe('false');
    expect(stEchoMock).toHaveBeenCalledWith(
      'warning',
      'zTracker: tracker data is still stored on message #0 for Scene Tracker.',
    );
  });

  test('reports an error toast and false when deletion throws', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const deleteTracker = jest.fn(async () => {
      throw new Error('boom');
    });
    const { command } = bootDeleteCommand({
      chat: [makeTrackedMessage('scene-tracker', { time: '09:00' })],
      deleteTracker,
    });

    expect(await command.callback({}, '')).toBe('false');
    expect(stEchoMock).toHaveBeenCalledWith('error', 'zTracker: could not delete the tracker for Scene Tracker: boom');
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  test('deletes quietly with silent=true', async () => {
    const { command, actions, chat: targetChat } = bootDeleteCommand({ chat: [makeTrackedMessage('scene-tracker', { time: '09:00' })] });

    expect(await command.callback({ silent: 'true' }, '')).toBe('true');
    expect(actions.deleteTracker).toHaveBeenCalledTimes(1);
    expect(targetChat[0].extra.zTracker.byId).toEqual({});
    expect(stEchoMock).not.toHaveBeenCalled();
  });

  test('reports an error and false for an empty chat or an invalid index', async () => {
    const emptyChat = bootDeleteCommand({ chat: [] });
    expect(await emptyChat.command.callback({}, '')).toBe('false');
    expect(stEchoMock).toHaveBeenCalledWith('error', 'zTracker: there is no chat message to target.');

    const invalidIndex = bootDeleteCommand({ chat: [makeTrackedMessage('scene-tracker', { time: '09:00' })] });
    expect(await invalidIndex.command.callback({}, '5')).toBe('false');
    expect(invalidIndex.actions.deleteTracker).not.toHaveBeenCalled();
    expect(stEchoMock).toHaveBeenCalledWith('error', 'zTracker: message index must be a whole number between 0 and 0.');
  });
});
