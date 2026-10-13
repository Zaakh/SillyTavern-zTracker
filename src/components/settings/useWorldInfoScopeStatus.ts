/**
 * Computes per-row World Info scope status for the settings UI using the same resolver as tracker
 * generation. Re-evaluates on mount, when rows change, when the section scrolls into view
 * (IntersectionObserver, feature-detected), and on demand via `recheck`.
 */
import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { getWorldInfos } from 'sillytavern-utils-lib';
import type { TrackerWorldInfoAllowlistRow } from '../../config.js';
import {
  createHostWorldInfoScopeDeps,
  getWorldInfoRowScopeStatus,
  hasScopedRows,
  resolveWorldInfoScopeSources,
  type WorldInfoRowScopeStatus,
} from '../../world-info-scope.js';

export function useWorldInfoScopeStatus(rows: TrackerWorldInfoAllowlistRow[], rootRef: RefObject<HTMLElement | null>) {
  const [statuses, setStatuses] = useState<Record<string, WorldInfoRowScopeStatus>>({});
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const checkToken = useRef(0);
  const rowsKey = JSON.stringify(rows.map((r) => [r.book, r.activeVia]));

  const recheck = useCallback(async () => {
    const token = ++checkToken.current;
    const current = rowsRef.current;
    if (!hasScopedRows(current)) {
      setStatuses({});
      return;
    }
    try {
      const sources = await resolveWorldInfoScopeSources(
        createHostWorldInfoScopeDeps(SillyTavern.getContext(), async () => Object.keys(await getWorldInfos(['global'], true))),
        { card: current.some((r) => r.activeVia.includes('card')), global: current.some((r) => r.activeVia.includes('global')) },
      );
      if (token !== checkToken.current) return; // superseded by a newer check
      setStatuses(Object.fromEntries(current.map((r) => [r.book.toLowerCase(), getWorldInfoRowScopeStatus(r, sources)])));
    } catch (error) {
      console.debug('zTracker: World Info scope check failed', error);
      if (token === checkToken.current) setStatuses({});
    }
  }, []);

  useEffect(() => {
    void recheck();
  }, [rowsKey, recheck]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void recheck();
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [rootRef, recheck]);

  return { statuses, recheck };
}
