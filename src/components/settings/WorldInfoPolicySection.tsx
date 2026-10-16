/**
 * World Info settings: policy mode plus, in allowlist mode, one row per lorebook with its
 * activation scope, optional entry UIDs, and a scope warning for the open chat.
 */
import { FC, useCallback, useMemo, useRef, useState } from 'react';
import { STButton } from 'sillytavern-utils-lib/components/react';
import { getWorldInfos } from 'sillytavern-utils-lib';
import {
  TrackerModuleSettings,
  TrackerWorldInfoActivation,
  TrackerWorldInfoAllowlistRow,
  TrackerWorldInfoPolicyMode,
  TrackerWorldInfoTrigger,
} from '../../config.js';
import { useWorldInfoScopeStatus } from './useWorldInfoScopeStatus.js';

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
  settings: TrackerModuleSettings;
  updateAndRefresh: (updater: (current: TrackerModuleSettings) => void) => void;
}> = ({ settings, updateAndRefresh }) => {
  const worldInfoPolicyMode = settings.trackerWorldInfoPolicyMode ?? TrackerWorldInfoPolicyMode.INCLUDE_ALL;
  const allowlistRows = settings.trackerWorldInfoAllowlist ?? [];
  const rootRef = useRef<HTMLDivElement>(null);
  const { statuses, recheck } = useWorldInfoScopeStatus(allowlistRows, rootRef);

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
        const current = s.trackerWorldInfoAllowlist ?? [];
        if (current.some((row) => row.book.toLowerCase() === trimmed.toLowerCase())) return;
        s.trackerWorldInfoAllowlist = [...current, { book: trimmed, activeVia: [], entryIds: [], trigger: 'engine' }];
      });
    },
    [updateAndRefresh],
  );

  const removeWorldInfoBookName = useCallback(
    (name: string) => {
      const key = name.trim().toLowerCase();
      updateAndRefresh((s) => {
        s.trackerWorldInfoAllowlist = (s.trackerWorldInfoAllowlist ?? []).filter((row) => row.book.trim().toLowerCase() !== key);
      });
    },
    [updateAndRefresh],
  );

  const updateRow = useCallback(
    (book: string, patch: Partial<Omit<TrackerWorldInfoAllowlistRow, 'book'>>) => {
      updateAndRefresh((s) => {
        s.trackerWorldInfoAllowlist = (s.trackerWorldInfoAllowlist ?? []).map((row) =>
          row.book === book ? { ...row, ...patch } : row,
        );
      });
    },
    [updateAndRefresh],
  );

  const toggleScope = (row: { book: string; activeVia: TrackerWorldInfoActivation[] }, scope: TrackerWorldInfoActivation) =>
    updateRow(row.book, {
      activeVia: (['card', 'global'] as const).filter((v) => (v === scope ? !row.activeVia.includes(v) : row.activeVia.includes(v))),
    });

  return (
    <div ref={rootRef}>
      <div className="setting-row">
        <label title="Controls whether SillyTavern World Info is included when zTracker builds the prompt for tracker generation.">
          World Info during tracker generation
        </label>
        <select
          className="text_pole"
          title="Controls whether SillyTavern World Info is included when zTracker builds the prompt for tracker generation."
          value={worldInfoPolicyMode}
          onChange={(e) =>
            updateAndRefresh((s) => {
              s.trackerWorldInfoPolicyMode = e.target.value as TrackerWorldInfoPolicyMode;
            })
          }
        >
          <option value={TrackerWorldInfoPolicyMode.INCLUDE_ALL}>Allow all (default)</option>
          <option value={TrackerWorldInfoPolicyMode.EXCLUDE_ALL}>Exclude all</option>
          <option value={TrackerWorldInfoPolicyMode.ALLOWLIST}>Allow only specified books</option>
        </select>
      </div>

      {worldInfoPolicyMode === TrackerWorldInfoPolicyMode.ALLOWLIST && (
        <div className="setting-row">
          <label title="World Info books (lorebooks) that are allowed when using the allowlist mode.">Allowed World Info books</label>

          <div className="notes">
            Use the picker to add detected books. A book with no scope checked is always considered; checking a scope uses it only when
            it is also active that way for the open chat. "Engine rules" lets SillyTavern pick entries (keywords, inclusion groups,
            probability); "Always inject all" bypasses keywords, inclusion groups and the other activation rules.
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
                title="Filter the detected lorebook list."
              />

              <select
                className="text_pole"
                style={{ minWidth: 260 }}
                value={selectedWorldInfoBookToAdd}
                onChange={(e) => setSelectedWorldInfoBookToAdd(e.target.value)}
                disabled={filteredAvailableBooks.length === 0}
                title="Select a detected lorebook to add to the allowlist."
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

            {allowlistRows.length === 0 ? (
              <span className="notes">No allowlisted books yet.</span>
            ) : (
              allowlistRows.map((row) => {
                const status = statuses[row.book.toLowerCase()];
                return (
                  <div
                    key={row.book}
                    data-testid="world-info-row"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flexWrap: 'wrap',
                      padding: '4px 8px',
                      border: '1px solid var(--SmartThemeBorderColor)',
                      borderRadius: 6,
                    }}
                  >
                    <strong>{row.book}</strong>
                    <select
                      className="text_pole"
                      aria-label={`Activation for ${row.book}`}
                      value={row.trigger}
                      onChange={(e) => updateRow(row.book, { trigger: e.target.value as TrackerWorldInfoTrigger })}
                      title="Engine: SillyTavern decides which entries activate (keywords, inclusion groups, probability, budget). Always: every enabled entry is injected, bypassing keywords, inclusion groups and the other activation rules."
                    >
                      <option value="engine">Engine rules</option>
                      <option value="always">Always inject all</option>
                    </select>
                    <label title="Inject only if the book is attached to the open chat's character card (any member in a group chat) or is the chat-bound lorebook.">
                      <input type="checkbox" checked={row.activeVia.includes('card')} onChange={() => toggleScope(row, 'card')} /> Character
                      card or chat
                    </label>
                    <label title="Inject only if the book is globally selected.">
                      <input type="checkbox" checked={row.activeVia.includes('global')} onChange={() => toggleScope(row, 'global')} /> Global
                    </label>
                    <input
                      key={row.entryIds.join(',')}
                      className="text_pole"
                      style={{ width: 170 }}
                      defaultValue={row.entryIds.join(', ')}
                      onBlur={(e) => updateRow(row.book, { entryIds: normalizeWorldInfoEntryIdAllowlist(e.target.value) })}
                      placeholder="Entry UIDs (empty = all)"
                      title="Optional entry UIDs of this book to inject, comma/space separated. Empty injects all enabled entries."
                    />
                    {status === 'skipped' && <span className="notes">⚠ Skipped for the open chat (scope not satisfied)</span>}
                    {status === 'unknown' && <span className="notes">Scope cannot be checked right now (no chat open or lookup incomplete)</span>}
                    <button
                      className="menu_button"
                      type="button"
                      title="Remove"
                      onClick={() => removeWorldInfoBookName(row.book)}
                      style={{ padding: '0 6px', marginLeft: 'auto' }}
                    >
                      ×
                    </button>
                  </div>
                );
              })
            )}

            <div>
              <STButton title="Recheck scope against the open chat" onClick={() => void recheck()}>
                Recheck
              </STButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
