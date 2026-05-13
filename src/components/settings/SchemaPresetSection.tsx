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
  schemaTextError?: string;
  schemaTextHasUnsavedChanges: boolean;
  schemaTextCanSave: boolean;
  schemaHtmlText: string;
  schemaHtmlTextHasError: boolean;
  schemaHtmlTextError?: string;
  schemaHtmlTextHasUnsavedChanges: boolean;
  schemaHtmlTextCanSave: boolean;
  handleSchemaValueChange: (newSchemaText: string) => void;
  handleSchemaHtmlChange: (newHtml: string) => void;
  saveSchemaValue: () => void;
  saveSchemaHtmlValue: () => void;
  restoreSchemaToDefault: () => Promise<void>;
}> = ({
  settings,
  schemaPresetItems,
  handleSchemaPresetChange,
  handleSchemaPresetsListChange,
  schemaText,
  schemaTextHasError,
  schemaTextError,
  schemaTextHasUnsavedChanges,
  schemaTextCanSave,
  schemaHtmlText,
  schemaHtmlTextHasError,
  schemaHtmlTextError,
  schemaHtmlTextHasUnsavedChanges,
  schemaHtmlTextCanSave,
  handleSchemaValueChange,
  handleSchemaHtmlChange,
  saveSchemaValue,
  saveSchemaHtmlValue,
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
        <span title="The JSON schema used for tracker generation.">Schema JSON</span>
        <STButton className="fa-solid fa-undo" title="Restore default schema JSON and HTML" onClick={restoreSchemaToDefault} />
      </div>

      <STTextarea
        value={schemaText}
        onChange={(e) => handleSchemaValueChange(e.target.value)}
        rows={4}
        className={schemaTextHasError ? 'ztracker-schema-textarea is-invalid' : 'ztracker-schema-textarea'}
        aria-invalid={schemaTextHasError}
      />

      <div className="ztracker-schema-editor-actions">
        <STButton title="Save JSON schema" onClick={saveSchemaValue} disabled={!schemaTextCanSave}>
          Save JSON
        </STButton>
        {schemaTextHasError ? (
          <div className="notes ztracker-schema-error">{schemaTextError ?? 'Invalid JSON.'}</div>
        ) : schemaTextHasUnsavedChanges ? (
          <div className="notes ztracker-schema-status">Valid JSON. Save to apply this preset change.</div>
        ) : null}
      </div>

      <div className="title_restorable">
        <span title="The Handlebars HTML template used to render tracker content.">Schema HTML</span>
      </div>

      <STTextarea
        value={schemaHtmlText}
        onChange={(e) => handleSchemaHtmlChange(e.target.value)}
        rows={4}
        className={schemaHtmlTextHasError ? 'ztracker-schema-textarea is-invalid' : 'ztracker-schema-textarea'}
        aria-invalid={schemaHtmlTextHasError}
        placeholder="Enter your schema HTML here..."
      />

      <div className="ztracker-schema-editor-actions">
        <STButton title="Save schema HTML" onClick={saveSchemaHtmlValue} disabled={!schemaHtmlTextCanSave}>
          Save HTML
        </STButton>
        {schemaHtmlTextHasError ? (
          <div className="notes ztracker-schema-error">{schemaHtmlTextError ?? 'Invalid Handlebars template.'}</div>
        ) : schemaHtmlTextHasUnsavedChanges ? (
          <div className="notes ztracker-schema-status">Valid template. Save to apply this preset change.</div>
        ) : null}
      </div>
    </div>
  );
};