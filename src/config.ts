import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import { repairCorruptedRequiredMetadata } from './schema-repair.js';
import { sanitizeIntegerSetting } from './settings-numeric.js';
import { DEFAULT_MODULE_ID, EXTENSION_KEY } from './extension-metadata.js';
export {
  extensionName,
  EXTENSION_KEY,
  CHAT_METADATA_SCHEMA_PRESET_KEY,
  CHAT_METADATA_MODULES_KEY,
  DEFAULT_MODULE_ID,
  getModuleChatMetadataRecord,
  migrateLegacyChatMetadataToModules,
  readModuleChatSchemaPresetKey,
  writeModuleChatSchemaPresetKey,
} from './extension-metadata.js';

export enum PromptEngineeringMode {
  NATIVE = 'native',
  JSON = 'json',
  XML = 'xml',
  TOON = 'toon',
}

export enum TrackerWorldInfoPolicyMode {
  INCLUDE_ALL = 'include_all',
  EXCLUDE_ALL = 'exclude_all',
  ALLOWLIST = 'allowlist',
}

export type TrackerConnectionSource = 'saved' | 'active';

export type TrackerSystemPromptMode = 'profile' | 'saved' | 'selected';

export type TrackerGenerationConversationRoleMode = 'preserve' | 'all_assistant';

export type TrackerGenerationMode = 'full' | 'sequential-parts';

export interface Schema {
  name: string;
  value: object;
  html: string;
}

export type EmbedSnapshotTransformInput = 'pretty_json' | 'top_level_lines' | 'toon';

export interface EmbedSnapshotRegexTransformPreset {
  name: string;
  /**
   * What text the regex runs against.
   * - pretty_json: JSON.stringify(data, null, 2)
   * - top_level_lines: one line per top-level property (values are JSON-stringified)
  * - toon: tab-delimited TOON encoded with @toon-format/toon
   */
  input: EmbedSnapshotTransformInput;
  /** JavaScript regex source (without leading/trailing slashes). Empty disables transform. */
  pattern: string;
  /** JavaScript regex flags, e.g. "gmi". */
  flags: string;
  /** Replacement string for String.prototype.replace(). */
  replacement: string;
  /** Markdown code fence language to use when embedding (e.g. json, text). */
  codeFenceLang: string;
  /** If false, embedding will not wrap output in a markdown code fence. */
  wrapInCodeFence?: boolean;
}

/**
 * Trigger direction for automatic tracker generation, independent of whether auto mode is
 * enabled. `NONE` is intentionally excluded: "no auto trigger" is expressed by `enabled: false`,
 * not by the direction, so a direction value always survives disabling auto mode and is ready to
 * use again the moment auto mode (or a per-character "on" override) re-enables it.
 */
export type TrackerModuleAutoDirection = Exclude<AutoModeOptions, AutoModeOptions.NONE>;

export interface TrackerModuleAutoSettings {
  enabled: boolean;
  direction: TrackerModuleAutoDirection;
}

export interface TrackerModuleSchemaSettings {
  preset: string;
  presets: Record<string, Schema>;
}

export interface TrackerModulePromptSettings {
  prompt: string;
  promptEngineeringMode: PromptEngineeringMode;
  promptJson: string;
  promptXml: string;
  promptToon: string;
}

export interface TrackerModuleSystemPromptSettings {
  mode: TrackerSystemPromptMode;
  savedName: string;
  /** Optional tailored system-prompt text owned by this Module, auto-installed as a saved preset at creation time. Empty for Modules with no persisted content (hand-created or migrated from legacy settings). */
  content: string;
}

export interface TrackerModuleConnectionSettings {
  source: TrackerConnectionSource;
  profileId: string;
}

/**
 * One entry in a Module's generation include list. `target: 'self'` is a reserved sentinel for
 * that Module's own tracker history; any other value is another Module's id. `count` follows the
 * same "0 means none" convention as `includeLastXZTrackerMessages`.
 */
export interface TrackerModuleIncludeEntry {
  target: 'self' | string;
  count: number;
}

export interface TrackerModuleGenerationSettings {
  mode: TrackerGenerationMode;
  maxResponseToken: number;
  skipFirstXMessages: number;
  includeLastXMessages: number;
  skipCharacterCardInTrackerGeneration: boolean;
  conversationRoleMode: TrackerGenerationConversationRoleMode;
  worldInfoPolicyMode: TrackerWorldInfoPolicyMode;
  worldInfoAllowlistBookNames: string[];
  worldInfoAllowlistEntryIds: number[];
  /** Which Modules' stored tracker history (including this Module's own) feed this Module's own generation context. Always contains a 'self' entry. */
  includeModules: TrackerModuleIncludeEntry[];
}

export interface TrackerModuleInjectionSettings {
  includeLastXMessages: number;
  embedRole: 'user' | 'assistant' | 'system';
  embedAsCharacter: boolean;
  snapshotHeader: string;
  transformPreset: string;
  transformPresets: Record<string, EmbedSnapshotRegexTransformPreset>;
}

export interface TrackerModule {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
  auto: TrackerModuleAutoSettings;
  schema: TrackerModuleSchemaSettings;
  prompts: TrackerModulePromptSettings;
  systemPrompt: TrackerModuleSystemPromptSettings;
  connection: TrackerModuleConnectionSettings;
  generation: TrackerModuleGenerationSettings;
  injection: TrackerModuleInjectionSettings;
}

