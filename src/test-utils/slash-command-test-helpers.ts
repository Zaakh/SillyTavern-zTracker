import { jest } from '@jest/globals';
import { createDefaultTrackerModule } from '../config.js';
import type { ExtensionSettings, TrackerModule } from '../config.js';

/** Captured slash command definition registered through the fake host parser. */
export type CapturedSlashCommand = {
  name: string;
  aliases?: string[];
  helpString?: string;
  returns?: string;
  namedArgumentList?: any[];
  unnamedArgumentList?: any[];
  callback: (args: any, value: unknown) => unknown;
};

/** Builds a minimal host context that records every slash command zTracker registers. */
export function createSlashCommandHarness(options: { chat?: unknown[] } = {}) {
  const commands = new Map<string, CapturedSlashCommand>();
  const addCommandObject = jest.fn((command: CapturedSlashCommand) => {
    commands.set(command.name, command);
    for (const alias of command.aliases ?? []) {
      commands.set(alias, command);
    }
  });

  const SlashCommandEnumValue = class {
    constructor(
      public value: string,
      public description?: string,
    ) {}
  };

  const context = {
    chat: options.chat ?? [],
    SlashCommandParser: { addCommandObject },
    SlashCommand: { fromProps: (props: CapturedSlashCommand) => props },
    SlashCommandNamedArgument: { fromProps: (props: unknown) => props },
    SlashCommandArgument: { fromProps: (props: unknown) => props },
    SlashCommandEnumValue,
    ARGUMENT_TYPE: { STRING: 'string', NUMBER: 'number', BOOLEAN: 'bool' },
  };

  return { context, commands, addCommandObject };
}

/** Builds one tracker Module for command target-resolution tests. */
export function makeSlashCommandModule(overrides: {
  id: string;
  name?: string;
  enabled?: boolean;
  order?: number;
}): TrackerModule {
  const module = createDefaultTrackerModule({
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    order: overrides.order ?? 0,
  });
  module.enabled = overrides.enabled ?? true;
  return module;
}

/** Wraps Modules in the settings shape the commands read through `settingsManager.getSettings()`. */
export function makeSlashCommandSettings(modules: TrackerModule[]): ExtensionSettings {
  return { modules } as unknown as ExtensionSettings;
}

/** Builds a settings manager stub backed by one settings object. */
export function makeSlashCommandSettingsManager(settings: ExtensionSettings) {
  return { getSettings: () => settings } as any;
}

/** Builds one chat message carrying stored zTracker data for one Module. */
export function makeTrackedMessage(moduleId: string, value: unknown): { extra: Record<string, unknown> } {
  return { extra: { zTracker: { byId: { [moduleId]: { value } } } } };
}

/** Builds one chat message carrying legacy (pre-Modules) zTracker data on the Default Module. */
export function makeLegacyTrackedMessage(value: unknown): { extra: Record<string, unknown> } {
  return { extra: { zTracker: { value } } };
}
