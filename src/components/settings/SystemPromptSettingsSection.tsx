import { FC } from 'react';
import { STButton, PresetItem } from 'sillytavern-utils-lib/components/react';
import { TrackerModuleSettings } from '../../config.js';
import type { SettingsUpdateAndRefresh } from './settings-shared.js';

const SYSTEM_PROMPT_SOURCE_TITLE =
  "Choose which system prompt zTracker uses: SillyTavern's currently active one, the one recorded in this Module's saved connection profile, or a specific saved SillyTavern system prompt. This only selects the system prompt - instruct, context and sampler presets follow the Module's connection.";

// Contains the tracker-only system prompt selector and the warnings tied to that configuration.
export const SystemPromptSettingsSection: FC<{
  settings: TrackerModuleSettings;
  updateAndRefresh: SettingsUpdateAndRefresh;
  systemPromptItems: PresetItem[];
  refreshSystemPromptState: () => void;
  showMissingSavedSystemPromptWarning: boolean;
  showSharedSystemPromptWarning: boolean;
  showRecreateSystemPromptAction: boolean;
  recreateModuleSystemPromptPreset: () => void | Promise<void>;
  isRecreatingSystemPrompt: boolean;
  currentGlobalSystemPromptName?: string;
}> = ({
  settings,
  updateAndRefresh,
  systemPromptItems,
  refreshSystemPromptState,
  showMissingSavedSystemPromptWarning,
  showSharedSystemPromptWarning,
  showRecreateSystemPromptAction,
  recreateModuleSystemPromptPreset,
  isRecreatingSystemPrompt,
  currentGlobalSystemPromptName,
}) => {
  return (
    <div className="setting-row">
      <label title={SYSTEM_PROMPT_SOURCE_TITLE}>System Prompt Source</label>
      <select
        className="text_pole"
        title={SYSTEM_PROMPT_SOURCE_TITLE}
        value={settings.trackerSystemPromptMode}
        onChange={(e) =>
          updateAndRefresh((s) => {
            s.trackerSystemPromptMode = e.target.value as TrackerModuleSettings['trackerSystemPromptMode'];
          })
        }
      >
        <option value="profile">From active SillyTavern presets</option>
        <option value="selected" title="Uses only the system prompt recorded in this Module's saved connection profile. Instruct, context and sampler presets always follow the Module's connection, not this setting.">
          From connection profile presets
        </option>
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
                placeholder="e.g. zTracker-SceneTracker-1.1"
              />
            )}
            <STButton
              type="button"
              className="ztracker-btn-secondary"
              title="Refresh the saved prompt list and current global prompt warning"
              onClick={refreshSystemPromptState}
            >
              <i className="fa-solid fa-rotate" aria-hidden="true"></i> Refresh
            </STButton>
          </div>
          <small title="Each Module auto-installs its own saved system prompt from its systemPrompt content the first time it is created or imported. Older zTracker prompt presets are left in place so you can remove them manually. Click refresh after changing prompts elsewhere in SillyTavern.">
            Each Module installs its own saved prompt; pick it here, or use Recreate prompt if it is missing.
          </small>
          {showMissingSavedSystemPromptWarning && (
            <small style={{ color: 'var(--warning-color, #f0ad4e)' }}>
              Warning: the selected saved system prompt no longer exists. Refresh the list and choose another prompt before generating trackers.
              {showRecreateSystemPromptAction && (
                <>
                  {' '}
                  <STButton
                    type="button"
                    data-testid="recreate-system-prompt-button"
                    disabled={isRecreatingSystemPrompt}
                    onClick={() => void recreateModuleSystemPromptPreset()}
                    title="Recreate this Module's saved system prompt from the shipped prompt"
                  >
                    <i className="fa-solid fa-rotate-right" aria-hidden="true"></i>{' '}
                    {isRecreatingSystemPrompt ? 'Recreating…' : 'Recreate prompt'}
                  </STButton>
                </>
              )}
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