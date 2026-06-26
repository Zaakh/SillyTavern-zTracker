import { FC, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { STConnectionProfileSelect, PresetItem } from 'sillytavern-utils-lib/components/react';
import { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import { st_echo } from 'sillytavern-utils-lib/config';
import {
  ExtensionSettings,
  TrackerModule,
  CHAT_METADATA_SCHEMA_PRESET_KEY,
  applySettingsToTrackerModule,
  createDefaultTrackerModule,
  createTrackerModuleId,
  getOrderedTrackerModules,
  getSettingsForTrackerModule,
  purgeTrackerModuleDataFromChat,
  readModuleChatSchemaPresetKey,
  writeModuleChatSchemaPresetKey,
  DEFAULT_SCHEMA_VALUE,
  DEFAULT_SCHEMA_HTML,
  defaultSettings,
  EXTENSION_KEY,
} from '../config.js';
import { useForceUpdate } from '../hooks/useForceUpdate.js';
import { readTextFileViaPicker } from '../file-picker.js';
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

type ImportedTrackerModule = Partial<Omit<TrackerModule, 'auto' | 'schema' | 'prompts' | 'systemPrompt' | 'connection' | 'generation' | 'injection'>>
  & Pick<TrackerModule, 'name'>
  & {
    auto?: Partial<TrackerModule['auto']>;
    schema?: Partial<TrackerModule['schema']>;
    prompts?: Partial<TrackerModule['prompts']>;
    systemPrompt?: Partial<TrackerModule['systemPrompt']>;
    connection?: Partial<TrackerModule['connection']>;
    generation?: Partial<TrackerModule['generation']>;
    injection?: Partial<TrackerModule['injection']>;
  };

const MODULE_EXPORT_VERSION = 1;

function normalizeModuleOrder(modules: TrackerModule[]): void {
  modules.forEach((module, index) => {
    module.order = index;
  });
}

function parseImportedTrackerModule(text: string): ImportedTrackerModule | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const parsedRecord = parsed as Record<string, unknown>;
    const module = (parsedRecord.module && typeof parsedRecord.module === 'object'
      ? parsedRecord.module
      : parsedRecord) as Partial<ImportedTrackerModule>;
    if (!module || typeof module !== 'object' || typeof module.name !== 'string' || !module.name.trim()) {
      return null;
    }
    return module as ImportedTrackerModule;
  } catch {
    return null;
  }
}

function createImportedTrackerModule(importedModule: ImportedTrackerModule, modules: TrackerModule[]): TrackerModule {
  const id = createTrackerModuleId(modules, importedModule.id || importedModule.name);
  const base = createDefaultTrackerModule({ id, name: importedModule.name.trim(), order: modules.length });
  return {
    ...base,
    ...JSON.parse(JSON.stringify(importedModule)),
    id,
    name: importedModule.name.trim(),
    enabled: importedModule.enabled ?? base.enabled,
    order: modules.length,
    auto: { ...base.auto, ...importedModule.auto },
    schema: { ...base.schema, ...importedModule.schema },
    prompts: { ...base.prompts, ...importedModule.prompts },
    systemPrompt: { ...base.systemPrompt, ...importedModule.systemPrompt },
    connection: { ...base.connection, ...importedModule.connection },
    generation: { ...base.generation, ...importedModule.generation },
    injection: { ...base.injection, ...importedModule.injection },
  };
}

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
function readStoredChatSchemaPresetKey(chatMetadata: unknown, moduleId: string): string | undefined {
  return readModuleChatSchemaPresetKey(chatMetadata, moduleId);
}

