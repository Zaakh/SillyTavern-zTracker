import { FC, useState, useMemo, useCallback } from 'react';
import {
  STConnectionProfileSelect,
  STPresetSelect,
  STButton,
  STTextarea,
  PresetItem,
} from 'sillytavern-utils-lib/components/react';
import { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import { getWorldInfos } from 'sillytavern-utils-lib';
import {
  ExtensionSettings,
  Schema,
  DEFAULT_PROMPT,
  DEFAULT_PROMPT_JSON,
  DEFAULT_PROMPT_XML,
  DEFAULT_SCHEMA_VALUE,
  DEFAULT_SCHEMA_HTML,
  PromptEngineeringMode,
  TrackerWorldInfoPolicyMode,
  defaultSettings,
  EXTENSION_KEY,
  extensionName,
} from '../config.js';
import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import { useForceUpdate } from '../hooks/useForceUpdate.js';

// Initialize the settings manager once, outside the component
export const settingsManager = new ExtensionSettingsManager<ExtensionSettings>(EXTENSION_KEY, defaultSettings);

function normalizeWorldInfoAllowlist(text: string): string[] {
  const lines = text
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter(Boolean);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const key = line.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(line);
    }
  }
  return deduped;
}

function normalizeWorldInfoEntryIdAllowlist(text: string): number[] {
  const parts = text
    .split(/[\s,]+/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const deduped: number[] = [];
  const seen = new Set<number>();
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isFinite(n)) continue;
    const id = Math.trunc(n);
    if (id < 0) continue;
    if (!seen.has(id)) {
      seen.add(id);
      deduped.push(id);
    }
  }
  return deduped;
}

function getAllWorldInfoBookNamesFromDom(): string[] {
  // SillyTavern exposes the full lorebook list in the World Info editor select.
  // This is the most accurate “available books” source without importing ST internals.
  const select =
    (document.querySelector('select#world_editor_select') as HTMLSelectElement | null) ??
    (document.querySelector('select#world_info') as HTMLSelectElement | null);

  if (!select) return [];

  const names = Array.from(select.options)
    .map((o) => (o.textContent ?? '').trim())
    .filter(Boolean)
    .filter((t) => !/^---\s*pick\s*to\s*edit\s*---$/i.test(t));

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const n of names) {
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(n);
  }
  return deduped;
}