export interface ExtensionSettings {
  version: string;
  formatVersion: string;
  modules: TrackerModule[];
  debugLogging: boolean;
}

export interface TrackerModuleSettings extends ExtensionSettings {
  /** Controls whether tracker generation follows the live host connection or a pinned saved profile. */
  connectionSource: TrackerConnectionSource;
  profileId: string;
  trackerSystemPromptMode: TrackerSystemPromptMode;
  trackerSystemPromptSavedName: string;
  maxResponseToken: number;
  /** Standalone auto-mode on/off flag, independent of `autoModeDirection`. Mirrors `module.auto.enabled`. */
  autoModeEnabled: boolean;
  /** Auto-mode trigger direction, persisted even while `autoModeEnabled` is false. Mirrors `module.auto.direction`. */
  autoModeDirection: TrackerModuleAutoDirection;

  /** When enabled, zTracker generates the tracker in smaller parts, sequentially. */
  sequentialPartGeneration: boolean;

  schemaPreset: string;
  schemaPresets: Record<string, Schema>;
  prompt: string;
  /** Minimum 0-indexed message threshold before tracker generation is allowed. 0 disables the guard. */
  skipFirstXMessages: number;
  includeLastXMessages: number; // 0 means all messages
  /** This Module's generation include list (self plus any chained Modules). See `TrackerModuleIncludeEntry`. */
  includeModules: TrackerModuleIncludeEntry[];
  /** When true, tracker generation omits character-card prompt fields such as description, personality, and scenario. */
  skipCharacterCardInTrackerGeneration: boolean;
  /** Controls how user/assistant chat turns are labeled before tracker-generation requests are sent. */
  trackerGenerationConversationRoleMode: TrackerGenerationConversationRoleMode;
  includeLastXZTrackerMessages: number; // 0 means none
  /**
   * Role to use when embedding zTracker snapshots into the generation chat array.
   * This only affects the generate_interceptor embedding, not tracker generation.
   */
  embedZTrackerRole: 'user' | 'assistant' | 'system';
  /** When true, embedded tracker snapshots use the snapshot header as a speaker name instead of a content prefix. */
  embedZTrackerAsCharacter: boolean;

  /**
   * Controls how embedded zTracker snapshots are transformed (regex find/replace).
   * This only affects embedding into the generation chat array.
   */
  /**
   * Header line used when embedding zTracker snapshots into the generation chat array.
   * Set to an empty string to omit the header entirely.
   */
  embedZTrackerSnapshotHeader: string;
  embedZTrackerSnapshotTransformPreset: string;
  embedZTrackerSnapshotTransformPresets: Record<string, EmbedSnapshotRegexTransformPreset>;
  promptEngineeringMode: PromptEngineeringMode;
  promptJson: string;
  promptXml: string;
  promptToon: string;

  /**
   * Controls what World Info is included in tracker-only generations.
   * - include_all: use normal SillyTavern prompt building (default)
   * - exclude_all: omit all World Info sources
   * - allowlist: omit World Info during prompt build, then inject only allowlisted World Info books
   */
  trackerWorldInfoPolicyMode: TrackerWorldInfoPolicyMode;
  /**
   * World Info (lorebook) names to allow during tracker generation when mode=allowlist.
   * Matching is case-insensitive.
   */
  trackerWorldInfoAllowlistBookNames: string[];
  /**
   * World Info entry UIDs to allow during tracker generation when mode=allowlist.
   * These are the numeric `uid` values on WI entries.
   */
  trackerWorldInfoAllowlistEntryIds: number[];
}

export const DEFAULT_EMBED_SNAPSHOT_HEADER = 'Tracker:';

/** Small, schema-agnostic starting prompt used by the generic placeholder Module builder ("Add Module" and the legacy-upgrade base) - deliberately distinct from any shipped starter template's own content, which lives entirely under templates/modules/*.json. */
export const PLACEHOLDER_PROMPT = `You are a tracker assistant. Update this tracker's fields based on the latest message and any previous tracker snapshot, keeping entries short and specific. Edit this prompt and the schema below to describe your own tracker's task.`;

export const ZTRACKER_SYSTEM_PROMPT_PRESET_VERSION = '1.3.1';
export const ZTRACKER_SYSTEM_PROMPT_PRESET_NAME = `zTracker-${ZTRACKER_SYSTEM_PROMPT_PRESET_VERSION}`;

export const ZTRACKER_SYSTEM_PROMPT_TEXT = `You are a structured data extraction assistant. Your task is to analyze conversations and produce a structured tracker update that conforms to a provided schema and requested output format.

Rules:
- Output ONLY valid structured data matching the provided schema. No narration, no markdown unless instructed.
- Fill every field. Use conversation context to infer values not explicitly stated.
- Prefer short, specific phrases over full sentences.
- Maintain consistency with any previous tracker snapshot in the conversation.
- Do NOT continue the conversation or roleplay. Only produce the requested data.
- Follow all detailed instructions provided later in this conversation.
- If a later message specifies an output format, wrapper, or schema rendering, follow those instructions exactly.`;

export const PLACEHOLDER_PROMPT_JSON = `You are a highly specialized AI assistant. Your SOLE purpose is to generate a single, valid JSON object that strictly adheres to the provided JSON schema.

**CRITICAL INSTRUCTIONS:**
1.  You MUST wrap the entire JSON object in a markdown code block (\`\`\`json\\n...\\n\`\`\`).
2.  Your response MUST NOT contain any explanatory text, comments, or any other content outside of this single code block.
3.  The JSON object inside the code block MUST be valid and conform to the schema.

**JSON SCHEMA TO FOLLOW:**
\`\`\`json
{{schema}}
\`\`\`

**EXAMPLE OF A PERFECT RESPONSE:**
\`\`\`json
{{example_response}}
\`\`\`
`;

