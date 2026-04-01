/**
 * Shared live-like fixture data for tracker-context debug harnesses.
 * The goal is to keep local captures aligned with the real SillyTavern prompt shape.
 */

import {
  DEFAULT_PROMPT_JSON,
  DEFAULT_PROMPT_TOON,
  DEFAULT_PROMPT_XML,
  DEFAULT_SCHEMA_HTML,
  PromptEngineeringMode,
  TrackerWorldInfoPolicyMode,
  ZTRACKER_SYSTEM_PROMPT_PRESET_NAME,
  ZTRACKER_SYSTEM_PROMPT_TEXT,
} from '../src/config.js';

/** Reuses the live `Bar` profile id so local captures match the observed runtime request. */
export const LIVE_BAR_PROFILE_ID = 'a16e3fcd-6739-4843-92f8-528bb85f92b2';

/** Mirrors the schema shown in the live zTracker settings panel for the `Bar` chat. */
export const LIVE_BAR_SCHEMA_VALUE = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'SceneTracker',
  description: 'Schema for tracking roleplay scene details',
  type: 'object',
  properties: {
    time: {
      type: 'string',
      description: 'Format: HH:MM:SS; MM/DD/YYYY (Day Name)',
    },
    location: {
      type: 'string',
      description: 'Specific scene location with increasing specificity',
    },
    weather: {
      type: 'string',
      description: 'Current weather conditions and temperature',
    },
    topics: {
      type: 'object',
      properties: {
        primaryTopic: {
          type: 'string',
          description: '1-2 word main topic of interaction',
        },
        emotionalTone: {
          type: 'string',
          description: 'Dominant emotional tone of scene',
        },
        interactionTheme: {
          type: 'string',
          description: 'Type of character interaction',
        },
      },
      required: ['primaryTopic', 'emotionalTone', 'interactionTheme'],
    },
    charactersPresent: {
      type: 'array',
      items: {
        type: 'string',
        description: 'Character name',
      },
      description: 'List of character names present in scene',
    },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Character name',
          },
          hair: {
            type: 'string',
            description: 'Hairstyle and condition',
          },
          makeup: {
            type: 'string',
            description: "Makeup description or 'None'",
          },
          outfit: {
            type: 'string',
            description: 'Complete outfit including underwear',
          },
          stateOfDress: {
            type: 'string',
            description: 'How put-together/disheveled character appears, distinct from outfit',
          },
          postureAndInteraction: {
            type: 'string',
            description: "Character's physical positioning and interaction",
          },
        },
        required: ['name', 'hair', 'makeup', 'outfit', 'stateOfDress', 'postureAndInteraction'],
      },
      description: 'Array of character objects',
      'x-ztracker-dependsOn': ['charactersPresent'],
      'x-ztracker-idKey': 'name',
    },
  },
  required: ['time', 'location', 'weather', 'topics', 'charactersPresent', 'characters'],
} as const;

const BAR_TRACKER_SNAPSHOT = `Scene details:
time: 14:23:07; 09/28/2025 (Tuesday)
location: Bar interior, cozy corner near the bar
weather: Clear, 72°F
topics:
  primaryTopic: Drink order
  emotionalTone: Friendly
  interactionTheme: Customer-service
charactersPresent:
  - Silvia
characters:
  [Silvia:
    name: Silvia
    hair: Short blonde hair, neat
    makeup: None
    outfit: White shirt, black apron, black pants, black bra and panties
    stateOfDress: Polished but casual
    postureAndInteraction: Standing behind counter, leaning forward, smiling
  ]
`;

