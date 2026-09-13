import type { TrackerModule } from '../config.js';
import { getOrderedTrackerModules } from '../config.js';
import { st_echo } from 'sillytavern-utils-lib/config';
import {
  buildMessageArgument,
  buildModuleArgument,
  buildSilentArgument,
  getModuleLabel,
  hasTrackerValue,
  isTrueTrackerArgument,
  resolveTrackerCommandMessage,
  resolveTrackerCommandTarget,
  resolveTrackerDeleteModules,
  type SlashCommandRuntime,
} from './slash-command-targets.js';

// SlashCommandParser instances already patched by this module, so repeated boots stay quiet.
const registeredSlashCommandParsers = new WeakSet<object>();

/** Registers `/ztracker-check`, which reports whether a message already has stored tracker data. */
function registerCheckCommand(runtime: SlashCommandRuntime): void {
  runtime.globalContext.SlashCommandParser.addCommandObject(
    runtime.globalContext.SlashCommand.fromProps({
      name: 'ztracker-check',
      aliases: ['ztracker-status'],
      helpString:
        'Checks whether zTracker has a stored tracker for a message. Defaults to the last message and to every enabled Module.',
      returns: 'true when a tracker is stored for the message, false otherwise',
      namedArgumentList: [buildModuleArgument(runtime), buildSilentArgument(runtime)],
      unnamedArgumentList: [
        buildMessageArgument(runtime, 'Message index to check. Defaults to the last message in the chat.'),
      ],
      callback: (args: any, value: unknown) => {
        const target = resolveTrackerCommandTarget({ runtime, rawMessageId: value, rawModuleId: args?.module });
        if (!target) {
          return 'false';
        }

        const trackedModules = target.modules.filter((module) => hasTrackerValue(target.chat[target.messageId], module.id));
        if (!isTrueTrackerArgument(args?.silent)) {
          st_echo(
            'info',
            trackedModules.length === 0
              ? `zTracker: no tracker is stored on message #${target.messageId}.`
              : `zTracker: message #${target.messageId} has a tracker for ${trackedModules.map(getModuleLabel).join(', ')}.`,
          );
        }

        return trackedModules.length > 0 ? 'true' : 'false';
      },
    }),
  );
}

/** Registers `/ztracker-generate`, which forces the tracker-generation flow for one message. */
function registerGenerateCommand(runtime: SlashCommandRuntime): void {
  runtime.globalContext.SlashCommandParser.addCommandObject(
    runtime.globalContext.SlashCommand.fromProps({
      name: 'ztracker-generate',
      aliases: ['ztracker-regenerate'],
      helpString:
        'Forces zTracker to generate (or regenerate) the tracker for a message, ignoring automatic triggers. Each Module\'s Skip First X Messages setting still applies, like the per-message toolbar button.',
      returns: 'true when generation succeeded and tracker data is stored for every targeted Module',
      namedArgumentList: [buildModuleArgument(runtime), buildSilentArgument(runtime)],
      unnamedArgumentList: [
        buildMessageArgument(runtime, 'Message index to generate for. Defaults to the last message in the chat.'),
      ],
      callback: async (args: any, value: unknown) => {
        const target = resolveTrackerCommandTarget({ runtime, rawMessageId: value, rawModuleId: args?.module });
        if (!target) {
          return 'false';
        }

        const silent = isTrueTrackerArgument(args?.silent);
        const moduleIds = target.modules.map((module) => module.id);
        let succeeded = false;
        try {
          succeeded =
            moduleIds.length === 1
              ? await runtime.actions.generateTracker(target.messageId, {
                  moduleId: moduleIds[0],
                  silent,
                  showStatusIndicator: !silent,
                })
              : await runtime.actions.generateTrackersForMessage(target.messageId, {
                  moduleIds,
                  silent,
                  showStatusIndicator: !silent,
                });
        } catch (error: any) {
          console.error('zTracker: slash command tracker generation failed:', error);
          st_echo('error', `zTracker: tracker generation failed: ${error?.message ?? error}`);
          return 'false';
        }

        const trackedModules = target.modules.filter((module) => hasTrackerValue(target.chat[target.messageId], module.id));
        const completed = succeeded && trackedModules.length === moduleIds.length;
        if (!completed) {
          if (!silent) {
            st_echo(
              'warning',
              `zTracker: no tracker was stored on message #${target.messageId}. If this message is inside a Module's "Skip First X Messages" window, raise or clear that setting first.`,
            );
          }
        } else if (!silent) {
          st_echo(
            'success',
            `zTracker: generated a tracker for message #${target.messageId} (${trackedModules.map(getModuleLabel).join(', ')}).`,
          );
        }

        return completed ? 'true' : 'false';
      },
    }),
  );
}

