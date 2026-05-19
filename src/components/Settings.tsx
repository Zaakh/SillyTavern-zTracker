import { FC, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { STConnectionProfileSelect, PresetItem } from 'sillytavern-utils-lib/components/react';
import { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import {
  ExtensionSettings,
  CHAT_METADATA_SCHEMA_PRESET_KEY,
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
  validateSchemaPresetDraftPair,
  validateSchemaHtmlDraft,
} from './settings/schema-editor-state.js';
import { SettingsSectionDrawer } from './settings/SettingsSectionDrawer.js';
import { TrackerGenerationSection } from './settings/TrackerGenerationSection.js';
import { TrackerInjectionSection } from './settings/TrackerInjectionSection.js';

// Initialize the settings manager once, outside the component
export const settingsManager = new ExtensionSettingsManager<ExtensionSettings>(EXTENSION_KEY, defaultSettings);

type ResolvedSchemaPresetSelection = {
  key: string;
  label: string;
  usedFallback: boolean;
};

type CurrentChatSchemaPresetState = {
  isAvailable: boolean;
  selection: ResolvedSchemaPresetSelection | null;
  storedSchemaKey?: string;
  hasStoredSchemaKey: boolean;
  hasValidStoredSchemaKey: boolean;
};

/** Returns the current chat's extension metadata record, creating it only when explicitly requested. */
function getExtensionChatMetadataRecord(chatMetadata: unknown, createIfMissing = false): Record<string, any> | undefined {
  if (!chatMetadata || typeof chatMetadata !== 'object') {
    return undefined;
  }

  const metadataRecord = chatMetadata as Record<string, any>;
  const currentValue = metadataRecord[EXTENSION_KEY];
  if (currentValue && typeof currentValue === 'object') {
    return currentValue as Record<string, any>;
  }

  if (!createIfMissing) {
    return undefined;
  }

  metadataRecord[EXTENSION_KEY] = {};
  return metadataRecord[EXTENSION_KEY] as Record<string, any>;
}

/** Reads the stored schema preset key from the active chat when one exists. */
function readStoredChatSchemaPresetKey(chatMetadata: unknown): string | undefined {
  const extensionMetadata = getExtensionChatMetadataRecord(chatMetadata);
  const storedSchemaKey = extensionMetadata?.[CHAT_METADATA_SCHEMA_PRESET_KEY];
  return typeof storedSchemaKey === 'string' && storedSchemaKey.trim().length > 0 ? storedSchemaKey : undefined;
}

/** Persists one chat-level schema preset selection when it actually changes. */
function persistChatSchemaPreset(context: any, schemaPresetKey: string): boolean {
  const extensionMetadata = getExtensionChatMetadataRecord(context?.chatMetadata, true);
  if (!extensionMetadata || extensionMetadata[CHAT_METADATA_SCHEMA_PRESET_KEY] === schemaPresetKey) {
    return false;
  }

  extensionMetadata[CHAT_METADATA_SCHEMA_PRESET_KEY] = schemaPresetKey;
  if (typeof context?.saveMetadataDebounced === 'function') {
    context.saveMetadataDebounced();
  }
  return true;
}

/** Resolves one schema preset key against the current settings and falls back to the active default when missing. */
function resolveSchemaPresetSelection(
  schemaPresets: ExtensionSettings['schemaPresets'],
  fallbackKey: string,
  requestedKey?: string,
): ResolvedSchemaPresetSelection | null {
  const presetEntries = Object.entries(schemaPresets ?? {});
  if (presetEntries.length === 0) {
    return null;
  }

  const normalizedFallbackKey = schemaPresets[fallbackKey] ? fallbackKey : presetEntries[0][0];
  const resolvedKey = requestedKey && schemaPresets[requestedKey] ? requestedKey : normalizedFallbackKey;
  return {
    key: resolvedKey,
    label: schemaPresets[resolvedKey]?.name ?? resolvedKey,
    usedFallback: resolvedKey !== requestedKey,
  };
}

/** Reads the active chat schema state from live SillyTavern chat metadata without holding a stale reference. */
function getCurrentChatSchemaPresetState(settings: ExtensionSettings): CurrentChatSchemaPresetState {
  const context = SillyTavern.getContext();
  const chatMetadata = context?.chatMetadata;
  if (!chatMetadata || typeof chatMetadata !== 'object') {
    return {
      isAvailable: false,
      selection: null,
      storedSchemaKey: undefined,
      hasStoredSchemaKey: false,
      hasValidStoredSchemaKey: false,
    };
  }

  const storedSchemaKey = readStoredChatSchemaPresetKey(chatMetadata);
  const hasValidStoredSchemaKey = typeof storedSchemaKey === 'string' && !!settings.schemaPresets[storedSchemaKey];
  return {
    isAvailable: true,
    selection: resolveSchemaPresetSelection(settings.schemaPresets, settings.schemaPreset, storedSchemaKey),
    storedSchemaKey,
    hasStoredSchemaKey: typeof storedSchemaKey === 'string' && storedSchemaKey.trim().length > 0,
    hasValidStoredSchemaKey,
  };
}

export const ZTrackerSettings: FC = () => {
  const forceUpdate = useForceUpdate();
  const settings = settingsManager.getSettings();
  const connectionSource = settings.connectionSource ?? 'saved';
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
  const currentChatSchemaPresetState = getCurrentChatSchemaPresetState(settings);

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
  const schemaPresetPairValidation = useMemo(
    () => (schemaDraftState.isValid && schemaHtmlDraftState.isValid
      ? validateSchemaPresetDraftPair({ schemaText, schemaHtmlText })
      : { isValid: true }),
    [schemaDraftState.isValid, schemaHtmlDraftState.isValid, schemaText, schemaHtmlText],
  );
  const schemaPresetPairError = schemaPresetPairValidation.isValid ? undefined : schemaPresetPairValidation.errorMessage;
  const schemaTextCanSave = schemaDraftState.canSave && schemaPresetPairValidation.isValid;
  const schemaHtmlTextCanSave = schemaHtmlDraftState.canSave && schemaPresetPairValidation.isValid;

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

  // Persists the active chat schema preset without changing the global default or preset editor selection.
  const handleCurrentChatSchemaPresetChange = (newValue?: string) => {
    const context = SillyTavern.getContext();
    const chatMetadata = context?.chatMetadata;
    if (!chatMetadata || typeof chatMetadata !== 'object') {
      return;
    }

    const selection = resolveSchemaPresetSelection(settings.schemaPresets, settings.schemaPreset, newValue);
    if (!selection) {
      return;
    }

    if (persistChatSchemaPreset(context, selection.key)) {
      forceUpdate();
    }
  };

  // Handler for when the list of presets is modified (created, renamed, deleted)
  const handleSchemaPresetsListChange = (newItems: PresetItem[]) => {
    let nextSchemaText = '';
    let nextSchemaHtmlText = '';
    let preservesActiveDrafts = false;
    let shouldRefreshChatSchemaState = false;

    updateAndRefresh((currentSettings) => {
      const context = SillyTavern.getContext();
      const storedChatSchemaKey = readStoredChatSchemaPresetKey(context?.chatMetadata);
      const nextState = reconcilePresetItems(currentSettings.schemaPresets, currentSettings.schemaPreset, newItems);
      preservesActiveDrafts = nextState.preservesActiveDrafts;
      currentSettings.schemaPreset = nextState.activeKey;
      currentSettings.schemaPresets = nextState.presets;
      nextSchemaText = formatSchemaText(nextState.presets[nextState.activeKey]);
      nextSchemaHtmlText = formatSchemaHtml(nextState.presets[nextState.activeKey]);

      if (storedChatSchemaKey && !nextState.presets[storedChatSchemaKey]) {
        const nextChatSelection = resolveSchemaPresetSelection(nextState.presets, nextState.activeKey, storedChatSchemaKey);
        if (nextChatSelection && persistChatSchemaPreset(context, nextChatSelection.key)) {
          shouldRefreshChatSchemaState = true;
        }
      }
    });

    if (!preservesActiveDrafts) {
      setSchemaText(nextSchemaText);
      setSchemaHtmlText(nextSchemaHtmlText);
    }

    if (shouldRefreshChatSchemaState) {
      forceUpdate();
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
    if (!validation.isValid || !schemaPresetPairValidation.isValid) {
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
    if (!validation.isValid || !schemaPresetPairValidation.isValid) {
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
              <label title="Choose whether zTracker uses the currently active SillyTavern connection or a specific saved connection profile.">Connection Source</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                <select
                  className="text_pole"
                  title="Choose whether zTracker uses the currently active SillyTavern connection or a specific saved connection profile."
                  value={connectionSource}
                  onChange={(e) =>
                    updateAndRefresh((s) => {
                      s.connectionSource = e.target.value as ExtensionSettings['connectionSource'];
                    })
                  }
                >
                  <option value="active">Use current active SillyTavern connection</option>
                  <option value="saved">Use selected saved connection profile</option>
                </select>
                {connectionSource === 'active' && (
                  <small>
                    zTracker follows the live SillyTavern connection currently in use, including active unsaved connection changes.
                  </small>
                )}
              </div>
            </div>

            {connectionSource === 'saved' && (
              <div className="setting-row">
                <label title="Which saved SillyTavern Connection Profile zTracker uses when generating trackers.">Connection Profile</label>
                <STConnectionProfileSelect
                  initialSelectedProfileId={settings.profileId}
                  onChange={(profile) =>
                    updateAndRefresh((s) => {
                      s.profileId = profile?.id ?? '';
                    })
                  }
                />
              </div>
            )}

            <SettingsSectionDrawer
              title="Tracker Generation"
              isOpen={isGenerationOpen}
              onToggle={() => setGenerationOpen((value) => !value)}
            >
              <TrackerGenerationSection
                settings={settings}
                updateAndRefresh={updateAndRefresh}
                schemaPresetItems={schemaPresetItems}
                currentChatSchemaPresetKey={currentChatSchemaPresetState.selection?.key}
                currentChatSchemaPresetLabel={currentChatSchemaPresetState.selection?.label}
                currentChatSchemaPresetUsesDefault={!!currentChatSchemaPresetState.selection?.usedFallback}
                currentChatSchemaPresetAvailable={currentChatSchemaPresetState.isAvailable}
                currentChatSchemaPresetStoredKey={currentChatSchemaPresetState.storedSchemaKey}
                currentChatSchemaPresetHasStoredValue={currentChatSchemaPresetState.hasStoredSchemaKey}
                currentChatSchemaPresetHasValidStoredValue={currentChatSchemaPresetState.hasValidStoredSchemaKey}
                handleSchemaPresetChange={handleSchemaPresetChange}
                handleCurrentChatSchemaPresetChange={handleCurrentChatSchemaPresetChange}
                handleSchemaPresetsListChange={handleSchemaPresetsListChange}
                schemaText={schemaText}
                schemaTextHasError={!schemaDraftState.isValid}
                schemaTextError={schemaDraftState.errorMessage}
                schemaTextHasUnsavedChanges={schemaDraftState.isDirty}
                schemaTextCanSave={schemaTextCanSave}
                schemaHtmlText={schemaHtmlText}
                schemaHtmlTextHasError={!schemaHtmlDraftState.isValid}
                schemaHtmlTextError={schemaHtmlDraftState.errorMessage}
                schemaHtmlTextHasUnsavedChanges={schemaHtmlDraftState.isDirty}
                schemaHtmlTextCanSave={schemaHtmlTextCanSave}
                schemaPresetPairError={schemaPresetPairError}
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
