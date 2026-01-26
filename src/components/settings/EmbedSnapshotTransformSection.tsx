import { FC, useMemo } from 'react';
import { STPresetSelect, STTextarea, PresetItem } from 'sillytavern-utils-lib/components/react';
import { ExtensionSettings } from '../../config.js';

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
    const newPresetKey = newValue ?? 'default';
    const newPreset = settings.embedZTrackerSnapshotTransformPresets?.[newPresetKey];
    if (!newPreset) return;
    updateAndRefresh((s) => {
      s.embedZTrackerSnapshotTransformPreset = newPresetKey;
    });
  };

  const handleEmbedTransformPresetsListChange = (newItems: PresetItem[]) => {
    updateAndRefresh((s) => {
      const existing = s.embedZTrackerSnapshotTransformPresets ?? {};
      const activeKey = s.embedZTrackerSnapshotTransformPreset || 'default';
      const template = existing[activeKey] ?? existing['default'];

      const newPresets: ExtensionSettings['embedZTrackerSnapshotTransformPresets'] = {};
      newItems.forEach((item) => {
        const prev = existing[item.value];
        newPresets[item.value] = prev
          ? { ...prev, name: item.label }
          : {
              ...(template
                ? structuredClone(template)
                : {
                    name: item.label,
                    input: 'pretty_json',
                    pattern: '',
                    flags: 'g',
                    replacement: '',
                    codeFenceLang: 'json',
                  }),
              name: item.label,
            };
      });
      s.embedZTrackerSnapshotTransformPresets = newPresets;

      if (!newPresets[s.embedZTrackerSnapshotTransformPreset]) {
        s.embedZTrackerSnapshotTransformPreset = newPresets['default'] ? 'default' : newItems[0]?.value ?? 'default';
      }
    });
  };

  const key = settings.embedZTrackerSnapshotTransformPreset ?? 'default';
  const preset = settings.embedZTrackerSnapshotTransformPresets?.[key];

  return (
    <div className="setting-row">
      <label>Embed snapshot header</label>
      <input
        type="text"
        className="text_pole"
        placeholder="Tracker:"
        value={settings.embedZTrackerSnapshotHeader ?? 'Tracker:'}
        onChange={(e) =>
          updateAndRefresh((s) => {
            s.embedZTrackerSnapshotHeader = e.target.value;
          })
        }
      />

      <div className="notes">Set to empty to omit the header line.</div>

      <label>Embed snapshot transform preset</label>
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
            <label>Transform input</label>
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
            </select>
          </div>

          <div className="setting-row">
            <label>Regex pattern (JS)</label>
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
            <label>Regex flags</label>
            <input
              type="text"
              className="text_pole"
              placeholder="gmi"
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
            <label>Replacement</label>
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
            <label>Code fence language</label>
            <input
              type="text"
              className="text_pole"
              placeholder="json"
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
            <label>Wrap in code fence</label>
            <input
              type="checkbox"
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
