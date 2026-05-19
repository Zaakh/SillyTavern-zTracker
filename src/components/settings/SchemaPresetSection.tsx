import { FC } from 'react';
import { STButton, STPresetSelect, STTextarea, PresetItem } from 'sillytavern-utils-lib/components/react';
import { ExtensionSettings } from '../../config.js';

// Keeps schema preset selection and schema/template editing together because they change the same tracker shape.
export const SchemaPresetSection: FC<{
  settings: ExtensionSettings;
  schemaPresetItems: PresetItem[];
  currentChatSchemaPresetKey?: string;
  currentChatSchemaPresetLabel?: string;
  currentChatSchemaPresetStoredKey?: string;
  currentChatSchemaPresetUsesDefault: boolean;
  currentChatSchemaPresetAvailable: boolean;
  currentChatSchemaPresetHasStoredValue: boolean;
  currentChatSchemaPresetHasValidStoredValue: boolean;
  handleSchemaPresetChange: (newValue?: string) => void;
  handleCurrentChatSchemaPresetChange: (newValue?: string) => void;
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
  currentChatSchemaPresetKey,
  currentChatSchemaPresetLabel,
  currentChatSchemaPresetStoredKey,
  currentChatSchemaPresetUsesDefault,
  currentChatSchemaPresetAvailable,
  currentChatSchemaPresetHasStoredValue,
  currentChatSchemaPresetHasValidStoredValue,
  handleSchemaPresetChange,
  handleCurrentChatSchemaPresetChange,
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
      <label title="Selects the default schema preset for new chats and which preset definition you are editing below. You can create, rename, and delete presets.">
        Default Schema Preset
      </label>
      <STPresetSelect
        label="Default Schema Preset"
        items={schemaPresetItems}
        value={settings.schemaPreset}
        onChange={handleSchemaPresetChange}
        onItemsChange={handleSchemaPresetsListChange}
        readOnlyValues={['default']}
        enableCreate
        enableDelete
        enableRename
      />
      <div className="notes ztracker-schema-status">
        Sets the default schema for new chats and selects which preset definition the JSON and HTML editors below are modifying.
      </div>

      {currentChatSchemaPresetAvailable ? (
        <>
          <label title="Selects the schema preset used for full tracker generation and full Regenerate Tracker in the current chat.">
            Current Chat Schema Preset
          </label>
          <STPresetSelect
            label="Current Chat Schema Preset"
            items={schemaPresetItems}
            value={currentChatSchemaPresetKey}
            onChange={handleCurrentChatSchemaPresetChange}
            onItemsChange={() => undefined}
          />
          <div className="notes ztracker-schema-status">
            {currentChatSchemaPresetHasStoredValue && !currentChatSchemaPresetHasValidStoredValue
              ? `This chat still references unavailable schema preset "${currentChatSchemaPresetStoredKey}". zTracker is currently showing the fallback preset "${currentChatSchemaPresetLabel ?? currentChatSchemaPresetKey}" until you choose or generate with a valid chat schema.`
              : currentChatSchemaPresetHasStoredValue
              ? `Full tracker generation in this chat uses "${currentChatSchemaPresetLabel ?? currentChatSchemaPresetKey}". Partial regeneration still uses each message's saved schema.`
              : currentChatSchemaPresetUsesDefault
                ? `This chat is currently following the default schema preset "${currentChatSchemaPresetLabel ?? currentChatSchemaPresetKey}" until its own chat schema is saved. Full tracker generation will persist that chat schema when needed.`
                : 'Full tracker generation in this chat uses the current chat schema preset. Partial regeneration still uses each message\'s saved schema.'}
          </div>
        </>
      ) : null}

      <div className="title_restorable">
        <span title="The JSON schema and HTML template used for tracker generation and rendering.">Schema</span>
        <STButton className="fa-solid fa-undo" title="Restore default schema JSON and HTML" onClick={restoreSchemaToDefault} />
      </div>

      <div className="title_restorable">
        <span title="The JSON schema used for tracker generation.">Schema JSON</span>
        <STButton
          className="fa-solid fa-floppy-disk"
          title="Save JSON schema"
          onClick={saveSchemaValue}
          disabled={!schemaTextCanSave}
        />
      </div>

      <STTextarea
        value={schemaText}
        onChange={(e) => handleSchemaValueChange(e.target.value)}
        rows={4}
        className={schemaTextHasError ? 'ztracker-schema-textarea is-invalid' : 'ztracker-schema-textarea'}
        aria-invalid={schemaTextHasError}
      />
      {schemaTextHasError ? (
        <div className="notes ztracker-schema-error">{schemaTextError ?? 'Invalid JSON.'}</div>
      ) : schemaTextHasUnsavedChanges ? (
        <div className="notes ztracker-schema-status">Valid JSON. Save to apply this preset change.</div>
      ) : null}

      <div className="title_restorable">
        <span title="The Handlebars HTML template used to render tracker content.">Schema HTML</span>
        <STButton
          className="fa-solid fa-floppy-disk"
          title="Save schema HTML"
          onClick={saveSchemaHtmlValue}
          disabled={!schemaHtmlTextCanSave}
        />
      </div>

      <STTextarea
        value={schemaHtmlText}
        onChange={(e) => handleSchemaHtmlChange(e.target.value)}
        rows={4}
        className={schemaHtmlTextHasError ? 'ztracker-schema-textarea is-invalid' : 'ztracker-schema-textarea'}
        aria-invalid={schemaHtmlTextHasError}
        placeholder="Enter your schema HTML here..."
      />
      {schemaHtmlTextHasError ? (
        <div className="notes ztracker-schema-error">{schemaHtmlTextError ?? 'Invalid Handlebars template.'}</div>
      ) : schemaHtmlTextHasUnsavedChanges ? (
        <div className="notes ztracker-schema-status">Valid template. Save to apply this preset change.</div>
      ) : null}
    </div>
  );
};