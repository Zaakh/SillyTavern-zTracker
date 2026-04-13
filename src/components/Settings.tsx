import { FC, useState, useMemo, useCallback } from 'react';
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
import { SettingsSectionDrawer } from './settings/SettingsSectionDrawer.js';
import { TrackerGenerationSection } from './settings/TrackerGenerationSection.js';
import { TrackerInjectionSection } from './settings/TrackerInjectionSection.js';

// Initialize the settings manager once, outside the component
export const settingsManager = new ExtensionSettingsManager<ExtensionSettings>(EXTENSION_KEY, defaultSettings);

export const ZTrackerSettings: FC = () => {
  const forceUpdate = useForceUpdate();
  const settings = settingsManager.getSettings();

  const [diagnosticsText, setDiagnosticsText] = useState<string>('');
  const [systemPromptRefreshRevision, setSystemPromptRefreshRevision] = useState(0);
  const [isGenerationOpen, setGenerationOpen] = useState(true);
  const [isInjectionOpen, setInjectionOpen] = useState(true);

  const [schemaText, setSchemaText] = useState(
    JSON.stringify(settings.schemaPresets[settings.schemaPreset]?.value, null, 2) ?? '',
  );

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


  // Handler for when a new schema preset is selected
  const handleSchemaPresetChange = (newValue?: string) => {
    const newPresetKey = newValue ?? 'default';
    const newPreset = settings.schemaPresets[newPresetKey];
    if (newPreset) {
      updateAndRefresh((settings) => {
        settings.schemaPreset = newPresetKey;
      });
      setSchemaText(JSON.stringify(newPreset.value, null, 2));
    }
  };

  // Handler for when the list of presets is modified (created, renamed, deleted)
  const handleSchemaPresetsListChange = (newItems: PresetItem[]) => {
    updateAndRefresh((s) => {
      const newPresets: Record<string, Schema> = {};
      newItems.forEach((item) => {
        newPresets[item.value] =
          s.schemaPresets[item.value] ?? structuredClone(s.schemaPresets[s.schemaPreset] ?? s.schemaPresets['default']);
        // Ensure name is updated on rename
        newPresets[item.value].name = item.label;
      });
      s.schemaPresets = newPresets;
    });
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

    const currentPresetKey = settings.schemaPreset;
    updateAndRefresh((s) => {
      const preset = s.schemaPresets[currentPresetKey];
      if (preset) {
        s.schemaPresets = {
          ...s.schemaPresets,
          [currentPresetKey]: {
            ...preset,
            value: DEFAULT_SCHEMA_VALUE,
            html: DEFAULT_SCHEMA_HTML,
          },
        };
      }
    });
    setSchemaText(JSON.stringify(DEFAULT_SCHEMA_VALUE, null, 2));
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
