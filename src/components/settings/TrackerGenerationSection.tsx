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
  handleSchemaPresetChange: (newValue?: string) => void;
  handleSchemaPresetsListChange: (newItems: PresetItem[]) => void;
  schemaText: string;
  handleSchemaValueChange: (newSchemaText: string) => void;
  handleSchemaHtmlChange: (newHtml: string) => void;
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
  handleSchemaPresetChange,
  handleSchemaPresetsListChange,
  schemaText,
  handleSchemaValueChange,
  handleSchemaHtmlChange,
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
        settings={settings}
        schemaPresetItems={schemaPresetItems}
        handleSchemaPresetChange={handleSchemaPresetChange}
        handleSchemaPresetsListChange={handleSchemaPresetsListChange}
        schemaText={schemaText}
        handleSchemaValueChange={handleSchemaValueChange}
        handleSchemaHtmlChange={handleSchemaHtmlChange}
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