/** Registers `/ztracker-delete`, which removes stored tracker data from one message. */
function registerDeleteCommand(runtime: SlashCommandRuntime): void {
  runtime.globalContext.SlashCommandParser.addCommandObject(
    runtime.globalContext.SlashCommand.fromProps({
      name: 'ztracker-delete',
      aliases: ['ztracker-clear'],
      helpString:
        'Deletes stored tracker data from a message. Without module=<id> it clears every Module that has a tracker on that message, including disabled Modules. Unlike the message toolbar button, it does not ask for confirmation.',
      returns: 'true when no targeted Module has stored tracker data left on the message',
      namedArgumentList: [buildModuleArgument(runtime), buildSilentArgument(runtime)],
      unnamedArgumentList: [
        buildMessageArgument(runtime, 'Message index to clear. Defaults to the last message in the chat.'),
      ],
      callback: async (args: any, value: unknown) => {
        const target = resolveTrackerCommandMessage({ runtime, rawMessageId: value });
        if (!target) {
          return 'false';
        }

        const { modules, unknownModuleId } = resolveTrackerDeleteModules({
          settings: runtime.settingsManager.getSettings(),
          message: target.message,
          requestedModuleId: args?.module,
        });
        if (unknownModuleId) {
          st_echo('error', `zTracker: no Module with id "${unknownModuleId}".`);
          return 'false';
        }

        const silent = isTrueTrackerArgument(args?.silent);
        const deletedModules: TrackerModule[] = [];
        for (const module of modules) {
          try {
            const deleted = await runtime.actions.deleteTracker(target.messageId, module.id, {
              skipConfirmation: true,
              skipSuccessToast: true,
            });
            if (deleted) {
              deletedModules.push(module);
            }
          } catch (error: any) {
            console.error('zTracker: slash command tracker deletion failed:', error);
            st_echo('error', `zTracker: could not delete the tracker for ${getModuleLabel(module)}: ${error?.message ?? error}`);
            return 'false';
          }
        }

        const remainingModules = modules.filter((module) => hasTrackerValue(target.message, module.id));
        if (remainingModules.length > 0) {
          st_echo(
            'warning',
            `zTracker: tracker data is still stored on message #${target.messageId} for ${remainingModules.map(getModuleLabel).join(', ')}.`,
          );
          return 'false';
        }

        if (!silent) {
          st_echo(
            deletedModules.length > 0 ? 'success' : 'info',
            deletedModules.length > 0
              ? `zTracker: deleted the tracker on message #${target.messageId} (${deletedModules.map(getModuleLabel).join(', ')}).`
              : `zTracker: there is no tracker to delete on message #${target.messageId}.`,
          );
        }

        return 'true';
      },
    }),
  );
}

/** Registers `/ztracker-modules`, which lists every configured Module so its id can be used by the other commands. */
function registerModulesCommand(runtime: SlashCommandRuntime): void {
  runtime.globalContext.SlashCommandParser.addCommandObject(
    runtime.globalContext.SlashCommand.fromProps({
      name: 'ztracker-modules',
      aliases: ['ztracker-list'],
      helpString:
        'Lists every Module zTracker resolves - in Module order and including disabled ones - with its name, id, and enabled state. Returns the Module ids, or the Module names when names=true.',
      returns: 'comma-separated Module ids, or comma-separated Module names with names=true',
      namedArgumentList: [
        runtime.globalContext.SlashCommandNamedArgument.fromProps({
          name: 'names',
          description: 'Return Module names instead of ids.',
          typeList: [runtime.globalContext.ARGUMENT_TYPE.BOOLEAN],
          defaultValue: 'false',
        }),
        buildSilentArgument(runtime),
      ],
      unnamedArgumentList: [],
      callback: (args: any) => {
        // Same resolver the other commands use, so the listed ids are directly usable as module=<id>.
        const modules = getOrderedTrackerModules(runtime.settingsManager.getSettings(), { includeDisabled: true });
        const returnNames = isTrueTrackerArgument(args?.names);

        if (!isTrueTrackerArgument(args?.silent)) {
          st_echo(
            'info',
            `zTracker: ${modules.length} Module${modules.length === 1 ? '' : 's'}: ${modules
              .map((module) => `${getModuleLabel(module)} (${module.id})${module.enabled ? '' : ' - disabled'}`)
              .join(' · ')}`,
          );
        }

        return modules.map((module) => (returnNames ? getModuleLabel(module) : module.id)).join(', ');
      },
    }),
  );
}

/** Registers zTracker's slash commands on the host parser, once per parser instance. */
export function initializeSlashCommands(runtime: SlashCommandRuntime): void {
  const parser = runtime.globalContext?.SlashCommandParser;
  if (!parser || !runtime.globalContext?.SlashCommand || registeredSlashCommandParsers.has(parser)) {
    return;
  }

  registeredSlashCommandParsers.add(parser);
  registerCheckCommand(runtime);
  registerGenerateCommand(runtime);
  registerDeleteCommand(runtime);
  registerModulesCommand(runtime);
}