export const PLACEHOLDER_PROMPT_XML = `You are a highly specialized AI assistant. Your SOLE purpose is to generate a single, valid XML structure that strictly adheres to the provided example.

**CRITICAL INSTRUCTIONS:**
1.  You MUST wrap the entire XML object in a markdown code block (\`\`\`xml\\n...\\n\`\`\`).
2.  Your response MUST NOT contain any explanatory text, comments, or any other content outside of this single code block.
3.  The XML object inside the code block MUST be valid.

**XML SCHEMA DESCRIPTION TO FOLLOW:**
\`\`\`xml
{{schema}}
\`\`\`

**EXAMPLE OF A PERFECT RESPONSE:**
\`\`\`xml
<root>
{{example_response}}
</root>
\`\`\`
`;

export const PREVIOUS_DEFAULT_PROMPT_TOON = `You are a highly specialized AI assistant. Your SOLE purpose is to generate a single, valid TOON structure that strictly adheres to the provided schema and example.

**CRITICAL INSTRUCTIONS:**
1.  You MUST wrap the entire TOON document in a markdown code block (\`\`\`toon\n...\n\`\`\`).
2.  Your response MUST NOT contain any explanatory text, comments, or any other content outside of this single code block.
3.  The TOON document inside the code block MUST be valid and preserve the full structure required by the schema.
4.  For uniform arrays of objects, preserve the tabular TOON layout shown in the example.

**TOON SCHEMA DESCRIPTION TO FOLLOW:**
\`\`\`toon
{{schema}}
\`\`\`

**EXAMPLE OF A PERFECT RESPONSE:**
\`\`\`toon
{{example_response}}
\`\`\`
`;

export const PLACEHOLDER_PROMPT_TOON = `You are a highly specialized AI assistant. Your SOLE purpose is to generate a single, valid TOON structure that strictly adheres to the provided schema and example.

Rules:
- Return exactly one \`\`\`toon code block and nothing else.
- Use TOON syntax only, not JSON or XML.
- Match the field names, nesting, and required fields from the schema.
- Keep every array count accurate: each \`[N]\` must match the number of items or rows.
- When the example shows a tabular array, reuse that header shape and keep rows tab-separated.
- Do not add wrapper keys unless the schema requires them.

Schema:
\`\`\`toon
{{schema}}
\`\`\`

Example:
\`\`\`toon
{{example_response}}
\`\`\`
`;

export const LEGACY_PROMPT_XML = `You are a highly specialized AI assistant. Your SOLE purpose is to generate a single, valid XML structure that strictly adheres to the provided example.

**CRITICAL INSTRUCTIONS:**
1.  You MUST wrap the entire XML object in a markdown code block (\`\`\`xml\\n...\\n\`\`\`).
2.  Your response MUST NOT contain any explanatory text, comments, or any other content outside of this single code block.
3.  The XML object inside the code block MUST be valid.

**JSON SCHEMA TO FOLLOW:**
\`\`\`json
{{schema}}
\`\`\`

**EXAMPLE OF A PERFECT RESPONSE:**
\`\`\`xml
<root>
{{example_response}}
</root>
\`\`\`
`;

export const PREVIOUS_DEFAULT_PROMPT_XML = `You are a highly specialized AI assistant. Your SOLE purpose is to generate a single, valid XML structure that strictly adheres to the provided example.

**CRITICAL INSTRUCTIONS:**
1.  You MUST wrap the entire XML object in a markdown code block (\`\`\`xml\\n...\\n\`\`\`).
2.  Your response MUST NOT contain any explanatory text, comments, or any other content outside of this single code block.
3.  The XML object inside the code block MUST be valid.

**XML SCHEMA DESCRIPTION TO FOLLOW:**
\`\`\`xml
<schema>
{{schema}}
</schema>
\`\`\`

**EXAMPLE OF A PERFECT RESPONSE:**
\`\`\`xml
<root>
{{example_response}}
</root>
\`\`\`
`;

// Matches the obsolete XML schema wrapper while tolerating saved line-ending and whitespace normalization.
function normalizePreviousXmlPromptTemplate(prompt: string): string {
  return prompt
    .replace(/```xml\s*\n<schema>\s*\n\{\{schema\}\}\s*\n<\/schema>\s*\n```/, '```xml\n{{schema}}\n```')
    .trim();
}

export const LEGACY_PROMPT_TOON = `You are a highly specialized AI assistant. Your SOLE purpose is to generate a single, valid TOON structure that strictly adheres to the provided schema and example.

**CRITICAL INSTRUCTIONS:**
1.  You MUST wrap the entire TOON document in a markdown code block (\`\`\`toon\n...\n\`\`\`).
2.  Your response MUST NOT contain any explanatory text, comments, or any other content outside of this single code block.
3.  The TOON document inside the code block MUST be valid and preserve the full structure required by the schema.
4.  For uniform arrays of objects, preserve the tabular TOON layout shown in the example.

**JSON SCHEMA TO FOLLOW:**
\`\`\`json
{{schema}}
\`\`\`

**EXAMPLE OF A PERFECT RESPONSE:**
\`\`\`toon
{{example_response}}
\`\`\`
`;

