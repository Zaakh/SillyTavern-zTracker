import { FC } from 'react';
import { STButton, STPresetSelect, STTextarea, PresetItem } from 'sillytavern-utils-lib/components/react';
import { ExtensionSettings } from '../../config.js';

// Keeps schema preset selection and schema/template editing together because they change the same tracker shape.
export const SchemaPresetSection: FC<{
  settings: ExtensionSettings;
  schemaPresetItems: PresetItem[];
  handleSchemaPresetChange: (newValue?: string) => void;
  handleSchemaPresetsListChange: (newItems: PresetItem[]) => void;
  schemaText: string;
  schemaTextHasError: boolean;
  handleSchemaValueChange: (newSchemaText: string) => void;
  handleSchemaHtmlChange: (newHtml: string) => void;
  restoreSchemaToDefault: () => Promise<void>;
}> = ({
  settings,
  schemaPresetItems,
  handleSchemaPresetChange,
  handleSchemaPresetsListChange,
  schemaText,
  schemaTextHasError,
  handleSchemaValueChange,
  handleSchemaHtmlChange,
  restoreSchemaToDefault,
}) => {
  return (
    <div className="setting-row">
      <label title="Selects the active schema preset used to parse and render trackers. You can create, rename, and delete presets.">
        Schema Preset
      </label>
      <STPresetSelect
        label="Schema Preset"
        items={schemaPresetItems}
        value={settings.schemaPreset}
        onChange={handleSchemaPresetChange}
        onItemsChange={handleSchemaPresetsListChange}
        readOnlyValues={['default']}
        enableCreate
        enableDelete
        enableRename
      />

      <div className="title_restorable">
        <span title="The JSON schema and HTML template used for tracker generation and rendering.">Schema</span>
        <STButton className="fa-solid fa-undo" title="Restore default" onClick={restoreSchemaToDefault} />
      </div>

      <STTextarea
        value={schemaText}
        onChange={(e) => handleSchemaValueChange(e.target.value)}
        rows={4}
        className={schemaTextHasError ? 'ztracker-schema-textarea is-invalid' : 'ztracker-schema-textarea'}
        aria-invalid={schemaTextHasError}
      />
      {schemaTextHasError ? (
        <div className="notes ztracker-schema-error">Invalid JSON. The schema draft is not saved until it parses successfully.</div>
      ) : null}
      <STTextarea
        value={settings.schemaPresets[settings.schemaPreset]?.html ?? ''}
        onChange={(e) => handleSchemaHtmlChange(e.target.value)}
        rows={4}
        placeholder="Enter your schema HTML here..."
      />
    </div>
  );
};