/** Builds the same pre-format prompt stack seen in the live `Bar` chat capture. */
export function makeLiveLikePromptMessages() {
  return [
    {
      role: 'system',
      content:
        'Bar is the narrator in a simple scenario. It narrates the action of the environment and the dialogue of character other than Tobias.\n',
      ignoreInstruct: true,
    },
    {
      role: 'system',
      content: 'The interior of the bar is cozy and inviting.',
    },
    {
      role: 'assistant',
      name: 'Bar',
      content:
        'As you enter the bar you realize you are the only customer. The barkeeper greets you: "Hello I am Silvia, what can I get you?"',
    },
    {
      role: 'user',
      name: 'Tobias',
      content: '"Just checking the room for a moment."',
    },
    {
      role: 'system',
      content: BAR_TRACKER_SNAPSHOT,
    },
    {
      role: 'assistant',
      name: 'Bar',
      content:
        '“Just checking the room, huh?” Silvia chuckled, a warm, genuine sound. “Well, welcome to ‘The Cozy Corner.’ It *is* a bit quiet today, but that’s usually a good thing, don’t you think? Less noise, more conversation… or just a nice, peaceful drink.” She leaned slightly forward, her smile widening. “So, what’ll it be? We’ve got a lovely selection of local craft beers, some classic cocktails, and of course, a good old-fashioned iced tea.”\n\n“Less noise, more conversation… or just a nice, peaceful drink?”',
    },
    {
      role: 'user',
      name: 'Tobias',
      content: 'I would like an iced tea and a quiet seat near the wall while I keep an eye on the room.',
    },
    {
      role: 'system',
      content: BAR_TRACKER_SNAPSHOT,
    },
  ] as Array<Record<string, unknown>>;
}

/** Installs a minimal SillyTavern context so the harness exercises the real request assembly path. */
export function installLiveLikeSillyTavernContext() {
  const context = {
    chatMetadata: {},
    powerUserSettings: {
      prefer_character_prompt: true,
      sysprompt: { name: 'Roleplay - Detailed' },
    },
    getPresetManager: (apiId?: string) => {
      if (apiId === 'sysprompt') {
        return {
          getCompletionPresetByName: (name?: string) =>
            name === ZTRACKER_SYSTEM_PROMPT_PRESET_NAME
              ? {
                  name: ZTRACKER_SYSTEM_PROMPT_PRESET_NAME,
                  content: ZTRACKER_SYSTEM_PROMPT_TEXT,
                }
              : undefined,
          getPresetList: () => ({ presets: [], preset_names: [ZTRACKER_SYSTEM_PROMPT_PRESET_NAME] }),
        };
      }
      return null;
    },
  };

  (globalThis as any).SillyTavern = {
    getContext: () => context,
  };
}

/** Returns settings aligned with the live `Bar` capture for the requested prompt-engineering mode. */
export function makeLiveLikeSettings(mode: PromptEngineeringMode) {
  return {
    profileId: LIVE_BAR_PROFILE_ID,
    trackerSystemPromptMode: 'saved',
    trackerSystemPromptSavedName: ZTRACKER_SYSTEM_PROMPT_PRESET_NAME,
    maxResponseToken: 16000,
    autoMode: {},
    sequentialPartGeneration: false,
    schemaPreset: 'default',
    schemaPresets: {
      default: {
        name: 'Default',
        value: LIVE_BAR_SCHEMA_VALUE,
        html: DEFAULT_SCHEMA_HTML,
      },
    },
    prompt: '',
    skipFirstXMessages: 0,
    includeLastXMessages: 4,
    includeLastXZTrackerMessages: 2,
    embedZTrackerRole: 'system',
    embedZTrackerSnapshotHeader: 'Scene details:',
    embedZTrackerSnapshotTransformPreset: 'minimal',
    embedZTrackerSnapshotTransformPresets: {
      default: {
        name: 'Default (JSON)',
        input: 'pretty_json',
        pattern: '',
        flags: 'g',
        replacement: '',
        codeFenceLang: 'json',
        wrapInCodeFence: true,
      },
      minimal: {
        name: 'Minimal (top-level properties)',
        input: 'top_level_lines',
        pattern: '^[\\t ]*"([^\"]+)"[\\t ]*:[\\t ]*(.*?)(?:,)?[\\t ]*$',
        flags: 'gm',
        replacement: '$1: $2',
        codeFenceLang: 'text',
        wrapInCodeFence: false,
      },
      toon: {
        name: 'TOON (compact)',
        input: 'toon',
        pattern: '',
        flags: 'g',
        replacement: '',
        codeFenceLang: 'toon',
        wrapInCodeFence: true,
      },
    },
    promptEngineeringMode: mode,
    promptJson: DEFAULT_PROMPT_JSON,
    promptXml: DEFAULT_PROMPT_XML,
    promptToon: DEFAULT_PROMPT_TOON,
    debugLogging: false,
    trackerWorldInfoPolicyMode: TrackerWorldInfoPolicyMode.INCLUDE_ALL,
    trackerWorldInfoAllowlistBookNames: ['The Bar'],
    trackerWorldInfoAllowlistEntryIds: [12, 42],
  } as any;
}