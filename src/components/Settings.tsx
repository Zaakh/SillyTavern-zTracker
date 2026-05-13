import { FC, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { STConnectionProfileSelect, PresetItem } from 'sillytavern-utils-lib/components/react';
import { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import {
  ExtensionSettings,
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
import {
  reconcilePresetItems,
  resolvePresetSelection,
} from './settings/preset-state.js';
import {
  formatSchemaHtml,
  formatSchemaText,
  getSchemaDraftState,
  getSchemaHtmlDraftState,
  shouldSyncSchemaHtmlFromSettings,
  shouldSyncSchemaTextFromSettings,
  validateSchemaDraft,
  validateSchemaHtmlDraft,
} from './settings/schema-editor-state.js';
import { SettingsSectionDrawer } from './settings/SettingsSectionDrawer.js';
import { TrackerGenerationSection } from './settings/TrackerGenerationSection.js';
import { TrackerInjectionSection } from './settings/TrackerInjectionSection.js';

// Initialize the settings manager once, outside the component
export const settingsManager = new ExtensionSettingsManager<ExtensionSettings>(EXTENSION_KEY, defaultSettings);

export const ZTrackerSettings: FC = () => {
  const forceUpdate = useForceUpdate();
  const settings = settingsManager.getSettings();
  const previousSchemaPresetRef = useRef(settings.schemaPreset);

  const [diagnosticsText, setDiagnosticsText] = useState<string>('');
  const [systemPromptRefreshRevision, setSystemPromptRefreshRevision] = useState(0);
  const [isGenerationOpen, setGenerationOpen] = useState(true);
  const [isInjectionOpen, setInjectionOpen] = useState(true);

  const [schemaText, setSchemaText] = useState(formatSchemaText(settings.schemaPresets[settings.schemaPreset]));
  const [schemaHtmlText, setSchemaHtmlText] = useState(formatSchemaHtml(settings.schemaPresets[settings.schemaPreset]));

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

  const activeSchemaText = formatSchemaText(settings.schemaPresets[settings.schemaPreset]);
  const schemaDraftState = getSchemaDraftState({ currentText: schemaText, persistedText: activeSchemaText });
  const activeSchemaHtml = formatSchemaHtml(settings.schemaPresets[settings.schemaPreset]);
  const schemaHtmlDraftState = getSchemaHtmlDraftState({ currentText: schemaHtmlText, persistedText: activeSchemaHtml });

  useEffect(() => {
    const activePresetChanged = previousSchemaPresetRef.current !== settings.schemaPreset;
    previousSchemaPresetRef.current = settings.schemaPreset;

    if (
      shouldSyncSchemaTextFromSettings({
        currentText: schemaText,
        persistedText: activeSchemaText,
        activePresetChanged,
      }) &&
      schemaText !== activeSchemaText
    ) {
      setSchemaText(activeSchemaText);
    }

    if (
      shouldSyncSchemaHtmlFromSettings({
        currentText: schemaHtmlText,
        persistedText: activeSchemaHtml,
        activePresetChanged,
      }) &&
      schemaHtmlText !== activeSchemaHtml
    ) {
      setSchemaHtmlText(activeSchemaHtml);
    }
  }, [activeSchemaHtml, activeSchemaText, schemaHtmlText, schemaText, settings.schemaPreset]);

  // Handler for when a new schema preset is selected
  const handleSchemaPresetChange = (newValue?: string) => {
    let nextSchemaText: string | undefined;
    let nextSchemaHtmlText: string | undefined;

    updateAndRefresh((currentSettings) => {
      const selection = resolvePresetSelection(currentSettings.schemaPresets, newValue);
      if (!selection) {
        return;
      }

      currentSettings.schemaPreset = selection.key;
      nextSchemaText = formatSchemaText(selection.preset);
      nextSchemaHtmlText = formatSchemaHtml(selection.preset);
    });

    if (nextSchemaText !== undefined) {
      setSchemaText(nextSchemaText);
    }

    if (nextSchemaHtmlText !== undefined) {
      setSchemaHtmlText(nextSchemaHtmlText);
    }
  };

  // Handler for when the list of presets is modified (created, renamed, deleted)
  const handleSchemaPresetsListChange = (newItems: PresetItem[]) => {
    let nextSchemaText = '';
    let nextSchemaHtmlText = '';
    let shouldPreserveDrafts = false;

    updateAndRefresh((currentSettings) => {
      const nextState = reconcilePresetItems(currentSettings.schemaPresets, currentSettings.schemaPreset, newItems);
      shouldPreserveDrafts = (currentSettings.schemaPreset ?? 'default') === nextState.activeKey;
      currentSettings.schemaPreset = nextState.activeKey;
      currentSettings.schemaPresets = nextState.presets;
      nextSchemaText = formatSchemaText(nextState.presets[nextState.activeKey]);
      nextSchemaHtmlText = formatSchemaHtml(nextState.presets[nextState.activeKey]);
    });

    if (!shouldPreserveDrafts) {
      setSchemaText(nextSchemaText);
      setSchemaHtmlText(nextSchemaHtmlText);
    }
  };


  // Handler for the schema JSON textarea
  const handleSchemaValueChange = (newSchemaText: string) => {
    // Keep the JSON draft local until the user explicitly saves it.
    setSchemaText(newSchemaText);
  };

  // Persists the active preset's JSON schema only after explicit confirmation.
  const saveSchemaValue = () => {
    const validation = validateSchemaDraft(schemaText);
    if (!validation.isValid) {
      return;
    }

    const parsedJson = JSON.parse(schemaText);
    let nextSchemaText = schemaText;
    updateAndRefresh((currentSettings) => {
      const preset = currentSettings.schemaPresets[currentSettings.schemaPreset];
      if (!preset) {
        return;
      }

      const nextPreset = { ...preset, value: parsedJson };
      currentSettings.schemaPresets = {
        ...currentSettings.schemaPresets,
        [currentSettings.schemaPreset]: nextPreset,
      };
      nextSchemaText = formatSchemaText(nextPreset);
    });
    setSchemaText(nextSchemaText);
  };

  // Handler for the schema HTML textarea
  const handleSchemaHtmlChange = (newHtml: string) => {
    // Keep the HTML draft local until the user explicitly saves it.
    setSchemaHtmlText(newHtml);
  };

  // Persists the active preset's HTML template only after explicit confirmation.
  const saveSchemaHtmlValue = () => {
    const validation = validateSchemaHtmlDraft(schemaHtmlText);
    if (!validation.isValid) {
      return;
    }

    let nextSchemaHtmlValue = schemaHtmlText;
    updateAndRefresh((currentSettings) => {
      const preset = currentSettings.schemaPresets[currentSettings.schemaPreset];
      if (!preset) {
        return;
      }

      const nextPreset = { ...preset, html: schemaHtmlText };
      currentSettings.schemaPresets = {
        ...currentSettings.schemaPresets,
        [currentSettings.schemaPreset]: nextPreset,
      };
      nextSchemaHtmlValue = formatSchemaHtml(nextPreset);
    });
    setSchemaHtmlText(nextSchemaHtmlValue);
  };

  // Restore the current schema preset to its default values
  const restoreSchemaToDefault = async () => {
    const confirm = await SillyTavern.getContext().Popup.show.confirm(
      'Restore Default',
      'Are you sure you want to restore the default schema and HTML for this preset?',
    );
    if (!confirm) return;

    let nextSchemaText = '';
    let nextSchemaHtmlText = '';
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
        nextSchemaHtmlText = formatSchemaHtml(currentSettings.schemaPresets[currentSettings.schemaPreset]);
      }
    });
    setSchemaText(nextSchemaText);
    setSchemaHtmlText(nextSchemaHtmlText);
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
                schemaTextHasError={!schemaDraftState.isValid}
                schemaTextError={schemaDraftState.errorMessage}
                schemaTextHasUnsavedChanges={schemaDraftState.isDirty}
                schemaTextCanSave={schemaDraftState.canSave}
                schemaHtmlText={schemaHtmlText}
                schemaHtmlTextHasError={!schemaHtmlDraftState.isValid}
                schemaHtmlTextError={schemaHtmlDraftState.errorMessage}
                schemaHtmlTextHasUnsavedChanges={schemaHtmlDraftState.isDirty}
                schemaHtmlTextCanSave={schemaHtmlDraftState.canSave}
                handleSchemaValueChange={handleSchemaValueChange}
                handleSchemaHtmlChange={handleSchemaHtmlChange}
                saveSchemaValue={saveSchemaValue}
                saveSchemaHtmlValue={saveSchemaHtmlValue}
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
