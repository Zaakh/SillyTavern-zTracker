import { FC, useState, useMemo, useCallback, useEffect } from 'react';
import { STConnectionProfileSelect, PresetItem } from 'sillytavern-utils-lib/components/react';
import { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import {
  ExtensionSettings,
  Schema,
  DEFAULT_SCHEMA_VALUE,
  DEFAULT_SCHEMA_HTML,
  defaultSettings,
  EXTENSION_KEY,
} from '../config.js';
import { useForceUpdate } from '../hooks/useForceUpdate.js';
import {
  getCurrentGlobalSystemPromptName,
  hasSystemPromptPreset,
  listSystemPromptPresetNames,
  shouldWarnAboutSharedSystemPromptSelection,
} from '../system-prompt.js';
import { DiagnosticsSection } from './settings/DiagnosticsSection.js';
import { reconcilePresetItems, resolvePresetSelection } from './settings/preset-state.js';
import { SettingsSectionDrawer } from './settings/SettingsSectionDrawer.js';
import { TrackerGenerationSection } from './settings/TrackerGenerationSection.js';
import { TrackerInjectionSection } from './settings/TrackerInjectionSection.js';

// Initialize the settings manager once, outside the component
export const settingsManager = new ExtensionSettingsManager<ExtensionSettings>(EXTENSION_KEY, defaultSettings);

// The schema editor keeps a local text buffer so invalid JSON can stay visible until the user fixes it.
function formatSchemaText(schema?: Schema) {
  return schema ? JSON.stringify(schema.value, null, 2) : '';
}

export const ZTrackerSettings: FC = () => {
  const forceUpdate = useForceUpdate();
  const settings = settingsManager.getSettings();

  const [diagnosticsText, setDiagnosticsText] = useState<string>('');
  const [systemPromptRefreshRevision, setSystemPromptRefreshRevision] = useState(0);
  const [isGenerationOpen, setGenerationOpen] = useState(true);
  const [isInjectionOpen, setInjectionOpen] = useState(true);

  const [schemaText, setSchemaText] = useState(formatSchemaText(settings.schemaPresets[settings.schemaPreset]));

  const updateAndRefresh = useCallback(
    (updater: (currentSettings: ExtensionSettings) => void) => {
      const currentSettings = settingsManager.getSettings();
      updater(currentSettings);
      settingsManager.saveSettings();
      forceUpdate();
    },
    [forceUpdate],
  );

  // Memoized data for the schema preset dropdown
  const schemaPresetItems = useMemo((): PresetItem[] => {
    return Object.entries(settings.schemaPresets).map(([value, preset]) => ({
      value,
      label: preset.name,
    }));
  }, [settings.schemaPresets]);

  const systemPromptItems = useMemo((): PresetItem[] => {
    return listSystemPromptPresetNames().map((name) => ({
      value: name,
      label: name,
    }));
  }, [settings.trackerSystemPromptMode, settings.trackerSystemPromptSavedName, systemPromptRefreshRevision]);

  const currentGlobalSystemPromptName = getCurrentGlobalSystemPromptName();
  const showSharedSystemPromptWarning = shouldWarnAboutSharedSystemPromptSelection(settings);
  const showMissingSavedSystemPromptWarning =
    settings.trackerSystemPromptMode === 'saved' &&
    settings.trackerSystemPromptSavedName.trim().length > 0 &&
    systemPromptItems.length > 0 &&
    !hasSystemPromptPreset(settings.trackerSystemPromptSavedName);

  const refreshSystemPromptState = useCallback(() => {
    setSystemPromptRefreshRevision((revision) => revision + 1);
  }, []);

  useEffect(() => {
    setSchemaText(formatSchemaText(settings.schemaPresets[settings.schemaPreset]));
  }, [settings.schemaPreset, settings.schemaPresets]);

  // Handler for when a new schema preset is selected
  const handleSchemaPresetChange = (newValue?: string) => {
    let nextSchemaText: string | undefined;

    updateAndRefresh((currentSettings) => {
      const selection = resolvePresetSelection(currentSettings.schemaPresets, newValue);
      if (!selection) {
        return;
      }

      currentSettings.schemaPreset = selection.key;
      nextSchemaText = formatSchemaText(selection.preset);
    });

    if (nextSchemaText !== undefined) {
      setSchemaText(nextSchemaText);
    }
  };

  // Handler for when the list of presets is modified (created, renamed, deleted)
  const handleSchemaPresetsListChange = (newItems: PresetItem[]) => {
    let nextSchemaText = '';

    updateAndRefresh((currentSettings) => {
      const nextState = reconcilePresetItems(currentSettings.schemaPresets, currentSettings.schemaPreset, newItems);
      currentSettings.schemaPreset = nextState.activeKey;
      currentSettings.schemaPresets = nextState.presets;
      nextSchemaText = formatSchemaText(nextState.presets[nextState.activeKey]);
    });

    setSchemaText(nextSchemaText);
  };


  // Handler for the schema JSON textarea
  const handleSchemaValueChange = (newSchemaText: string) => {
    setSchemaText(newSchemaText); // Update UI immediately
    try {
      const parsedJson = JSON.parse(newSchemaText);
      updateAndRefresh((s) => {
        const preset = s.schemaPresets[s.schemaPreset];
        if (preset) {
          // Create a new presets object with the updated value
          s.schemaPresets = {
            ...s.schemaPresets,
            [s.schemaPreset]: { ...preset, value: parsedJson },
          };
        }
      });
    } catch (e) {
      // Invalid JSON, do nothing until it's valid. A visual error could be added.
    }
  };

  // Handler for the schema HTML textarea
  const handleSchemaHtmlChange = (newHtml: string) => {
    updateAndRefresh((s) => {
      const preset = s.schemaPresets[s.schemaPreset];
      if (preset) {
        // Create a new presets object with the updated html
        s.schemaPresets = {
          ...s.schemaPresets,
          [s.schemaPreset]: { ...preset, html: newHtml },
        };
      }
    });
  };

  // Restore the current schema preset to its default values
  const restoreSchemaToDefault = async () => {
    const confirm = await SillyTavern.getContext().Popup.show.confirm(
      'Restore Default',
      'Are you sure you want to restore the default schema and HTML for this preset?',
    );
    if (!confirm) return;

    let nextSchemaText = '';
    updateAndRefresh((currentSettings) => {
      const preset = currentSettings.schemaPresets[currentSettings.schemaPreset];
      if (preset) {
        currentSettings.schemaPresets = {
          ...currentSettings.schemaPresets,
          [currentSettings.schemaPreset]: {
            ...preset,
            value: DEFAULT_SCHEMA_VALUE,
            html: DEFAULT_SCHEMA_HTML,
          },
        };
        nextSchemaText = formatSchemaText(currentSettings.schemaPresets[currentSettings.schemaPreset]);
      }
    });
    setSchemaText(nextSchemaText);
  };

  return (
    <div className="ztracker-settings">
      <div className="inline-drawer">
        <div className="inline-drawer-toggle inline-drawer-header">
          <b>zTracker</b>
          <div className="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div className="inline-drawer-content">
          <div className="ztracker-container">
            <div className="setting-row">
              <label title="Which SillyTavern Connection Profile zTracker uses when generating trackers.">Connection Profile</label>
              <STConnectionProfileSelect
                initialSelectedProfileId={settings.profileId}
                onChange={(profile) =>
                  updateAndRefresh((s) => {
                    s.profileId = profile?.id ?? '';
                  })
                }
              />
            </div>

            <SettingsSectionDrawer
              title="Tracker Generation"
              isOpen={isGenerationOpen}
              onToggle={() => setGenerationOpen((value) => !value)}
            >
              <TrackerGenerationSection
                settings={settings}
                updateAndRefresh={updateAndRefresh}
                schemaPresetItems={schemaPresetItems}
                handleSchemaPresetChange={handleSchemaPresetChange}
                handleSchemaPresetsListChange={handleSchemaPresetsListChange}
                schemaText={schemaText}
                handleSchemaValueChange={handleSchemaValueChange}
                handleSchemaHtmlChange={handleSchemaHtmlChange}
                restoreSchemaToDefault={restoreSchemaToDefault}
                systemPromptItems={systemPromptItems}
                refreshSystemPromptState={refreshSystemPromptState}
                showMissingSavedSystemPromptWarning={showMissingSavedSystemPromptWarning}
                showSharedSystemPromptWarning={showSharedSystemPromptWarning}
                currentGlobalSystemPromptName={currentGlobalSystemPromptName}
              />
            </SettingsSectionDrawer>

            <SettingsSectionDrawer
              title="Tracker Injection"
              isOpen={isInjectionOpen}
              onToggle={() => setInjectionOpen((value) => !value)}
            >
              <TrackerInjectionSection settings={settings} updateAndRefresh={updateAndRefresh} />
            </SettingsSectionDrawer>

            <DiagnosticsSection
              debugLogging={!!settings.debugLogging}
              setDebugLogging={(value) =>
                updateAndRefresh((s) => {
                  s.debugLogging = value;
                })
              }
              diagnosticsText={diagnosticsText}
              setDiagnosticsText={setDiagnosticsText}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