const DEFAULT_MAX_RESPONSE_TOKEN = 16000;
const DEFAULT_SKIP_FIRST_X_MESSAGES = 0;
const DEFAULT_INCLUDE_LAST_X_MESSAGES = 0;
const DEFAULT_INCLUDE_LAST_ZTRACKER_MESSAGES = 1;

/** Migrates legacy auto-mode values to the canonical SillyTavern enum value used at runtime. */
export function migrateLegacyAutoMode(settings: Record<string, any>): boolean {
  if ((settings.autoMode as unknown) !== 'input') {
    return false;
  }

  settings.autoMode = AutoModeOptions.INPUT;
  return true;
}

export function migrateLegacyPromptTemplates(settings: Record<string, any>): boolean {
  let changed = false;

  const promptXml = (settings.promptXml ?? '').trim();
  if (
    promptXml === LEGACY_PROMPT_XML.trim() ||
    promptXml === PREVIOUS_DEFAULT_PROMPT_XML.trim() ||
    normalizePreviousXmlPromptTemplate(promptXml) === PLACEHOLDER_PROMPT_XML.trim()
  ) {
    settings.promptXml = PLACEHOLDER_PROMPT_XML;
    changed = true;
  }

  const promptToon = (settings.promptToon ?? '').trim();
  if (promptToon === LEGACY_PROMPT_TOON.trim() || promptToon === PREVIOUS_DEFAULT_PROMPT_TOON.trim()) {
    settings.promptToon = PLACEHOLDER_PROMPT_TOON;
    changed = true;
  }

  return changed;
}

/** Repairs malformed saved schema presets whose `required` arrays were moved into `properties.required`. */
export function migrateCorruptedSchemaPresetRequiredMetadata(settings: Record<string, any>): boolean {
  let changed = false;
  const schemaPresets = settings.schemaPresets;
  if (!schemaPresets || typeof schemaPresets !== 'object') {
    return false;
  }

  for (const [key, preset] of Object.entries(schemaPresets as Record<string, Schema>)) {
    const repairedValue = repairCorruptedRequiredMetadata(preset.value);
    const originalSerialized = JSON.stringify(preset.value);
    const repairedSerialized = JSON.stringify(repairedValue);
    if (originalSerialized === repairedSerialized) {
      continue;
    }

    schemaPresets[key] = {
      ...preset,
      value: repairedValue as object,
    };
    changed = true;
  }

  return changed;
}

/** Repairs invalid persisted numeric settings so runtime requests never use impossible bounds. */
export function migrateInvalidNumericSettings(
  settings: Record<string, any>,
): boolean {
  let changed = false;

  const nextMaxResponseToken = sanitizeIntegerSetting(settings.maxResponseToken, {
    fallback: DEFAULT_MAX_RESPONSE_TOKEN,
    min: 1,
  });
  if (settings.maxResponseToken !== nextMaxResponseToken) {
    settings.maxResponseToken = nextMaxResponseToken;
    changed = true;
  }

  const nextSkipFirstXMessages = sanitizeIntegerSetting(settings.skipFirstXMessages, {
    fallback: DEFAULT_SKIP_FIRST_X_MESSAGES,
    min: 0,
  });
  if (settings.skipFirstXMessages !== nextSkipFirstXMessages) {
    settings.skipFirstXMessages = nextSkipFirstXMessages;
    changed = true;
  }

  const nextIncludeLastXMessages = sanitizeIntegerSetting(settings.includeLastXMessages, {
    fallback: DEFAULT_INCLUDE_LAST_X_MESSAGES,
    min: 0,
  });
  if (settings.includeLastXMessages !== nextIncludeLastXMessages) {
    settings.includeLastXMessages = nextIncludeLastXMessages;
    changed = true;
  }

  const nextIncludeLastXZTrackerMessages = sanitizeIntegerSetting(settings.includeLastXZTrackerMessages, {
    fallback: DEFAULT_INCLUDE_LAST_ZTRACKER_MESSAGES,
    min: 0,
  });
  if (settings.includeLastXZTrackerMessages !== nextIncludeLastXZTrackerMessages) {
    settings.includeLastXZTrackerMessages = nextIncludeLastXZTrackerMessages;
    changed = true;
  }

  return changed;
}

export const DEFAULT_SCHEMA_VALUE: object = {
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
        description: 'Character names',
      },
      description: 'List of character names present in scene',
    },
    characters: {
      type: 'array',
      'x-ztracker-dependsOn': ['charactersPresent'],
      'x-ztracker-idKey': 'name',
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
            description: 'How put-together/disheveled character appears',
          },
          postureAndInteraction: {
            type: 'string',
            description: "Character's physical positioning and interaction",
          },
        },
        required: ['name', 'hair', 'makeup', 'outfit', 'stateOfDress', 'postureAndInteraction'],
      },
      description: 'Array of character objects',
    },
  },
  required: ['time', 'location', 'weather', 'topics', 'charactersPresent', 'characters'],
};

