import { FC, useCallback, useMemo, useState } from 'react';
import { STButton, STTextarea } from 'sillytavern-utils-lib/components/react';
import { getWorldInfos } from 'sillytavern-utils-lib';
import { ExtensionSettings, TrackerWorldInfoPolicyMode } from '../../config.js';

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

export const WorldInfoPolicySection: FC<{
  settings: ExtensionSettings;
  updateAndRefresh: (updater: (current: ExtensionSettings) => void) => void;
}> = ({ settings, updateAndRefresh }) => {
  const worldInfoAllowlistText = (settings.trackerWorldInfoAllowlistBookNames ?? []).join('\n');
  const worldInfoEntryIdAllowlistText = (settings.trackerWorldInfoAllowlistEntryIds ?? []).join('\n');

  const [availableWorldInfoBooks, setAvailableWorldInfoBooks] = useState<string[]>([]);
  const [worldInfoBookSearch, setWorldInfoBookSearch] = useState<string>('');
  const [selectedWorldInfoBookToAdd, setSelectedWorldInfoBookToAdd] = useState<string>('');
  const [worldInfoBooksLoading, setWorldInfoBooksLoading] = useState<boolean>(false);
  const [worldInfoBooksError, setWorldInfoBooksError] = useState<string>('');

  const refreshAvailableWorldInfoBooks = useCallback(async () => {
    setWorldInfoBooksLoading(true);
    setWorldInfoBooksError('');
    try {
      const domBooks = getAllWorldInfoBookNamesFromDom();

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

  return (
    <>
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

          <div className="notes">Use the picker to add detected books, then optionally fine-tune via the textarea.</div>

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

              <STButton
                title="Add selected book"
                onClick={() => addWorldInfoBookName(selectedWorldInfoBookToAdd)}
                disabled={!selectedWorldInfoBookToAdd}
              >
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
    </>
  );
};
