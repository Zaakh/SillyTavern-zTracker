import { FC } from 'react';
import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import type { TrackerGenerationConversationRoleMode } from '../../config.js';
import { sanitizeIntegerSetting } from '../../settings-numeric.js';
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
          <option value={AutoModeOptions.NONE}>None</option>
          <option value={AutoModeOptions.RESPONSES}>Process responses</option>
          <option value={AutoModeOptions.INPUT}>Process inputs</option>
          <option value={AutoModeOptions.BOTH}>Process both</option>
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
              s.maxResponseToken = sanitizeIntegerSetting(e.target.value, { fallback: 1, min: 1 });
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
              s.skipFirstXMessages = sanitizeIntegerSetting(e.target.value, { fallback: 0, min: 0 });
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
              s.includeLastXMessages = sanitizeIntegerSetting(e.target.value, { fallback: 0, min: 0 });
            })
          }
        />
      </div>

      <div className="setting-row">
        <label title="Controls how recent chat messages are labeled during tracker generation. This only affects zTracker's tracker request, not normal chat generation or tracker injection.">
          Conversation role handling
        </label>
        <select
          className="text_pole"
          title="Controls how recent chat messages are labeled during tracker generation. This only affects zTracker's tracker request, not normal chat generation or tracker injection."
          value={settings.trackerGenerationConversationRoleMode ?? 'preserve'}
          onChange={(e) =>
            updateAndRefresh((s) => {
              s.trackerGenerationConversationRoleMode = e.target.value as TrackerGenerationConversationRoleMode;
            })
          }
        >
          <option value="preserve">Preserve user and assistant roles</option>
          <option value="all_assistant">Treat all chat turns as assistant</option>
        </select>
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