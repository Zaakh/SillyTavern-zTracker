import { FC } from 'react';
import { EmbedSnapshotTransformSection } from './EmbedSnapshotTransformSection.js';
import type { SettingsSectionProps } from './settings-shared.js';

// Renders settings that only affect how tracker snapshots are injected into normal generations.
export const TrackerInjectionSection: FC<SettingsSectionProps> = ({ settings, updateAndRefresh }) => {
  return (
    <>
      <div className="setting-row">
        <label title="How many previous zTracker snapshots to embed into normal generations. 0 disables embedding.">
          Include Last X zTracker Messages
        </label>
        <input
          type="number"
          className="text_pole"
          min="0"
          step="1"
          title="How many previous zTracker snapshots to embed into normal generations. 0 disables embedding."
          value={settings.includeLastXZTrackerMessages}
          onChange={(e) =>
            updateAndRefresh((s) => {
              s.includeLastXZTrackerMessages = parseInt(e.target.value) || 0;
            })
          }
        />
      </div>

      <div className="setting-row">
        <label title="Which role to use for embedded zTracker snapshots in normal generations. This affects generate_interceptor only, not tracker generation.">
          Embed zTracker snapshots as
        </label>
        <select
          className="text_pole"
          title="Only affects embedding into the generation chat array (generate_interceptor), not tracker generation."
          value={settings.embedZTrackerRole ?? 'user'}
          onChange={(e) =>
            updateAndRefresh((s) => {
              s.embedZTrackerRole = e.target.value as typeof s.embedZTrackerRole;
            })
          }
        >
          <option value="user">User</option>
          <option value="system">System</option>
          <option value="assistant">Assistant</option>
        </select>
      </div>

      <EmbedSnapshotTransformSection settings={settings} updateAndRefresh={updateAndRefresh} />
    </>
  );
};