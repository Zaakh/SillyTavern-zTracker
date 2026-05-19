import { FC } from 'react';
import { PresetItem } from 'sillytavern-utils-lib/components/react';
import { ExtensionSettings } from '../../config.js';
import { GenerationBehaviorSection } from './GenerationBehaviorSection.js';
import { GenerationPromptTemplatesSection } from './GenerationPromptTemplatesSection.js';
import { SchemaPresetSection } from './SchemaPresetSection.js';
import type { SettingsUpdateAndRefresh } from './settings-shared.js';
import { SystemPromptSettingsSection } from './SystemPromptSettingsSection.js';
import { WorldInfoPolicySection } from './WorldInfoPolicySection.js';

// Renders settings that control tracker generation, prompt construction, and tracker schema editing.
export const TrackerGenerationSection: FC<{
  settings: ExtensionSettings;
  updateAndRefresh: SettingsUpdateAndRefresh;
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
  schemaPresetPairError?: string;
  handleSchemaValueChange: (newSchemaText: string) => void;
  handleSchemaHtmlChange: (newHtml: string) => void;
  saveSchemaValue: () => void;
  saveSchemaHtmlValue: () => void;
  restoreSchemaToDefault: () => Promise<void>;
  systemPromptItems: PresetItem[];
  refreshSystemPromptState: () => void;
  showMissingSavedSystemPromptWarning: boolean;
  showSharedSystemPromptWarning: boolean;
  currentGlobalSystemPromptName?: string;
}> = ({
  settings,
  updateAndRefresh,
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
  schemaPresetPairError,
  handleSchemaValueChange,
  handleSchemaHtmlChange,
  saveSchemaValue,
  saveSchemaHtmlValue,
  restoreSchemaToDefault,
  systemPromptItems,
  refreshSystemPromptState,
  showMissingSavedSystemPromptWarning,
  showSharedSystemPromptWarning,
  currentGlobalSystemPromptName,
}) => {
  return (
    <>
      <GenerationBehaviorSection settings={settings} updateAndRefresh={updateAndRefresh} />

      <SchemaPresetSection
        schemaPresetKey={settings.schemaPreset}
        schemaPresetItems={schemaPresetItems}
        currentChatSchemaPresetKey={currentChatSchemaPresetKey}
        currentChatSchemaPresetLabel={currentChatSchemaPresetLabel}
        currentChatSchemaPresetStoredKey={currentChatSchemaPresetStoredKey}
        currentChatSchemaPresetUsesDefault={currentChatSchemaPresetUsesDefault}
        currentChatSchemaPresetAvailable={currentChatSchemaPresetAvailable}
        currentChatSchemaPresetHasStoredValue={currentChatSchemaPresetHasStoredValue}
        currentChatSchemaPresetHasValidStoredValue={currentChatSchemaPresetHasValidStoredValue}
        handleSchemaPresetChange={handleSchemaPresetChange}
        handleCurrentChatSchemaPresetChange={handleCurrentChatSchemaPresetChange}
        handleSchemaPresetsListChange={handleSchemaPresetsListChange}
        schemaText={schemaText}
        schemaTextHasError={schemaTextHasError}
        schemaTextError={schemaTextError}
        schemaTextHasUnsavedChanges={schemaTextHasUnsavedChanges}
        schemaTextCanSave={schemaTextCanSave}
        schemaHtmlText={schemaHtmlText}
        schemaHtmlTextHasError={schemaHtmlTextHasError}
        schemaHtmlTextError={schemaHtmlTextError}
        schemaHtmlTextHasUnsavedChanges={schemaHtmlTextHasUnsavedChanges}
        schemaHtmlTextCanSave={schemaHtmlTextCanSave}
        schemaPresetPairError={schemaPresetPairError}
        handleSchemaValueChange={handleSchemaValueChange}
        handleSchemaHtmlChange={handleSchemaHtmlChange}
        saveSchemaValue={saveSchemaValue}
        saveSchemaHtmlValue={saveSchemaHtmlValue}
        restoreSchemaToDefault={restoreSchemaToDefault}
      />

      <SystemPromptSettingsSection
        settings={settings}
        updateAndRefresh={updateAndRefresh}
        systemPromptItems={systemPromptItems}
        refreshSystemPromptState={refreshSystemPromptState}
        showMissingSavedSystemPromptWarning={showMissingSavedSystemPromptWarning}
        showSharedSystemPromptWarning={showSharedSystemPromptWarning}
        currentGlobalSystemPromptName={currentGlobalSystemPromptName}
      />

      <GenerationPromptTemplatesSection settings={settings} updateAndRefresh={updateAndRefresh} />

      <WorldInfoPolicySection settings={settings} updateAndRefresh={updateAndRefresh} />
    </>
  );
};