export const DEFAULT_SCHEMA_HTML = `<div class="ztracker_default_mes_template">
    <!-- Main Scene Information -->
    <table>
        <tbody>
            <tr>
                <td>Time:</td>
                <td>{{data.time}}</td>
            </tr>
            <tr>
                <td>Location:</td>
                <td>{{data.location}}</td>
            </tr>
            <tr>
                <td>Weather:</td>
                <td>{{data.weather}}</td>
            </tr>
        </tbody>
    </table>

    <!-- Collapsible Detailed Tracker -->
    <details>
        <summary><span>Tracker Details</span></summary>
        <table>
            <tbody>
                <tr>
                    <td>Topics:</td>
                    <td>
                        <!-- Accessing nested object properties -->
                        {{data.topics.primaryTopic}}; {{data.topics.emotionalTone}}; {{data.topics.interactionTheme}}
                    </td>
                </tr>
                <tr>
                    <td>Present:</td>
                    <td>
                        <!-- Joining an array of strings. Assumes a 'join' helper. -->
                        {{join data.charactersPresent ', '}}
                    </td>
                </tr>
            </tbody>
        </table>

        <!-- Character Details Section -->
        <div class="mes_ztracker_characters">
            <!-- Looping through the array of character objects -->
            {{#each data.characters as |character|}}
            <hr>
            <strong>{{character.name}}:</strong><br>
            <table>
                <tbody>
                    <tr>
                        <td>Hair:</td>
                        <td>{{character.hair}}</td>
                    </tr>
                    <tr>
                        <td>Makeup:</td>
                        <td>{{character.makeup}}</td>
                    </tr>
                    <tr>
                        <td>Outfit:</td>
                        <td>{{character.outfit}}</td>
                    </tr>
                    <tr>
                        <td>State:</td>
                        <td>{{character.stateOfDress}}</td>
                    </tr>
                    <tr>
                        <td>Position:</td>
                        <td>{{character.postureAndInteraction}}</td>
                    </tr>
                </tbody>
            </table>
            {{/each}}
        </div>
    </details>
</div>
<hr>`;

const VERSION = '0.1.0';
const FORMAT_VERSION = 'F_2.0';

/** Minimal, genuinely working placeholder schema for the generic Module builder - one free-text field, distinct from any shipped starter template. */
export const PLACEHOLDER_SCHEMA_VALUE: object = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'CustomTracker',
  description: 'Starting point for a new tracker - edit this schema to describe what you want to track',
  type: 'object',
  properties: {
    notes: {
      type: 'string',
      description: 'Free-text notes for this tracker',
    },
  },
  required: ['notes'],
};

export const PLACEHOLDER_SCHEMA_HTML = `<div class="ztracker_default_mes_template">
    <strong>Notes:</strong> {{data.notes}}
</div>
<hr>`;

function createPlaceholderSchemaPresets(): Record<string, Schema> {
  return {
    default: {
      name: 'Default',
      value: PLACEHOLDER_SCHEMA_VALUE,
      html: PLACEHOLDER_SCHEMA_HTML,
    },
  };
}

function createDefaultEmbedSnapshotTransformPresets(): Record<string, EmbedSnapshotRegexTransformPreset> {
  return {
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
      pattern: '^[\\t ]*\"([^\"]+)\"[\\t ]*:[\\t ]*(.*?)(?:,)?[\\t ]*$',
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
  };
}

function cloneSettingsValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Builds a small, genuinely working generic placeholder Module (one free-text schema field, short
 * generic prompt) - used by "Add Module" and as the legacy-upgrade overlay base. Deliberately
 * distinct from any shipped starter template's own content, which lives entirely under
 * templates/modules/*.json and is never constructed here.
 */
export function createDefaultTrackerModule(options: Partial<Pick<TrackerModule, 'id' | 'name' | 'order'>> = {}): TrackerModule {
  return {
    id: options.id ?? DEFAULT_MODULE_ID,
    name: options.name ?? 'New Tracker',
    enabled: true,
    order: options.order ?? 0,
    auto: {
      enabled: false,
      direction: AutoModeOptions.BOTH,
    },
    schema: {
      preset: 'default',
      presets: createPlaceholderSchemaPresets(),
    },
    prompts: {
      prompt: PLACEHOLDER_PROMPT,
      promptEngineeringMode: PromptEngineeringMode.NATIVE,
      promptJson: PLACEHOLDER_PROMPT_JSON,
      promptXml: PLACEHOLDER_PROMPT_XML,
      promptToon: PLACEHOLDER_PROMPT_TOON,
    },
    systemPrompt: {
      mode: 'profile',
      savedName: '',
      content: '',
    },
    connection: {
      source: 'saved',
      profileId: '',
    },
    generation: {
      mode: 'full',
      maxResponseToken: DEFAULT_MAX_RESPONSE_TOKEN,
      skipFirstXMessages: DEFAULT_SKIP_FIRST_X_MESSAGES,
      includeLastXMessages: DEFAULT_INCLUDE_LAST_X_MESSAGES,
      skipCharacterCardInTrackerGeneration: false,
      conversationRoleMode: 'preserve',
      worldInfoPolicyMode: TrackerWorldInfoPolicyMode.INCLUDE_ALL,
      worldInfoAllowlistBookNames: [],
      worldInfoAllowlistEntryIds: [],
      includeModules: [{ target: 'self', count: DEFAULT_INCLUDE_LAST_ZTRACKER_MESSAGES }],
    },
    injection: {
      includeLastXMessages: DEFAULT_INCLUDE_LAST_ZTRACKER_MESSAGES,
      embedRole: 'user',
      embedAsCharacter: false,
      snapshotHeader: DEFAULT_EMBED_SNAPSHOT_HEADER,
      transformPreset: 'default',
      transformPresets: createDefaultEmbedSnapshotTransformPresets(),
    },
  };
}

