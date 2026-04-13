import { FC } from 'react';
import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import { PromptEngineeringMode } from '../../config.js';
import type { SettingsSectionProps } from './settings-shared.js';

// Renders the core tracker-generation behavior controls that affect timing, prompt mode, and context size.
export const GenerationBehaviorSection: FC<SettingsSectionProps> = ({ settings, updateAndRefresh }) => {
  return (
    <>
      <div className="setting-row">
        <label title="Controls when zTracker automatically generates trackers: never, on incoming assistant messages, on your inputs, or both.">
          Auto Mode
        </label>
        <select
          className="text_pole"
          title="Controls when zTracker automatically generates trackers: never, on incoming assistant messages, on your inputs, or both."
          value={settings.autoMode}
          onChange={(e) =>
            updateAndRefresh((s) => {
              s.autoMode = e.target.value as AutoModeOptions;
            })
          }
        >
          <option value="none">None</option>
          <option value="responses">Process responses</option>
          <option value="inputs">Process inputs</option>
          <option value="both">Process both</option>
        </select>
      </div>

      <div className="setting-row">
        <label title="When enabled, zTracker generates tracker fields sequentially (smaller requests) and enables per-part regeneration controls.">
          Sequential generation
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={!!settings.sequentialPartGeneration}
            onChange={(e) =>
              updateAndRefresh((s) => {
                s.sequentialPartGeneration = e.target.checked;
              })
            }
          />
          Generate tracker parts one-by-one
        </label>
      </div>

      <div className="setting-row">
        <label title="Chooses how zTracker asks the model for structured output: use the native API format, or use JSON/XML/TOON prompt-engineering templates.">
          Prompt Engineering
        </label>
        <select
          className="text_pole"
          title="Chooses how zTracker asks the model for structured output: use the native API format, or use JSON/XML/TOON prompt-engineering templates."
          value={settings.promptEngineeringMode}
          onChange={(e) =>
            updateAndRefresh((s) => {
              s.promptEngineeringMode = e.target.value as PromptEngineeringMode;
            })
          }
        >
          <option value="native">Native API</option>
          <option value="json">Prompt Engineering (JSON)</option>
          <option value="xml">Prompt Engineering (XML)</option>
          <option value="toon">Prompt Engineering (TOON)</option>
        </select>
      </div>

      <div className="setting-row">
        <label title="Max tokens zTracker requests for the model response during tracker generation.">Max Response Tokens</label>
        <input
          type="number"
          className="text_pole"
          min="1"
          step="1"
          title="Max tokens zTracker requests for the model response during tracker generation."
          value={settings.maxResponseToken}
          onChange={(e) =>
            updateAndRefresh((s) => {
              s.maxResponseToken = parseInt(e.target.value) || 0;
            })
          }
        />
      </div>

      <div className="setting-row">
        <label title="Minimum number of messages before zTracker starts generating trackers. 0 disables this threshold.">
          Skip First X Messages
        </label>
        <input
          type="number"
          className="text_pole"
          min="0"
          step="1"
          title="Minimum number of messages before zTracker starts generating trackers. 0 disables this threshold."
          value={settings.skipFirstXMessages}
          onChange={(e) =>
            updateAndRefresh((s) => {
              s.skipFirstXMessages = parseInt(e.target.value) || 0;
            })
          }
        />
      </div>

      <div className="setting-row">
        <label title="How many recent chat messages to include when generating a tracker. 0 includes all messages; 1 includes only the last message.">
          Include Last X Messages (0 means all, 1 means last)
        </label>
        <input
          type="number"
          className="text_pole"
          min="0"
          step="1"
          title="How many recent chat messages to include when generating a tracker. 0 includes all messages; 1 includes only the last message."
          value={settings.includeLastXMessages}
          onChange={(e) =>
            updateAndRefresh((s) => {
              s.includeLastXMessages = parseInt(e.target.value) || 0;
            })
          }
        />
      </div>

      <div className="setting-row">
        <label title="When enabled, tracker generation ignores character-card prompt fields such as description, personality, and scenario.">
          Skip character card in tracker generation
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={settings.skipCharacterCardInTrackerGeneration ?? false}
            onChange={(e) =>
              updateAndRefresh((s) => {
                s.skipCharacterCardInTrackerGeneration = e.target.checked;
              })
            }
          />
          Ignore character-card prompt fields
        </label>
      </div>
    </>
  );
};