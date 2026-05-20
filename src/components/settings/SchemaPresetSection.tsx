import { FC, useMemo } from 'react';
import { st_echo } from 'sillytavern-utils-lib/config';
import { STButton, STSelect, STTextarea, PresetItem } from 'sillytavern-utils-lib/components/react';

const READ_ONLY_SCHEMA_PRESET_VALUES = ['default'];

// Keeps schema preset selection and schema/template editing together because they change the same tracker shape.
export const SchemaPresetSection: FC<{
  schemaPresetKey: string;
  schemaPresetItems: PresetItem[];
  currentChatSchemaPresetKey?: string;
  currentChatSchemaPresetLabel?: string;
  currentChatSchemaPresetStoredKey?: string;
  currentChatSchemaPresetUsesDefault: boolean;
  currentChatSchemaPresetAvailable: boolean;
  currentChatSchemaPresetHasStoredValue: boolean;
  currentChatSchemaPresetHasValidStoredValue: boolean;
  handleSchemaPresetChange: (newValue?: string) => void;
  handleSchemaPresetRename: (currentKey: string, newValue: string) => void;
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
  schemaPresetPairError?: string;
  handleSchemaValueChange: (newSchemaText: string) => void;
  handleSchemaHtmlChange: (newHtml: string) => void;
  saveSchemaValue: () => void;
  saveSchemaHtmlValue: () => void;
  restoreSchemaToDefault: () => Promise<void>;
}> = ({
  schemaPresetKey,
  schemaPresetItems,
  currentChatSchemaPresetKey,
  currentChatSchemaPresetLabel,
  currentChatSchemaPresetStoredKey,
  currentChatSchemaPresetUsesDefault,
  currentChatSchemaPresetAvailable,
  currentChatSchemaPresetHasStoredValue,
  currentChatSchemaPresetHasValidStoredValue,
  handleSchemaPresetChange,
  handleSchemaPresetRename,
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
  schemaPresetPairError,
  handleSchemaValueChange,
  handleSchemaHtmlChange,
  saveSchemaValue,
  saveSchemaHtmlValue,
  restoreSchemaToDefault,
}) => {
  const activeSchemaPresetItem = useMemo(
    () => schemaPresetItems.find((item) => item.value === schemaPresetKey),
    [schemaPresetItems, schemaPresetKey],
  );
  const isReadOnlySchemaPreset = READ_ONLY_SCHEMA_PRESET_VALUES.includes(schemaPresetKey);
  const currentChatSchemaPresetTitle = currentChatSchemaPresetHasStoredValue && !currentChatSchemaPresetHasValidStoredValue
    ? `This chat still references unavailable schema preset "${currentChatSchemaPresetStoredKey}". zTracker is currently showing the fallback preset "${currentChatSchemaPresetLabel ?? currentChatSchemaPresetKey}" until you choose or generate with a valid chat schema.`
    : currentChatSchemaPresetHasStoredValue
      ? `Uses "${currentChatSchemaPresetLabel ?? currentChatSchemaPresetKey}" for full tracker generation and full Regenerate Tracker in the current chat. Partial regeneration still uses each message's saved schema.`
      : currentChatSchemaPresetUsesDefault
        ? `This chat currently follows the default schema preset "${currentChatSchemaPresetLabel ?? currentChatSchemaPresetKey}" until its own chat schema is saved. Full tracker generation will persist that chat schema when needed.`
        : 'Selects the schema preset used for full tracker generation and full Regenerate Tracker in the current chat.';

  // Uses the same simple popup flow as the shared preset widget, but keeps the global schema editor selector explicit in this section.
  const createSchemaPreset = async () => {
    const nextPresetName = await SillyTavern.getContext().Popup.show.input(
      'Create a new schema preset',
      'Please enter a name for the new schema preset:',
      '',
    );
    const trimmedPresetName = nextPresetName?.trim();
    if (!trimmedPresetName) {
      return;
    }

    if (schemaPresetItems.some((item) => item.value === trimmedPresetName)) {
      await st_echo('warning', 'A schema preset with this name already exists.');
      return;
    }

    handleSchemaPresetsListChange([...schemaPresetItems, { value: trimmedPresetName, label: trimmedPresetName }]);
    handleSchemaPresetChange(trimmedPresetName);
  };

  const renameSchemaPreset = async () => {
    if (!activeSchemaPresetItem) {
      await st_echo('warning', 'Please select a schema preset to rename.');
      return;
    }

    if (isReadOnlySchemaPreset) {
      await st_echo('warning', 'This schema preset cannot be renamed because it is read-only.');
      return;
    }

    const nextPresetName = await SillyTavern.getContext().Popup.show.input(
      'Rename schema preset',
      `Please enter a new name for "${activeSchemaPresetItem.label}":`,
      activeSchemaPresetItem.label,
    );
    const trimmedPresetName = nextPresetName?.trim();
    if (!trimmedPresetName || trimmedPresetName === activeSchemaPresetItem.value) {
      return;
    }

    if (schemaPresetItems.some((item) => item.value === trimmedPresetName)) {
      await st_echo('warning', 'A schema preset with this name already exists.');
      return;
    }

    handleSchemaPresetRename(activeSchemaPresetItem.value, trimmedPresetName);
  };

  const deleteSchemaPreset = async () => {
    if (!activeSchemaPresetItem) {
      await st_echo('warning', 'Please select a schema preset to delete.');
      return;
    }

    if (isReadOnlySchemaPreset) {
      await st_echo('warning', 'This schema preset cannot be deleted because it is read-only.');
      return;
    }

    const confirmed = await SillyTavern.getContext().Popup.show.confirm(
      'Delete schema preset',
      `Are you sure you want to delete "${activeSchemaPresetItem.label}"?`,
    );
    if (!confirmed) {
      return;
    }

    handleSchemaPresetsListChange(schemaPresetItems.filter((item) => item.value !== activeSchemaPresetItem.value));
  };

  return (
    <div className="setting-row">
      <label title="Selects the default schema preset for new chats and which preset definition you are editing below. You can create, rename, and delete presets.">
        Default Schema Preset
      </label>
      <div className="ztracker-preset-select-row">
        <STSelect
          value={schemaPresetKey}
          title="Selects which global schema preset definition the JSON and HTML editors below are modifying."
          onChange={(event) => handleSchemaPresetChange(event.target.value)}
        >
          {schemaPresetItems.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </STSelect>
        <STButton className="fa-solid fa-file-circle-plus" title="Create a new schema preset" onClick={createSchemaPreset} />
        <STButton
          className="fa-solid fa-pencil"
          title="Rename selected schema preset"
          onClick={renameSchemaPreset}
          disabled={!activeSchemaPresetItem || isReadOnlySchemaPreset}
        />
        <STButton
          className="fa-solid fa-trash-can"
          title="Delete selected schema preset"
          onClick={deleteSchemaPreset}
          disabled={!activeSchemaPresetItem || isReadOnlySchemaPreset}
        />
      </div>

      {currentChatSchemaPresetAvailable ? (
        <>
          <label title={currentChatSchemaPresetTitle}>
            Current Chat Schema Preset
          </label>
          <STSelect
            value={currentChatSchemaPresetKey}
            title={currentChatSchemaPresetTitle}
            onChange={(event) => handleCurrentChatSchemaPresetChange(event.target.value)}
          >
            {schemaPresetItems.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </STSelect>
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
          title="Save the current schema preset pair (JSON and HTML)"
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
        <div className="notes ztracker-schema-status">Valid JSON. Save to apply the current schema preset pair.</div>
      ) : null}

      <div className="title_restorable">
        <span title="The Handlebars HTML template used to render tracker content.">Schema HTML</span>
        <STButton
          className="fa-solid fa-floppy-disk"
          title="Save the current schema preset pair (JSON and HTML)"
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
        <div className="notes ztracker-schema-status">Valid template. Save to apply the current schema preset pair.</div>
      ) : null}

      {schemaPresetPairError ? (
        <div className="notes ztracker-schema-error">{schemaPresetPairError}</div>
      ) : null}
    </div>
  );
};