export function createTrackerModuleFromLegacySettings(
  settings: Partial<TrackerModuleSettings>,
  options: Partial<Pick<TrackerModule, 'id' | 'name' | 'order'>> = {},
): TrackerModule {
  const module = createDefaultTrackerModule(options);
  module.connection.source = settings.connectionSource ?? module.connection.source;
  module.connection.profileId = settings.profileId ?? module.connection.profileId;
  module.systemPrompt.mode = settings.trackerSystemPromptMode ?? module.systemPrompt.mode;
  module.systemPrompt.savedName = settings.trackerSystemPromptSavedName ?? module.systemPrompt.savedName;
  module.generation.maxResponseToken = settings.maxResponseToken ?? module.generation.maxResponseToken;
  module.generation.mode = settings.sequentialPartGeneration ? 'sequential-parts' : 'full';
  module.generation.skipFirstXMessages = settings.skipFirstXMessages ?? module.generation.skipFirstXMessages;
  module.generation.includeLastXMessages = settings.includeLastXMessages ?? module.generation.includeLastXMessages;
  module.generation.skipCharacterCardInTrackerGeneration =
    settings.skipCharacterCardInTrackerGeneration ?? module.generation.skipCharacterCardInTrackerGeneration;
  module.generation.conversationRoleMode =
    settings.trackerGenerationConversationRoleMode ?? module.generation.conversationRoleMode;
  module.generation.worldInfoPolicyMode = settings.trackerWorldInfoPolicyMode ?? module.generation.worldInfoPolicyMode;
  module.generation.worldInfoAllowlistBookNames = cloneSettingsValue(
    settings.trackerWorldInfoAllowlistBookNames ?? module.generation.worldInfoAllowlistBookNames,
  );
  module.generation.worldInfoAllowlistEntryIds = cloneSettingsValue(
    settings.trackerWorldInfoAllowlistEntryIds ?? module.generation.worldInfoAllowlistEntryIds,
  );
  // Reads the raw top-level legacy `autoMode` field from very old pre-Module settings JSON.
  // Not part of `TrackerModuleSettings` (superseded by `autoModeEnabled`/`autoModeDirection`), so
  // it is read here as an untyped legacy property rather than a typed field.
  const legacyAutoMode = (settings as Record<string, unknown>).autoMode as AutoModeOptions | undefined
    ?? (module.auto.enabled ? module.auto.direction : AutoModeOptions.NONE);
  module.auto.enabled = legacyAutoMode !== AutoModeOptions.NONE;
  if (legacyAutoMode !== AutoModeOptions.NONE) {
    module.auto.direction = legacyAutoMode;
  }
  module.schema.preset = settings.schemaPreset ?? module.schema.preset;
  module.schema.presets = cloneSettingsValue(settings.schemaPresets ?? module.schema.presets);
  module.prompts.prompt = settings.prompt ?? module.prompts.prompt;
  module.prompts.promptEngineeringMode = settings.promptEngineeringMode ?? module.prompts.promptEngineeringMode;
  module.prompts.promptJson = settings.promptJson ?? module.prompts.promptJson;
  module.prompts.promptXml = settings.promptXml ?? module.prompts.promptXml;
  module.prompts.promptToon = settings.promptToon ?? module.prompts.promptToon;
  module.injection.includeLastXMessages =
    settings.includeLastXZTrackerMessages ?? module.injection.includeLastXMessages;
  module.injection.embedRole = settings.embedZTrackerRole ?? module.injection.embedRole;
  module.injection.embedAsCharacter = settings.embedZTrackerAsCharacter ?? module.injection.embedAsCharacter;
  module.injection.snapshotHeader = settings.embedZTrackerSnapshotHeader ?? module.injection.snapshotHeader;
  module.injection.transformPreset = settings.embedZTrackerSnapshotTransformPreset ?? module.injection.transformPreset;
  module.injection.transformPresets = cloneSettingsValue(
    settings.embedZTrackerSnapshotTransformPresets ?? module.injection.transformPresets,
  );
  // Preserve prior self-history behavior: seed the mandatory self entry from the same legacy value
  // that used to double as both self-history and downstream-injection count.
  module.generation.includeModules = [{ target: 'self', count: module.injection.includeLastXMessages }];
  return module;
}

export function getTrackerModule(settings: ExtensionSettings, moduleId = DEFAULT_MODULE_ID): TrackerModule {
  return settings.modules?.find((module) => module.id === moduleId)
    ?? settings.modules?.[0]
    ?? createTrackerModuleFromLegacySettings(settings, { id: DEFAULT_MODULE_ID, name: 'Scene Tracker', order: 0 });
}

export function getOrderedTrackerModules(settings: ExtensionSettings, options: { includeDisabled?: boolean } = {}): TrackerModule[] {
  const modules = settings.modules?.length
    ? settings.modules
    : [getTrackerModule(settings, DEFAULT_MODULE_ID)];
  return [...modules]
    .filter((module) => options.includeDisabled || module.enabled)
    .sort((left, right) => left.order - right.order);
}