/** Persists one chat-level schema preset selection when it actually changes. */
async function persistChatSchemaPreset(context: any, schemaPresetKey: string, moduleId: string): Promise<boolean> {
  const extensionMetadata = getExtensionChatMetadataRecord(context?.chatMetadata, true);
  const previousSchemaPresetKey = readStoredChatSchemaPresetKey(context?.chatMetadata, moduleId);
  if (!extensionMetadata || previousSchemaPresetKey === schemaPresetKey) {
    return false;
  }

  writeModuleChatSchemaPresetKey(context?.chatMetadata, schemaPresetKey, moduleId);
  if (typeof context?.saveMetadata === 'function') {
    try {
      await Promise.resolve(context.saveMetadata());
    } catch (error) {
      writeModuleChatSchemaPresetKey(context?.chatMetadata, previousSchemaPresetKey, moduleId);
      console.error('zTracker: failed to save current chat schema preset metadata.', error);
      await st_echo('error', 'Current chat schema preset could not be saved. The selector was reverted.');
      return false;
    }
  } else if (typeof context?.saveMetadataDebounced === 'function') {
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
function getCurrentChatSchemaPresetState(settings: ExtensionSettings, moduleId: string): CurrentChatSchemaPresetState {
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

  const storedSchemaKey = readStoredChatSchemaPresetKey(chatMetadata, moduleId);
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
  const orderedModules = getOrderedTrackerModules(settings, { includeDisabled: true });
  const [selectedModuleId, setSelectedModuleId] = useState(() => orderedModules[0]?.id ?? defaultSettings.modules[0].id);
  const selectedModule = orderedModules.find((module) => module.id === selectedModuleId) ?? orderedModules[0] ?? defaultSettings.modules[0];
  const moduleSettings = getSettingsForTrackerModule(settings, selectedModule.id);
  const connectionSource = moduleSettings.connectionSource ?? 'saved';
  const previousSchemaPresetRef = useRef(moduleSettings.schemaPreset);

  const [diagnosticsText, setDiagnosticsText] = useState<string>('');
  const [systemPromptRefreshRevision, setSystemPromptRefreshRevision] = useState(0);
  const [isGenerationOpen, setGenerationOpen] = useState(true);
  const [isInjectionOpen, setInjectionOpen] = useState(true);

  const [schemaText, setSchemaText] = useState(formatSchemaText(moduleSettings.schemaPresets[moduleSettings.schemaPreset]));
  const [schemaHtmlText, setSchemaHtmlText] = useState(formatSchemaHtml(moduleSettings.schemaPresets[moduleSettings.schemaPreset]));

  const updateAndRefresh = useCallback(
    (updater: (currentSettings: ExtensionSettings) => void) => {
      const currentSettings = settingsManager.getSettings();
      updater(currentSettings);
      settingsManager.saveSettings();
      forceUpdate();
    },
    [forceUpdate],
  );

  const updateSelectedModuleAndRefresh = useCallback(
    (updater: (currentSettings: ExtensionSettings) => void) => {
      updateAndRefresh((currentSettings) => {
        const module = currentSettings.modules?.find((candidate) => candidate.id === selectedModuleId)
          ?? currentSettings.modules?.[0];
        if (!module) {
          updater(currentSettings);
          return;
        }

        const moduleDraft = getSettingsForTrackerModule(currentSettings, module.id);
        updater(moduleDraft);
        applySettingsToTrackerModule(module, moduleDraft);
        if (moduleDraft.autoMode !== 'none') {
          currentSettings.autoMode = moduleDraft.autoMode;
        }
      });
    },
    [selectedModuleId, updateAndRefresh],
  );

  useEffect(() => {
    if (orderedModules.some((module) => module.id === selectedModuleId)) {
      return;
    }
    setSelectedModuleId(orderedModules[0]?.id ?? defaultSettings.modules[0].id);
  }, [orderedModules, selectedModuleId]);

  // Memoized data for the schema preset dropdown
  const schemaPresetItems = useMemo((): PresetItem[] => {
    return Object.entries(moduleSettings.schemaPresets).map(([value, preset]) => ({
      value,
      label: preset.name,
    }));
  }, [moduleSettings.schemaPresets]);
  const currentChatSchemaPresetState = getCurrentChatSchemaPresetState(moduleSettings, selectedModule.id);

  const systemPromptItems = useMemo((): PresetItem[] => {
    return listSystemPromptPresetNames().map((name) => ({
      value: name,
      label: name,
    }));
  }, [moduleSettings.trackerSystemPromptMode, moduleSettings.trackerSystemPromptSavedName, systemPromptRefreshRevision]);

  const currentGlobalSystemPromptName = getCurrentGlobalSystemPromptName();
  const showSharedSystemPromptWarning = shouldWarnAboutSharedSystemPromptSelection(moduleSettings);
  const showMissingSavedSystemPromptWarning =
    moduleSettings.trackerSystemPromptMode === 'saved' &&
    moduleSettings.trackerSystemPromptSavedName.trim().length > 0 &&
    systemPromptItems.length > 0 &&
    !hasSystemPromptPreset(moduleSettings.trackerSystemPromptSavedName);

  const refreshSystemPromptState = useCallback(() => {
    setSystemPromptRefreshRevision((revision) => revision + 1);
  }, []);

  const activeSchemaText = formatSchemaText(moduleSettings.schemaPresets[moduleSettings.schemaPreset]);
  const schemaDraftState = getSchemaDraftState({ currentText: schemaText, persistedText: activeSchemaText });
  const activeSchemaHtml = formatSchemaHtml(moduleSettings.schemaPresets[moduleSettings.schemaPreset]);
  const schemaHtmlDraftState = getSchemaHtmlDraftState({ currentText: schemaHtmlText, persistedText: activeSchemaHtml });
  const schemaPresetPairValidation = useMemo(
    () => (schemaDraftState.isValid && schemaHtmlDraftState.isValid
      ? validateSchemaPresetDraftPair({ schemaText, schemaHtmlText })
      : { isValid: true }),
    [schemaDraftState.isValid, schemaHtmlDraftState.isValid, schemaText, schemaHtmlText],
  );
  const schemaPresetPairError = schemaPresetPairValidation.isValid ? undefined : schemaPresetPairValidation.errorMessage;
  const schemaPresetPairCanSave =
    (schemaDraftState.isDirty || schemaHtmlDraftState.isDirty) &&
    schemaDraftState.isValid &&
    schemaHtmlDraftState.isValid &&
    schemaPresetPairValidation.isValid;

  useEffect(() => {
    const activePresetChanged = previousSchemaPresetRef.current !== moduleSettings.schemaPreset;
    previousSchemaPresetRef.current = moduleSettings.schemaPreset;

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
  }, [activeSchemaHtml, activeSchemaText, schemaHtmlText, schemaText, moduleSettings.schemaPreset]);

  // Handler for when a new schema preset is selected
  const handleSchemaPresetChange = (newValue?: string) => {
    let nextSchemaText: string | undefined;
    let nextSchemaHtmlText: string | undefined;

    updateSelectedModuleAndRefresh((currentSettings) => {
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

  // Renames the active preset key in-place so chat metadata and unsaved drafts stay attached to the same preset.
  const handleSchemaPresetRename = (currentKey: string, newKey: string) => {
    if (!currentKey || !newKey || currentKey === newKey) {
      return;
    }

    let shouldMigrateChatSchemaState = false;
    let renamedActivePreset = false;

    updateSelectedModuleAndRefresh((currentSettings) => {
      const currentPreset = currentSettings.schemaPresets[currentKey];
      if (!currentPreset || currentSettings.schemaPresets[newKey]) {
        return;
      }

      const nextSchemaPresets = Object.fromEntries(
        Object.entries(currentSettings.schemaPresets).map(([presetKey, preset]) => (
          presetKey === currentKey
            ? [[newKey, { ...preset, name: newKey }]]
            : [[presetKey, preset]]
        )).flat(),
      ) as ExtensionSettings['schemaPresets'];

      currentSettings.schemaPresets = nextSchemaPresets;
      if (currentSettings.schemaPreset === currentKey) {
        currentSettings.schemaPreset = newKey;
        renamedActivePreset = true;
      }

      const context = SillyTavern.getContext();
      if (readStoredChatSchemaPresetKey(context?.chatMetadata, selectedModule.id) === currentKey) {
        shouldMigrateChatSchemaState = true;
      }
    });

    if (renamedActivePreset) {
      previousSchemaPresetRef.current = newKey;
    }

    if (shouldMigrateChatSchemaState) {
      const context = SillyTavern.getContext();
      void persistChatSchemaPreset(context, newKey, selectedModule.id).finally(() => {
        forceUpdate();
      });
    }
  };

  // Persists the active chat schema preset without changing the global default or preset editor selection.
  const handleCurrentChatSchemaPresetChange = async (newValue?: string) => {
    const context = SillyTavern.getContext();
    const chatMetadata = context?.chatMetadata;
    if (!chatMetadata || typeof chatMetadata !== 'object') {
      return;
    }

    const selection = resolveSchemaPresetSelection(moduleSettings.schemaPresets, moduleSettings.schemaPreset, newValue);
    if (!selection) {
      return;
    }

    const storedSchemaPresetKey = readStoredChatSchemaPresetKey(chatMetadata, selectedModule.id);
    if (storedSchemaPresetKey === selection.key) {
      return;
    }

    await persistChatSchemaPreset(context, selection.key, selectedModule.id);
    forceUpdate();
  };

  // Handler for when the list of presets is modified (created, renamed, deleted)
  const handleSchemaPresetsListChange = (newItems: PresetItem[]) => {
    let nextSchemaText = '';
    let nextSchemaHtmlText = '';
    let preservesActiveDrafts = false;
    let nextChatSchemaSelectionKey: string | undefined;

    updateSelectedModuleAndRefresh((currentSettings) => {
      const context = SillyTavern.getContext();
      const storedChatSchemaKey = readStoredChatSchemaPresetKey(context?.chatMetadata, selectedModule.id);
      const nextState = reconcilePresetItems(currentSettings.schemaPresets, currentSettings.schemaPreset, newItems);
      preservesActiveDrafts = nextState.preservesActiveDrafts;
      currentSettings.schemaPreset = nextState.activeKey;
      currentSettings.schemaPresets = nextState.presets;
      nextSchemaText = formatSchemaText(nextState.presets[nextState.activeKey]);
      nextSchemaHtmlText = formatSchemaHtml(nextState.presets[nextState.activeKey]);

      if (storedChatSchemaKey && !nextState.presets[storedChatSchemaKey]) {
        const nextChatSelection = resolveSchemaPresetSelection(nextState.presets, nextState.activeKey, storedChatSchemaKey);
        if (nextChatSelection) {
          nextChatSchemaSelectionKey = nextChatSelection.key;
        }
      }
    });

    if (!preservesActiveDrafts) {
      setSchemaText(nextSchemaText);
      setSchemaHtmlText(nextSchemaHtmlText);
    }

    if (nextChatSchemaSelectionKey) {
      const context = SillyTavern.getContext();
      void persistChatSchemaPreset(context, nextChatSchemaSelectionKey, selectedModule.id).finally(() => {
        forceUpdate();
      });
    }
  };


  // Handler for the schema JSON textarea
  const handleSchemaValueChange = (newSchemaText: string) => {
    // Keep the JSON draft local until the user explicitly saves it.
    setSchemaText(newSchemaText);
  };

  // Persists the active preset as one coupled JSON-and-HTML pair so preset switching cannot drift them apart.
  const saveSchemaPresetPair = () => {
    const jsonValidation = validateSchemaDraft(schemaText);
    const htmlValidation = validateSchemaHtmlDraft(schemaHtmlText);
    if (!jsonValidation.isValid || !htmlValidation.isValid || !schemaPresetPairValidation.isValid) {
      return;
    }

    const parsedJson = JSON.parse(schemaText);
    let nextSchemaText = schemaText;
    let nextSchemaHtmlValue = schemaHtmlText;
    updateSelectedModuleAndRefresh((currentSettings) => {
      const preset = currentSettings.schemaPresets[currentSettings.schemaPreset];
      if (!preset) {
        return;
      }

      const nextPreset = { ...preset, value: parsedJson, html: schemaHtmlText };
      currentSettings.schemaPresets = {
        ...currentSettings.schemaPresets,
        [currentSettings.schemaPreset]: nextPreset,
      };
      nextSchemaText = formatSchemaText(nextPreset);
      nextSchemaHtmlValue = formatSchemaHtml(nextPreset);
    });
    setSchemaText(nextSchemaText);
    setSchemaHtmlText(nextSchemaHtmlValue);
  };

  // Handler for the schema HTML textarea
  const handleSchemaHtmlChange = (newHtml: string) => {
    // Keep the HTML draft local until the user explicitly saves it.
    setSchemaHtmlText(newHtml);
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
    updateSelectedModuleAndRefresh((currentSettings) => {
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

  const updateModuleList = (updater: (modules: TrackerModule[]) => string | undefined) => {
    let nextSelectedModuleId: string | undefined;
    updateAndRefresh((currentSettings) => {
      currentSettings.modules = getOrderedTrackerModules(currentSettings, { includeDisabled: true }).map((module) => ({
        ...module,
        schema: { ...module.schema, presets: JSON.parse(JSON.stringify(module.schema.presets)) },
        prompts: { ...module.prompts },
        systemPrompt: { ...module.systemPrompt },
        connection: { ...module.connection },
        generation: {
          ...module.generation,
          worldInfoAllowlistBookNames: [...module.generation.worldInfoAllowlistBookNames],
          worldInfoAllowlistEntryIds: [...module.generation.worldInfoAllowlistEntryIds],
        },
        injection: { ...module.injection, transformPresets: JSON.parse(JSON.stringify(module.injection.transformPresets)) },
        auto: { ...module.auto },
      }));
      nextSelectedModuleId = updater(currentSettings.modules);
      normalizeModuleOrder(currentSettings.modules);
    });
    if (nextSelectedModuleId) {
      setSelectedModuleId(nextSelectedModuleId);
    }
  };

  const addModule = () => {
    updateModuleList((modules) => {
      const id = createTrackerModuleId(modules, 'module');
      modules.push(createDefaultTrackerModule({ id, name: `Module ${modules.length + 1}`, order: modules.length }));
      return id;
    });
  };

  const cloneModule = () => {
    updateModuleList((modules) => {
      const source = modules.find((module) => module.id === selectedModule.id);
      if (!source) {
        return undefined;
      }
      const id = createTrackerModuleId(modules, `${source.id}-copy`);
      modules.push({ ...JSON.parse(JSON.stringify(source)), id, name: `${source.name} Copy`, order: modules.length });
      return id;
    });
  };

  const moveSelectedModule = (direction: -1 | 1) => {
    updateModuleList((modules) => {
      const index = modules.findIndex((module) => module.id === selectedModule.id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= modules.length) {
        return undefined;
      }
      [modules[index], modules[nextIndex]] = [modules[nextIndex], modules[index]];
      return selectedModule.id;
    });
  };

  const deleteSelectedModule = async () => {
    if (orderedModules.length <= 1) {
      await st_echo('warning', 'At least one Module is required.');
      return;
    }

    const confirmed = await SillyTavern.getContext().Popup.show.confirm(
      'Delete Module',
      `Delete "${selectedModule.name}" and its saved tracker data in this chat?`,
    );
    if (!confirmed) {
      return;
    }

    const context = SillyTavern.getContext();
    purgeTrackerModuleDataFromChat(context?.chat, selectedModule.id);
    if (typeof context?.saveChat === 'function') {
      await Promise.resolve(context.saveChat());
    }

    updateModuleList((modules) => {
      const index = modules.findIndex((module) => module.id === selectedModule.id);
      modules.splice(index, 1);
      return modules[Math.max(0, index - 1)]?.id ?? modules[0]?.id;
    });
  };

  const exportSelectedModule = () => {
    const payload = JSON.stringify({ version: MODULE_EXPORT_VERSION, module: selectedModule }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${selectedModule.id || 'ztracker-module'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importModule = async () => {
    const importedText = await readTextFileViaPicker('application/json,.json');
    if (importedText === null) {
      return;
    }
    const importedModule = parseImportedTrackerModule(importedText);
    if (!importedModule) {
      await st_echo('warning', 'The selected file is not a valid zTracker Module export.');
      return;
    }

    let importedName = '';
    updateModuleList((modules) => {
      const module = createImportedTrackerModule(importedModule, modules);
      importedName = module.name;
      modules.push(module);
      return module.id;
    });
    await st_echo('success', `Imported Module "${importedName}".`);
  };

  const selectedModuleIndex = orderedModules.findIndex((module) => module.id === selectedModule.id);

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
              <label>Modules</label>
              <div className="ztracker-module-manager">
                <div className="ztracker-module-list">
                  {orderedModules.map((module) => {
                    const isSelected = module.id === selectedModule.id;
                    return (
                      <button
                        key={module.id}
                        type="button"
                        aria-pressed={isSelected}
                        className={`ztracker-module-row ${isSelected ? 'is-selected' : ''} ${module.enabled ? '' : 'is-disabled'}`}
                        onClick={() => setSelectedModuleId(module.id)}
                      >
                        <span className="ztracker-module-row-marker fa-solid fa-pen" aria-hidden="true"></span>
                        <span className="ztracker-module-row-name">{module.name}</span>
                        <span className="ztracker-module-row-badges">
                          <span className={`ztracker-module-badge ${module.enabled ? 'is-on' : 'is-off'}`}>
                            {module.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                          {module.auto.enabled && (
                            <span className="ztracker-module-badge is-auto">Auto</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="ztracker-module-actions">
                  <button type="button" className="menu_button" onClick={addModule}>Add</button>
                  <button type="button" className="menu_button" onClick={cloneModule}>Clone</button>
                  <button type="button" className="menu_button" disabled={selectedModuleIndex <= 0} onClick={() => moveSelectedModule(-1)}>Up</button>
                  <button type="button" className="menu_button" disabled={selectedModuleIndex < 0 || selectedModuleIndex >= orderedModules.length - 1} onClick={() => moveSelectedModule(1)}>Down</button>
                  <button type="button" className="menu_button" disabled={orderedModules.length <= 1} onClick={() => void deleteSelectedModule()}>Delete</button>
                  <button type="button" className="menu_button" onClick={exportSelectedModule}>Export</button>
                  <button type="button" className="menu_button" onClick={() => void importModule()}>Import</button>
                </div>
              </div>
            </div>

            <div className="ztracker-module-detail">
              <div className="ztracker-module-detail-header">
                <span className="fa-solid fa-pen-to-square" aria-hidden="true"></span>
                <span>
                  Editing module: <strong>{selectedModule.name}</strong>
                </span>
              </div>

              <div className="setting-row">
                <label title="Human-readable Module name shown in settings and tracker output.">Module Name</label>
                <input
                  className="text_pole"
                  value={selectedModule.name}
                  onChange={(e) => updateAndRefresh((currentSettings) => {
                    const module = currentSettings.modules?.find((candidate) => candidate.id === selectedModule.id);
                    if (module) {
                      module.name = e.target.value;
                    }
                  })}
                />
              </div>

            <div className="setting-row">
              <label title="Controls whether this Module renders, injects context, and appears in manual generation actions.">Module Enabled</label>
              <input
                type="checkbox"
                checked={selectedModule.enabled}
                onChange={(e) => updateAndRefresh((currentSettings) => {
                  const module = currentSettings.modules?.find((candidate) => candidate.id === selectedModule.id);
                  if (module) {
                    module.enabled = e.target.checked;
                  }
                })}
              />
            </div>

            <div className="setting-row">
              <label title="Controls whether this Module participates in incoming or outgoing automatic generation.">Auto Generate</label>
              <input
                type="checkbox"
                checked={selectedModule.auto.enabled}
                onChange={(e) => updateAndRefresh((currentSettings) => {
                  const module = currentSettings.modules?.find((candidate) => candidate.id === selectedModule.id);
                  if (module) {
                    module.auto.enabled = e.target.checked;
                  }
                })}
              />
            </div>

            <div className="setting-row">
              <label title="Choose whether zTracker uses the currently active SillyTavern connection or a specific saved connection profile.">Connection Source</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                <select
                  className="text_pole"
                  title="Choose whether zTracker uses the currently active SillyTavern connection or a specific saved connection profile."
                  value={connectionSource}
                  onChange={(e) =>
                    updateSelectedModuleAndRefresh((s) => {
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
                  initialSelectedProfileId={moduleSettings.profileId}
                  onChange={(profile) =>
                    updateSelectedModuleAndRefresh((s) => {
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
                settings={moduleSettings}
                updateAndRefresh={updateSelectedModuleAndRefresh}
                schemaPresetItems={schemaPresetItems}
                currentChatSchemaPresetKey={currentChatSchemaPresetState.selection?.key}
                currentChatSchemaPresetLabel={currentChatSchemaPresetState.selection?.label}
                currentChatSchemaPresetUsesDefault={!!currentChatSchemaPresetState.selection?.usedFallback}
                currentChatSchemaPresetAvailable={currentChatSchemaPresetState.isAvailable}
                currentChatSchemaPresetStoredKey={currentChatSchemaPresetState.storedSchemaKey}
                currentChatSchemaPresetHasStoredValue={currentChatSchemaPresetState.hasStoredSchemaKey}
                currentChatSchemaPresetHasValidStoredValue={currentChatSchemaPresetState.hasValidStoredSchemaKey}
                handleSchemaPresetChange={handleSchemaPresetChange}
                handleSchemaPresetRename={handleSchemaPresetRename}
                handleCurrentChatSchemaPresetChange={handleCurrentChatSchemaPresetChange}
                handleSchemaPresetsListChange={handleSchemaPresetsListChange}
                schemaText={schemaText}
                schemaTextHasError={!schemaDraftState.isValid}
                schemaTextError={schemaDraftState.errorMessage}
                schemaTextHasUnsavedChanges={schemaDraftState.isDirty}
                schemaTextCanSave={schemaPresetPairCanSave}
                schemaHtmlText={schemaHtmlText}
                schemaHtmlTextHasError={!schemaHtmlDraftState.isValid}
                schemaHtmlTextError={schemaHtmlDraftState.errorMessage}
                schemaHtmlTextHasUnsavedChanges={schemaHtmlDraftState.isDirty}
                schemaHtmlTextCanSave={schemaPresetPairCanSave}
                schemaPresetPairError={schemaPresetPairError}
                handleSchemaValueChange={handleSchemaValueChange}
                handleSchemaHtmlChange={handleSchemaHtmlChange}
                saveSchemaValue={saveSchemaPresetPair}
                saveSchemaHtmlValue={saveSchemaPresetPair}
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
              <TrackerInjectionSection settings={moduleSettings} updateAndRefresh={updateSelectedModuleAndRefresh} />
            </SettingsSectionDrawer>
            </div>

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