export const ZTrackerSettings: FC = () => {
  const forceUpdate = useForceUpdate();
  const settings = settingsManager.getSettings();

  const [diagnosticsText, setDiagnosticsText] = useState<string>('');

  const [availableWorldInfoBooks, setAvailableWorldInfoBooks] = useState<string[]>([]);
  const [worldInfoBookSearch, setWorldInfoBookSearch] = useState<string>('');
  const [selectedWorldInfoBookToAdd, setSelectedWorldInfoBookToAdd] = useState<string>('');
  const [worldInfoBooksLoading, setWorldInfoBooksLoading] = useState<boolean>(false);
  const [worldInfoBooksError, setWorldInfoBooksError] = useState<string>('');

  const [schemaText, setSchemaText] = useState(
    JSON.stringify(settings.schemaPresets[settings.schemaPreset]?.value, null, 2) ?? '',
  );
  const worldInfoAllowlistText = (settings.trackerWorldInfoAllowlistBookNames ?? []).join('\n');
  const worldInfoEntryIdAllowlistText = (settings.trackerWorldInfoAllowlistEntryIds ?? []).join('\n');

  const updateAndRefresh = useCallback(
    (updater: (currentSettings: ExtensionSettings) => void) => {
      const currentSettings = settingsManager.getSettings();
      updater(currentSettings);
      settingsManager.saveSettings();
      forceUpdate();
    },
    [forceUpdate],
  );

  const refreshAvailableWorldInfoBooks = useCallback(async () => {
    setWorldInfoBooksLoading(true);
    setWorldInfoBooksError('');
    try {
      // Prefer the full list visible in ST's World Info editor.
      const domBooks = getAllWorldInfoBookNamesFromDom();

      // Fallback: public helper lists the books currently available from WI sources.
      const fallbackBooks = async (): Promise<string[]> => {
        const worldInfos = await getWorldInfos(['global', 'chat', 'character', 'persona'], true);
        return Object.keys(worldInfos)
          .map((b) => b.trim())
          .filter(Boolean);
      };

      const books = (domBooks.length > 0 ? domBooks : await fallbackBooks()).sort((a, b) => a.localeCompare(b));

      setAvailableWorldInfoBooks(books);
      if (books.length > 0) {
        const stillValid = books.includes(selectedWorldInfoBookToAdd);
        if (!selectedWorldInfoBookToAdd || !stillValid) {
          setSelectedWorldInfoBookToAdd(books[0]);
        }
      } else {
        setSelectedWorldInfoBookToAdd('');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setWorldInfoBooksError(message);
      setAvailableWorldInfoBooks([]);
      setSelectedWorldInfoBookToAdd('');
    } finally {
      setWorldInfoBooksLoading(false);
    }
  }, [selectedWorldInfoBookToAdd]);

  const filteredAvailableBooks = useMemo(() => {
    const q = worldInfoBookSearch.trim().toLowerCase();
    if (!q) return availableWorldInfoBooks;
    return availableWorldInfoBooks.filter((b) => b.toLowerCase().includes(q));
  }, [availableWorldInfoBooks, worldInfoBookSearch]);

  const addWorldInfoBookName = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      updateAndRefresh((s) => {
        const current = s.trackerWorldInfoAllowlistBookNames ?? [];
        s.trackerWorldInfoAllowlistBookNames = normalizeWorldInfoAllowlist([...current, trimmed].join('\n'));
      });
    },
    [updateAndRefresh],
  );

  const removeWorldInfoBookName = useCallback(
    (name: string) => {
      const key = name.trim().toLowerCase();
      updateAndRefresh((s) => {
        const current = s.trackerWorldInfoAllowlistBookNames ?? [];
        s.trackerWorldInfoAllowlistBookNames = current.filter((b) => b.trim().toLowerCase() !== key);
      });
    },
    [updateAndRefresh],
  );

  const runDiagnostics = useCallback(async () => {
    const basePath = `/scripts/extensions/third-party/${extensionName}`;
    const templatePaths = ['dist/templates/buttons', 'dist/templates/modify_schema_popup'];

    const results: Array<{ template: string; url: string; status: number | null; ok: boolean; error?: string }> = [];
    for (const template of templatePaths) {
      const url = new URL(`${basePath}/${template}.html`, window.location.origin).toString();
      try {
        const response = await fetch(url, { cache: 'no-store' });
        results.push({ template, url, status: response.status, ok: response.ok });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ template, url, status: null, ok: false, error: message });
      }
    }

    const lines: string[] = [];
    lines.push(`zTracker diagnostics`);
    lines.push(`time: ${new Date().toISOString()}`);
    lines.push(`origin: ${window.location.origin}`);
    lines.push(`extensionName: ${extensionName}`);
    lines.push(`basePath: ${basePath}`);
    lines.push(`debugLogging: ${String(settingsManager.getSettings().debugLogging)}`);
    lines.push('');
    for (const r of results) {
      lines.push(`template: ${r.template}`);
      lines.push(`url: ${r.url}`);
      lines.push(`ok: ${String(r.ok)}${r.status !== null ? ` (status ${r.status})` : ''}${r.error ? ` (error: ${r.error})` : ''}`);
      lines.push('');
    }

    const text = lines.join('\n');
    setDiagnosticsText(text);
    // eslint-disable-next-line no-console
    console.debug(text);
  }, []);

  // Memoized data for the schema preset dropdown
  const schemaPresetItems = useMemo((): PresetItem[] => {
    return Object.entries(settings.schemaPresets).map(([value, preset]) => ({
      value,
      label: preset.name,
    }));
  }, [settings.schemaPresets]);

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
              <label>Connection Profile</label>
              <STConnectionProfileSelect
                initialSelectedProfileId={settings.profileId}
                onChange={(profile) =>
                  updateAndRefresh((s) => {
                    s.profileId = profile?.id ?? '';
                  })
                }
              />
            </div>

            <div className="setting-row">
              <label>Auto Mode</label>
              <select
                className="text_pole"
                value={settings.autoMode}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.autoMode = e.target.value as AutoModeOptions;
                  })
                }
              >
                <option value="none">None</option>
                <option value="responses">Process responses</option>
                <option value="inputs">Process inputs</option>
                <option value="both">Process both</option>
              </select>
            </div>

            <div className="setting-row">
              <label>Prompt Engineering</label>
              <select
                className="text_pole"
                value={settings.promptEngineeringMode}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.promptEngineeringMode = e.target.value as PromptEngineeringMode;
                  })
                }
              >
                <option value="native">Native API</option>
                <option value="json">Prompt Engineering (JSON)</option>
                <option value="xml">Prompt Engineering (XML)</option>
              </select>
            </div>

            <div className="setting-row">
              <label>Schema Preset</label>
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
                <span>Schema</span>
                <STButton className="fa-solid fa-undo" title="Restore default" onClick={restoreSchemaToDefault} />
              </div>

              <STTextarea value={schemaText} onChange={(e) => handleSchemaValueChange(e.target.value)} rows={4} />
              <STTextarea
                value={settings.schemaPresets[settings.schemaPreset]?.html ?? ''}
                onChange={(e) => handleSchemaHtmlChange(e.target.value)}
                rows={4}
                placeholder="Enter your schema HTML here..."
              />
            </div>

            <div className="setting-row">
              <div className="title_restorable">
                <span>Prompt</span>
                <STButton
                  className="fa-solid fa-undo"
                  title="Restore main context template to default"
                  onClick={() =>
                    updateAndRefresh((s) => {
                      s.prompt = DEFAULT_PROMPT;
                    })
                  }
                />
              </div>
              <STTextarea
                value={settings.prompt}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.prompt = e.target.value;
                  })
                }
                rows={4}
              />
            </div>

            <div className="setting-row">
              <div className="title_restorable">
                <span>Prompt (JSON)</span>
                <STButton
                  className="fa-solid fa-undo"
                  title="Restore main context template to default"
                  onClick={() =>
                    updateAndRefresh((s) => {
                      s.promptJson = DEFAULT_PROMPT_JSON;
                    })
                  }
                />
              </div>
              <STTextarea
                value={settings.promptJson}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.promptJson = e.target.value;
                  })
                }
                rows={4}
              />
            </div>

            <div className="setting-row">
              <div className="title_restorable">
                <span>Prompt (XML)</span>
                <STButton
                  className="fa-solid fa-undo"
                  title="Restore main context template to default"
                  onClick={() =>
                    updateAndRefresh((s) => {
                      s.promptXml = DEFAULT_PROMPT_XML;
                    })
                  }
                />
              </div>
              <STTextarea
                value={settings.promptXml}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.promptXml = e.target.value;
                  })
                }
                rows={4}
              />
            </div>

            <div className="setting-row">
              <label>Max Response Tokens</label>
              <input
                type="number"
                className="text_pole"
                min="1"
                step="1"
                value={settings.maxResponseToken}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.maxResponseToken = parseInt(e.target.value) || 0;
                  })
                }
              />
            </div>
            <div className="setting-row">
              <label>Include Last X Messages (0 means all, 1 means last)</label>
              <input
                type="number"
                className="text_pole"
                min="0"
                step="1"
                title="0 means all messages."
                value={settings.includeLastXMessages}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.includeLastXMessages = parseInt(e.target.value) || 0;
                  })
                }
              />
            </div>
            <div className="setting-row">
              <label>Include Last X zTracker Messages</label>
              <input
                type="number"
                className="text_pole"
                min="0"
                step="1"
                title="0 means none."
                value={settings.includeLastXZTrackerMessages}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.includeLastXZTrackerMessages = parseInt(e.target.value) || 0;
                  })
                }
              />
            </div>

            <div className="setting-row">
              <label>World Info during tracker generation</label>
              <select
                className="text_pole"
                value={settings.trackerWorldInfoPolicyMode}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.trackerWorldInfoPolicyMode = e.target.value as TrackerWorldInfoPolicyMode;
                  })
                }
              >
                <option value={TrackerWorldInfoPolicyMode.INCLUDE_ALL}>Include all (default)</option>
                <option value={TrackerWorldInfoPolicyMode.EXCLUDE_ALL}>Exclude all</option>
                <option value={TrackerWorldInfoPolicyMode.ALLOWLIST}>Allow only specified books/UIDs</option>
              </select>
            </div>

            {settings.trackerWorldInfoPolicyMode === TrackerWorldInfoPolicyMode.ALLOWLIST && (
              <div className="setting-row">
                <label>Allowed World Info book names</label>

                <div className="notes">
                  Use the picker to add detected books, then optionally fine-tune via the textarea.
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <STButton title="Refresh detected books" onClick={refreshAvailableWorldInfoBooks} disabled={worldInfoBooksLoading}>
                      {worldInfoBooksLoading ? 'Refreshing…' : 'Refresh book list'}
                    </STButton>

                    <input
                      className="text_pole"
                      style={{ minWidth: 220 }}
                      value={worldInfoBookSearch}
                      onChange={(e) => setWorldInfoBookSearch(e.target.value)}
                      placeholder="Search detected books…"
                    />

                    <select
                      className="text_pole"
                      style={{ minWidth: 260 }}
                      value={selectedWorldInfoBookToAdd}
                      onChange={(e) => setSelectedWorldInfoBookToAdd(e.target.value)}
                      disabled={filteredAvailableBooks.length === 0}
                    >
                      {filteredAvailableBooks.length === 0 ? (
                        <option value="">No books detected (click Refresh)</option>
                      ) : (
                        filteredAvailableBooks.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))
                      )}
                    </select>

                    <STButton title="Add selected book" onClick={() => addWorldInfoBookName(selectedWorldInfoBookToAdd)} disabled={!selectedWorldInfoBookToAdd}>
                      Add
                    </STButton>
                  </div>

                  {worldInfoBooksError && <div className="notes">Failed to load books: {worldInfoBooksError}</div>}

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {(settings.trackerWorldInfoAllowlistBookNames ?? []).length === 0 ? (
                      <span className="notes">No allowlisted books yet.</span>
                    ) : (
                      (settings.trackerWorldInfoAllowlistBookNames ?? []).map((b) => (
                        <span
                          key={b}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '2px 8px',
                            border: '1px solid var(--SmartThemeBorderColor)',
                            borderRadius: 999,
                          }}
                        >
                          <span>{b}</span>
                          <button
                            className="menu_button"
                            type="button"
                            title="Remove"
                            onClick={() => removeWorldInfoBookName(b)}
                            style={{ padding: '0 6px' }}
                          >
                            ×
                          </button>
                        </span>
                      ))
                    )}
                  </div>

                  <details>
                    <summary>Advanced: edit book names manually</summary>
                    <STTextarea
                      value={worldInfoAllowlistText}
                      onChange={(e) => {
                        const allowlist = normalizeWorldInfoAllowlist(e.target.value);
                        updateAndRefresh((s) => {
                          s.trackerWorldInfoAllowlistBookNames = allowlist;
                        });
                      }}
                      rows={4}
                      placeholder="Example:\nMy Global Lorebook\nCharacter Lorebook"
                    />
                  </details>
                </div>

                <label>Allowed World Info entry IDs (UIDs; one per line or comma/space separated)</label>
                <STTextarea
                  value={worldInfoEntryIdAllowlistText}
                  onChange={(e) => {
                    const allowlist = normalizeWorldInfoEntryIdAllowlist(e.target.value);
                    updateAndRefresh((s) => {
                      s.trackerWorldInfoAllowlistEntryIds = allowlist;
                    });
                  }}
                  rows={4}
                  placeholder="Example:\n12\n42\n1337"
                />
              </div>
            )}

            <div className="setting-row">
              <label>Debug logging</label>
              <input
                type="checkbox"
                checked={!!settings.debugLogging}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.debugLogging = e.target.checked;
                  })
                }
              />
              <div className="notes">Enables extra console logging and a diagnostics helper. Avoid enabling unless troubleshooting.</div>
            </div>

            <div className="setting-row">
              <div className="title_restorable">
                <span>Diagnostics</span>
                <STButton className="fa-solid fa-stethoscope" title="Run diagnostics" onClick={runDiagnostics} />
              </div>
              <textarea
                className="text_pole"
                readOnly
                value={diagnosticsText}
                rows={6}
                placeholder="Click the stethoscope button to generate diagnostics (also prints to console.debug)."
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
