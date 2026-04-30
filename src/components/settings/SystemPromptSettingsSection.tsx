import { FC } from 'react';
import { STButton, PresetItem } from 'sillytavern-utils-lib/components/react';
import { ExtensionSettings, ZTRACKER_SYSTEM_PROMPT_PRESET_NAME } from '../../config.js';
import type { SettingsUpdateAndRefresh } from './settings-shared.js';

// Contains the tracker-only system prompt selector and the warnings tied to that configuration.
export const SystemPromptSettingsSection: FC<{
  settings: ExtensionSettings;
  updateAndRefresh: SettingsUpdateAndRefresh;
  systemPromptItems: PresetItem[];
  refreshSystemPromptState: () => void;
  showMissingSavedSystemPromptWarning: boolean;
  showSharedSystemPromptWarning: boolean;
  currentGlobalSystemPromptName?: string;
}> = ({
  settings,
  updateAndRefresh,
  systemPromptItems,
  refreshSystemPromptState,
  showMissingSavedSystemPromptWarning,
  showSharedSystemPromptWarning,
  currentGlobalSystemPromptName,
}) => {
  return (
    <div className="setting-row">
      <label title="Choose whether zTracker uses SillyTavern's currently active system prompt or a specific saved SillyTavern system prompt.">
        System Prompt Source
      </label>
      <select
        className="text_pole"
        title="Choose whether zTracker uses SillyTavern's currently active system prompt or a specific saved SillyTavern system prompt."
        value={settings.trackerSystemPromptMode}
        onChange={(e) =>
          updateAndRefresh((s) => {
            const mode = e.target.value as ExtensionSettings['trackerSystemPromptMode'];
            s.trackerSystemPromptMode = mode;
            if (mode === 'saved' && !s.trackerSystemPromptSavedName) {
              s.trackerSystemPromptSavedName = ZTRACKER_SYSTEM_PROMPT_PRESET_NAME;
            }
          })
        }
      >
        <option value="profile">From active SillyTavern presets</option>
        <option value="selected">From connection profile presets</option>
        <option value="saved">From specific saved system prompt</option>
      </select>

      {settings.trackerSystemPromptMode === 'saved' && (
        <>
          <label title="Which saved SillyTavern system prompt zTracker should use for tracker generation.">System Prompt</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {systemPromptItems.length > 0 ? (
              <select
                className="text_pole"
                title="Which saved SillyTavern system prompt zTracker should use for tracker generation."
                value={settings.trackerSystemPromptSavedName}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.trackerSystemPromptSavedName = e.target.value;
                  })
                }
              >
                {systemPromptItems.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="text_pole"
                title="Fallback input used if the current SillyTavern build does not expose the system prompt list."
                value={settings.trackerSystemPromptSavedName}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.trackerSystemPromptSavedName = e.target.value;
                  })
                }
                placeholder={ZTRACKER_SYSTEM_PROMPT_PRESET_NAME}
              />
            )}
            <STButton
              className="fa-solid fa-rotate"
              title="Refresh the saved prompt list and current global prompt warning"
              onClick={refreshSystemPromptState}
            />
          </div>
          <small>
            Edit prompts in SillyTavern&apos;s System Prompt manager. The shipped &quot;{ZTRACKER_SYSTEM_PROMPT_PRESET_NAME}&quot; preset is optimized for tracker generation. Older zTracker prompt presets are left in place so you can remove them manually if they are no longer needed. Click refresh after changing prompts elsewhere in SillyTavern.
          </small>
          {showMissingSavedSystemPromptWarning && (
            <small style={{ color: 'var(--warning-color, #f0ad4e)' }}>
              Warning: the selected saved system prompt no longer exists. Refresh the list and choose another prompt before generating trackers.
            </small>
          )}
          {showSharedSystemPromptWarning && (
            <small style={{ color: 'var(--warning-color, #f0ad4e)' }}>
              Warning: the selected tracker system prompt matches SillyTavern&apos;s active global system prompt
              {currentGlobalSystemPromptName ? ` (${currentGlobalSystemPromptName})` : ''}. Normal chat generations may use it too. Keep a separate chat prompt selected in SillyTavern if this prompt should stay tracker-only.
            </small>
          )}
        </>
      )}
    </div>
  );
};