export function getSettingsForTrackerModule(settings: ExtensionSettings, moduleId = DEFAULT_MODULE_ID): TrackerModuleSettings {
  const module = getTrackerModule(settings, moduleId);
  return {
    ...settings,
    connectionSource: module.connection.source,
    profileId: module.connection.profileId,
    trackerSystemPromptMode: module.systemPrompt.mode,
    trackerSystemPromptSavedName: module.systemPrompt.savedName,
    maxResponseToken: module.generation.maxResponseToken,
    autoModeEnabled: module.auto.enabled,
    autoModeDirection: module.auto.direction,
    sequentialPartGeneration: module.generation.mode === 'sequential-parts',
    schemaPreset: module.schema.preset,
    schemaPresets: module.schema.presets,
    prompt: module.prompts.prompt,
    skipFirstXMessages: module.generation.skipFirstXMessages,
    includeLastXMessages: module.generation.includeLastXMessages,
    includeModules: module.generation.includeModules,
    skipCharacterCardInTrackerGeneration: module.generation.skipCharacterCardInTrackerGeneration,
    trackerGenerationConversationRoleMode: module.generation.conversationRoleMode,
    includeLastXZTrackerMessages: module.injection.includeLastXMessages,
    embedZTrackerRole: module.injection.embedRole,
    embedZTrackerAsCharacter: module.injection.embedAsCharacter,
    embedZTrackerSnapshotHeader: module.injection.snapshotHeader,
    embedZTrackerSnapshotTransformPreset: module.injection.transformPreset,
    embedZTrackerSnapshotTransformPresets: module.injection.transformPresets,
    promptEngineeringMode: module.prompts.promptEngineeringMode,
    promptJson: module.prompts.promptJson,
    promptXml: module.prompts.promptXml,
    promptToon: module.prompts.promptToon,
    trackerWorldInfoPolicyMode: module.generation.worldInfoPolicyMode,
    trackerWorldInfoAllowlistBookNames: module.generation.worldInfoAllowlistBookNames,
    trackerWorldInfoAllowlistEntryIds: module.generation.worldInfoAllowlistEntryIds,
  };
}

