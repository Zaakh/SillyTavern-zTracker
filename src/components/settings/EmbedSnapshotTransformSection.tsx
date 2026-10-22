import { FC, useMemo } from 'react';
import { STPresetSelect, STTextarea, PresetItem } from 'sillytavern-utils-lib/components/react';
import {
  DEFAULT_EMBED_SNAPSHOT_HEADER,
  EmbedSnapshotRegexTransformPreset,
  ExtensionSettings,
  TrackerModuleSettings,
  createDefaultEmbedSnapshotTransformPresets,
} from '../../config.js';
import { DEFAULT_MODULE_ID } from '../../extension-metadata.js';
import { reconcilePresetItems, resolvePresetSelection } from './preset-state.js';
import { SnapshotInjectionPreview } from './SnapshotInjectionPreview.js';

const BUILT_IN_PRESET_KEYS = Object.keys(createDefaultEmbedSnapshotTransformPresets());

/**
 * Snapshot header + transform preset editor. The preset list is global (shared by every Module), so
 * list and field edits go through `updateGlobal`; only the selected key is written to the Module.
 */
export const EmbedSnapshotTransformSection: FC<{
  settings: TrackerModuleSettings;
  updateAndRefresh: (updater: (current: TrackerModuleSettings) => void) => void;
  updateGlobal: (updater: (current: ExtensionSettings) => void) => void;
  moduleId?: string;
}> = ({ settings, updateAndRefresh, updateGlobal, moduleId = DEFAULT_MODULE_ID }) => {
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
    updateGlobal((g) => {
      const before = g.transformPresets;
      const nextState = reconcilePresetItems(before, settings.embedZTrackerSnapshotTransformPreset, newItems);
      const next = nextState.presets as ExtensionSettings['transformPresets'];
      // The widget reports rename and delete alike as a new item list: exactly one key gone and one
      // new key is a rename, so Modules that selected the old key follow it to the new key.
      const removed = Object.keys(before).filter((k) => !(k in next));
      const added = Object.keys(next).filter((k) => !(k in before));
      const renamed = removed.length === 1 && added.length === 1 ? { from: removed[0], to: added[0] } : null;
      // Built-ins can be edited and renamed but never removed: a dropped or renamed built-in key stays.
      for (const builtInKey of BUILT_IN_PRESET_KEYS) next[builtInKey] ??= before[builtInKey];
      for (const module of g.modules ?? []) {
        if (renamed && module.injection.transformPreset === renamed.from) module.injection.transformPreset = renamed.to;
        // A deleted preset sends its Modules back to the always-present default.
        if (!next[module.injection.transformPreset]) module.injection.transformPreset = 'default';
      }
      g.transformPresets = next;
    });
  };

  const key = settings.embedZTrackerSnapshotTransformPreset ?? 'default';
  const preset = settings.embedZTrackerSnapshotTransformPresets?.[key];
  const sharedBy = (settings.modules ?? []).filter((module) => module.injection.transformPreset === key).length;

  const editPreset = (patch: Partial<EmbedSnapshotRegexTransformPreset>) =>
    updateGlobal((g) => {
      const current = g.transformPresets?.[key];
      if (!current) return;
      g.transformPresets = { ...g.transformPresets, [key]: { ...current, ...patch } };
    });

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
          <div className="notes">
            Presets are shared by all Modules: edits apply everywhere this preset is selected
            {sharedBy > 1 ? ` (currently shared by ${sharedBy} Modules).` : '.'}
          </div>
          <div className="setting-row">
            <label title="Controls what text the regex runs against (the raw snapshot).">Transform input</label>
            <select
              className="text_pole"
              title="Controls what text the regex runs against."
              value={preset.input ?? 'pretty_json'}
              onChange={(e) =>
                editPreset({ input: e.target.value as any })
              }
            >
              <option value="pretty_json">Pretty JSON</option>
              <option value="top_level_lines">Top-level lines</option>
              <option value="toon">TOON (compact)</option>
              <option value="flat_lines">Flat (key: value lines)</option>
            </select>
          </div>

          <div className="setting-row">
            <label title="Optional JavaScript regex pattern applied to the snapshot text.">Regex pattern (JS)</label>
            <STTextarea
              value={preset.pattern ?? ''}
              onChange={(e) =>
                editPreset({ pattern: e.target.value })
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
                editPreset({ flags: e.target.value })
              }
            />
          </div>

          <div className="setting-row">
            <label title="Replacement string used with the regex (supports capture groups like $1).">Replacement</label>
            <STTextarea
              value={preset.replacement ?? ''}
              onChange={(e) =>
                editPreset({ replacement: e.target.value })
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
                editPreset({ codeFenceLang: e.target.value })
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
              checked={preset.input !== 'flat_lines' && preset.wrapInCodeFence !== false}
              disabled={preset.input === 'flat_lines'}
              onChange={(e) =>
                editPreset({ wrapInCodeFence: e.target.checked })
              }
            />
          </div>
        </div>
      )}

      <SnapshotInjectionPreview settings={settings} moduleId={moduleId} />
    </div>
  );
};
