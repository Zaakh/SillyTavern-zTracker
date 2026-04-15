import { FC, useMemo } from 'react';
import { STPresetSelect, STTextarea, PresetItem } from 'sillytavern-utils-lib/components/react';
import { DEFAULT_EMBED_SNAPSHOT_HEADER, ExtensionSettings } from '../../config.js';
import { reconcilePresetItems, resolvePresetSelection } from './preset-state.js';

export const EmbedSnapshotTransformSection: FC<{
  settings: ExtensionSettings;
  updateAndRefresh: (updater: (current: ExtensionSettings) => void) => void;
}> = ({ settings, updateAndRefresh }) => {
  const embedTransformItems = useMemo((): PresetItem[] => {
    const presets = settings.embedZTrackerSnapshotTransformPresets ?? {};
    return Object.entries(presets).map(([value, preset]) => ({
      value,
      label: preset.name,
    }));
  }, [settings.embedZTrackerSnapshotTransformPresets]);

  const handleEmbedTransformPresetChange = (newValue?: string) => {
    updateAndRefresh((s) => {
      const selection = resolvePresetSelection(s.embedZTrackerSnapshotTransformPresets, newValue);
      if (!selection) return;
      s.embedZTrackerSnapshotTransformPreset = selection.key;
    });
  };

  const handleEmbedTransformPresetsListChange = (newItems: PresetItem[]) => {
    updateAndRefresh((s) => {
      const nextState = reconcilePresetItems(s.embedZTrackerSnapshotTransformPresets, s.embedZTrackerSnapshotTransformPreset, newItems);
      s.embedZTrackerSnapshotTransformPresets = nextState.presets as ExtensionSettings['embedZTrackerSnapshotTransformPresets'];
      s.embedZTrackerSnapshotTransformPreset = nextState.activeKey;
    });
  };

  const key = settings.embedZTrackerSnapshotTransformPreset ?? 'default';
  const preset = settings.embedZTrackerSnapshotTransformPresets?.[key];

  return (
    <div className="setting-row">
      <label title="Header line to prepend before the embedded zTracker snapshot in normal generations.">Embed snapshot header</label>
      <input
        type="text"
        className="text_pole"
        placeholder={DEFAULT_EMBED_SNAPSHOT_HEADER}
        title="Header line to prepend before the embedded zTracker snapshot in normal generations. Set empty to omit."
        value={settings.embedZTrackerSnapshotHeader ?? DEFAULT_EMBED_SNAPSHOT_HEADER}
        onChange={(e) =>
          updateAndRefresh((s) => {
            s.embedZTrackerSnapshotHeader = e.target.value;
          })
        }
      />

      <div className="notes">Set to empty to omit the header line. The placeholder is only the default fallback, not the active value.</div>

      <label title="Choose how embedded snapshots are formatted (optional regex transform + code fence settings).">
        Embed snapshot transform preset
      </label>
      <STPresetSelect
        label="Embed snapshot transform preset"
        items={embedTransformItems}
        value={settings.embedZTrackerSnapshotTransformPreset ?? 'default'}
        onChange={handleEmbedTransformPresetChange}
        onItemsChange={handleEmbedTransformPresetsListChange}
        readOnlyValues={['default']}
        enableCreate
        enableDelete
        enableRename
      />

      {!preset ? null : (
        <div style={{ marginTop: '0.5em' }}>
          <div className="setting-row">
            <label title="Controls what text the regex runs against (the raw snapshot).">Transform input</label>
            <select
              className="text_pole"
              title="Controls what text the regex runs against."
              value={preset.input ?? 'pretty_json'}
              onChange={(e) =>
                updateAndRefresh((s) => {
                  const current = s.embedZTrackerSnapshotTransformPresets?.[key];
                  if (!current) return;
                  s.embedZTrackerSnapshotTransformPresets = {
                    ...s.embedZTrackerSnapshotTransformPresets,
                    [key]: { ...current, input: e.target.value as any },
                  };
                })
              }
            >
              <option value="pretty_json">Pretty JSON</option>
              <option value="top_level_lines">Top-level lines</option>
              <option value="toon">TOON (compact)</option>
            </select>
          </div>

          <div className="setting-row">
            <label title="Optional JavaScript regex pattern applied to the snapshot text.">Regex pattern (JS)</label>
            <STTextarea
              value={preset.pattern ?? ''}
              onChange={(e) =>
                updateAndRefresh((s) => {
                  const current = s.embedZTrackerSnapshotTransformPresets?.[key];
                  if (!current) return;
                  s.embedZTrackerSnapshotTransformPresets = {
                    ...s.embedZTrackerSnapshotTransformPresets,
                    [key]: { ...current, pattern: e.target.value },
                  };
                })
              }
              rows={2}
            />
          </div>

          <div className="setting-row">
            <label title="JavaScript regex flags (e.g. g, i, m).">Regex flags</label>
            <input
              type="text"
              className="text_pole"
              placeholder="gmi"
              title="JavaScript regex flags (e.g. g, i, m)."
              value={preset.flags ?? ''}
              onChange={(e) =>
                updateAndRefresh((s) => {
                  const current = s.embedZTrackerSnapshotTransformPresets?.[key];
                  if (!current) return;
                  s.embedZTrackerSnapshotTransformPresets = {
                    ...s.embedZTrackerSnapshotTransformPresets,
                    [key]: { ...current, flags: e.target.value },
                  };
                })
              }
            />
          </div>

          <div className="setting-row">
            <label title="Replacement string used with the regex (supports capture groups like $1).">Replacement</label>
            <STTextarea
              value={preset.replacement ?? ''}
              onChange={(e) =>
                updateAndRefresh((s) => {
                  const current = s.embedZTrackerSnapshotTransformPresets?.[key];
                  if (!current) return;
                  s.embedZTrackerSnapshotTransformPresets = {
                    ...s.embedZTrackerSnapshotTransformPresets,
                    [key]: { ...current, replacement: e.target.value },
                  };
                })
              }
              rows={2}
            />
          </div>

          <div className="setting-row">
            <label title="Language tag used for the Markdown code fence when wrapping is enabled (e.g. json, text). Ignored if wrapping is disabled.">
              Code fence language
            </label>
            <input
              type="text"
              className="text_pole"
              placeholder="json"
              title="Language tag used for the Markdown code fence when wrapping is enabled (e.g. json, text). Ignored if wrapping is disabled."
              value={preset.codeFenceLang ?? ''}
              onChange={(e) =>
                updateAndRefresh((s) => {
                  const current = s.embedZTrackerSnapshotTransformPresets?.[key];
                  if (!current) return;
                  s.embedZTrackerSnapshotTransformPresets = {
                    ...s.embedZTrackerSnapshotTransformPresets,
                    [key]: { ...current, codeFenceLang: e.target.value },
                  };
                })
              }
            />
          </div>

          <div className="setting-row">
            <label title="When enabled, wraps the embedded snapshot in a Markdown code fence for readability (example: ```json ... ```).">
              Wrap in code fence
            </label>
            <input
              type="checkbox"
              title="When enabled, wraps the embedded snapshot in a Markdown code fence for readability (example: ```json ... ```)."
              checked={preset.wrapInCodeFence !== false}
              onChange={(e) =>
                updateAndRefresh((s) => {
                  const current = s.embedZTrackerSnapshotTransformPresets?.[key];
                  if (!current) return;
                  s.embedZTrackerSnapshotTransformPresets = {
                    ...s.embedZTrackerSnapshotTransformPresets,
                    [key]: { ...current, wrapInCodeFence: e.target.checked },
                  };
                })
              }
            />
          </div>
        </div>
      )}
    </div>
  );
};