export function createTrackerModuleId(existingModules: Array<Pick<TrackerModule, 'id'>>, base = 'module'): string {
  const usedIds = new Set(existingModules.map((module) => module.id));
  const normalizedBase = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'module';
  let id = normalizedBase;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${normalizedBase}-${suffix}`;
    suffix += 1;
  }
  return id;
}

export function applySettingsToTrackerModule(module: TrackerModule, settings: TrackerModuleSettings): void {
  module.connection.source = settings.connectionSource;
  module.connection.profileId = settings.profileId;
  module.systemPrompt.mode = settings.trackerSystemPromptMode;
  module.systemPrompt.savedName = settings.trackerSystemPromptSavedName;
  module.generation.maxResponseToken = settings.maxResponseToken;
  module.auto.enabled = settings.autoModeEnabled;
  module.auto.direction = settings.autoModeDirection;
  module.generation.mode = settings.sequentialPartGeneration ? 'sequential-parts' : 'full';
  module.schema.preset = settings.schemaPreset;
  module.schema.presets = cloneSettingsValue(settings.schemaPresets);
  module.prompts.prompt = settings.prompt;
  module.prompts.promptEngineeringMode = settings.promptEngineeringMode;
  module.prompts.promptJson = settings.promptJson;
  module.prompts.promptXml = settings.promptXml;
  module.prompts.promptToon = settings.promptToon;
  module.generation.skipFirstXMessages = settings.skipFirstXMessages;
  module.generation.includeLastXMessages = settings.includeLastXMessages;
  module.generation.includeModules = cloneSettingsValue(settings.includeModules);
  module.generation.skipCharacterCardInTrackerGeneration = settings.skipCharacterCardInTrackerGeneration;
  module.generation.conversationRoleMode = settings.trackerGenerationConversationRoleMode;
  module.injection.includeLastXMessages = settings.includeLastXZTrackerMessages;
  module.injection.embedRole = settings.embedZTrackerRole;
  module.injection.embedAsCharacter = settings.embedZTrackerAsCharacter;
  module.injection.snapshotHeader = settings.embedZTrackerSnapshotHeader;
  module.injection.transformPreset = settings.embedZTrackerSnapshotTransformPreset;
  module.injection.transformPresets = cloneSettingsValue(settings.embedZTrackerSnapshotTransformPresets);
  module.generation.worldInfoPolicyMode = settings.trackerWorldInfoPolicyMode;
  module.generation.worldInfoAllowlistBookNames = cloneSettingsValue(settings.trackerWorldInfoAllowlistBookNames);
  module.generation.worldInfoAllowlistEntryIds = cloneSettingsValue(settings.trackerWorldInfoAllowlistEntryIds);
}

/** Removes any include-list entry across all Modules that references a deleted Module id, leaving other entries untouched. */
export function pruneTrackerModuleIncludeReferences(modules: TrackerModule[], deletedModuleId: string): void {
  for (const module of modules) {
    module.generation.includeModules = (module.generation.includeModules ?? [])
      .filter((entry) => entry.target !== deletedModuleId);
  }
}

/**
 * Normalizes an arbitrary (possibly corrupted, hand-authored, or imported) include-list value
 * into a well-formed `TrackerModuleIncludeEntry[]`: always exactly one `self` entry (using its
 * own count when present and valid, otherwise `fallbackSelfCount`), plus any chained entries
 * with a non-empty string target and a sanitized non-negative integer count. Shared by the
 * legacy self-entry migration and Module import so both agree on what a valid list looks like.
 */
export function normalizeTrackerModuleIncludeList(
  includeModules: unknown,
  fallbackSelfCount: number,
): TrackerModuleIncludeEntry[] {
  const rawEntries = Array.isArray(includeModules) ? includeModules : [];
  const isEntryLike = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

  const existingSelf = rawEntries.find((entry) => isEntryLike(entry) && entry.target === 'self');
  const selfCount = sanitizeIntegerSetting(isEntryLike(existingSelf) ? existingSelf.count : undefined, {
    fallback: fallbackSelfCount,
    min: 0,
  });

  const chainedEntries = rawEntries
    .filter(
      (entry): entry is Record<string, unknown> =>
        isEntryLike(entry) && typeof entry.target === 'string' && entry.target !== 'self' && entry.target.trim().length > 0,
    )
    .map((entry) => ({
      target: entry.target as string,
      count: sanitizeIntegerSetting(entry.count, { fallback: 0, min: 0 }),
    }));

  return [{ target: 'self', count: selfCount }, ...chainedEntries];
}

export function purgeTrackerModuleDataFromChat(chat: Array<{ extra?: Record<string, any> }> | undefined, moduleId: string): number {
  if (!Array.isArray(chat)) {
    return 0;
  }

  let purgedCount = 0;
  for (const message of chat) {
    const modules = message?.extra?.[EXTENSION_KEY]?.byId;
    if (modules && typeof modules === 'object' && !Array.isArray(modules) && Object.prototype.hasOwnProperty.call(modules, moduleId)) {
      delete modules[moduleId];
      purgedCount += 1;
    }
  }
  return purgedCount;
}

/** Seeds the Module collection from legacy flat settings during the one-way format upgrade. */
export function migrateLegacySettingsToModules(settings: ExtensionSettings): boolean {
  if (settings.formatVersion === FORMAT_VERSION && Array.isArray(settings.modules) && settings.modules.length > 0) {
    return false;
  }

  settings.modules = [createTrackerModuleFromLegacySettings(settings, { id: DEFAULT_MODULE_ID, name: 'Default', order: 0 })];
  settings.formatVersion = FORMAT_VERSION;
  return true;
}

/**
 * Migrates a Module's legacy single `auto.mode` field into the independent `auto.enabled` +
 * `auto.direction` fields. `NONE` migrates to `enabled: false, direction: BOTH` (no prior
 * direction to recover, so the broadest default is used). Any other mode migrates to
 * `enabled: true, direction: <mode>`. Runs after `migrateLegacySettingsToModules` (it requires
 * `settings.modules` to already exist) and is idempotent: a Module whose stored `auto` no longer
 * carries a `mode` field is left untouched.
 */
export function migrateTrackerModuleAutoSettings(settings: ExtensionSettings): boolean {
  let changed = false;
  for (const module of settings.modules ?? []) {
    // Defends against missing/malformed `auto` the same way sibling migrations defend against
    // missing `generation`/`includeModules` (e.g. hand-edited or corrupted imports), instead of
    // assuming `module.auto` is always an object.
    const legacyAuto = module.auto as unknown as { mode?: AutoModeOptions } | undefined;
    if (legacyAuto?.mode === undefined) {
      continue;
    }

    const legacyMode = legacyAuto.mode;
    module.auto = {
      enabled: legacyMode !== AutoModeOptions.NONE,
      direction: legacyMode !== AutoModeOptions.NONE ? legacyMode : AutoModeOptions.BOTH,
    };
    changed = true;
  }
  return changed;
}

/**
 * Seeds each Module's generation include list with a self entry the first time this version
 * runs, copying the count from that Module's legacy `injection.includeLastXMessages` value so
 * upgrading users see unchanged self-history behavior. Runs after `migrateLegacySettingsToModules`
 * (it requires `settings.modules` to already exist) and is idempotent: a Module that already has
 * a self entry is left untouched. Also repairs a Module whose stored `includeModules` is missing,
 * malformed, or non-empty but lacking the mandatory self entry (e.g. from a hand-edited import),
 * since the include-list UI and generation assembly both require self to always be present.
 */
export function migrateTrackerModuleIncludeLists(settings: ExtensionSettings): boolean {
  let changed = false;
  for (const module of settings.modules ?? []) {
    const hasSelfEntry = Array.isArray(module.generation?.includeModules)
      && module.generation.includeModules.some((entry) => entry?.target === 'self');
    if (hasSelfEntry) {
      continue;
    }
    module.generation.includeModules = normalizeTrackerModuleIncludeList(
      module.generation.includeModules,
      module.injection.includeLastXMessages,
    );
    changed = true;
  }
  return changed;
}

/**
 * Backfills `systemPrompt.content` for a Module persisted before that field existed (an
 * already-migrated Default Module, or a Plot Log/Plot Steer imported from an older template
 * file). Runs after `migrateLegacySettingsToModules` (it requires `settings.modules` to already
 * exist) and is idempotent: a Module that already stores a string `content` (including an empty
 * string) is left untouched.
 */
export function migrateTrackerModuleSystemPromptContent(settings: ExtensionSettings): boolean {
  let changed = false;
  for (const module of settings.modules ?? []) {
    if (!module.systemPrompt || typeof (module.systemPrompt as { content?: unknown }).content === 'string') {
      continue;
    }
    module.systemPrompt.content = '';
    changed = true;
  }
  return changed;
}

// No synchronous default Module: a fresh install's only Module content comes from seeding the
// shipped starter templates (see main()'s fresh-install branch in src/index.tsx). If every
// template fails to seed, getTrackerModule()/getOrderedTrackerModules() already recover a
// transient default Module at read time - see those functions' fallback.
export const defaultSettings: ExtensionSettings = {
  version: VERSION,
  formatVersion: FORMAT_VERSION,
  modules: [],
  debugLogging: false,
};
