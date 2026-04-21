import { EXTENSION_KEY } from '../config.js';
import { CHAT_MESSAGE_PENDING_REDACTIONS_KEY } from '../tracker.js';
import {
  getArrayItemIdentityKey,
  getPendingRedactionTargets,
  isSameTrackerCleanupTarget,
  normalizeTrackerCleanupTargets,
  sanitizeArrayItemFieldKeys,
  type TrackerCleanupTarget,
} from '../tracker-parts.js';
import { toShortTrackerLabel } from '../tracker-helpers.js';

/** Describes one selectable cleanup row inside the tracker cleanup popup. */
export interface TrackerCleanupPopupRow {
  target: TrackerCleanupTarget;
  label: string;
  level: number;
  pending: boolean;
}

/** Reads the normalized pending-redaction targets currently stored on a message. */
export function getCurrentPendingRedactions(message: any): TrackerCleanupTarget[] {
  return getPendingRedactionTargets(message?.extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_PENDING_REDACTIONS_KEY]);
}

/** Builds the hierarchical cleanup target list shown in the popup. */
export function buildCleanupPopupRows(options: {
  trackerData: Record<string, any>;
  schema: any;
  partsOrder: string[];
  partsMeta: Record<string, any>;
  pendingTargets: TrackerCleanupTarget[];
}): TrackerCleanupPopupRow[] {
  const rows: TrackerCleanupPopupRow[] = [];

  for (const partKey of options.partsOrder) {
    const partTarget = { kind: 'part' as const, partKey };
    rows.push({
      target: partTarget,
      label: partKey,
      level: 0,
      pending: options.pendingTargets.some((target) => isSameTrackerCleanupTarget(target, partTarget)),
    });

    const items = options.trackerData?.[partKey];
    if (!Array.isArray(items)) {
      continue;
    }

    const idKey = getArrayItemIdentityKey(options.schema, partKey);
    const schemaFieldKeys = Object.keys(options.schema?.properties?.[partKey]?.items?.properties ?? {}).filter(
      (fieldKey) => fieldKey !== 'name' && fieldKey !== idKey,
    );
    const fieldKeysFromMeta: string[] = Array.isArray(options.partsMeta?.[partKey]?.fields)
      ? sanitizeArrayItemFieldKeys(options.partsMeta[partKey].fields, idKey, schemaFieldKeys)
      : [];

    items.forEach((item: unknown, index: number) => {
      const idValue = item && typeof item === 'object' && !Array.isArray(item) ? (item as any)[idKey] : undefined;
      const itemTarget = {
        kind: 'array-item' as const,
        partKey,
        index,
        ...(typeof idValue === 'string' && idValue ? { idKey, idValue } : {}),
      };
      const pendingItemTarget = options.pendingTargets.find((target) => isSameTrackerCleanupTarget(target, itemTarget));
      const displayLabel =
        pendingItemTarget?.kind === 'array-item' && typeof pendingItemTarget.displayLabel === 'string'
          ? pendingItemTarget.displayLabel
          : toShortTrackerLabel(item);

      rows.push({
        target: {
          ...itemTarget,
          displayLabel,
        },
        label: displayLabel,
        level: 1,
        pending: !!pendingItemTarget,
      });

      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return;
      }

      const fieldKeys = (fieldKeysFromMeta.length > 0 ? fieldKeysFromMeta : schemaFieldKeys).filter(Boolean);
      fieldKeys.forEach((fieldKey) => {
        const fieldTarget = {
          kind: 'array-item-field' as const,
          partKey,
          index,
          fieldKey,
          ...(typeof idValue === 'string' && idValue ? { idKey, idValue } : {}),
        };
        rows.push({
          target: {
            ...fieldTarget,
            displayLabel,
          },
          label: `${displayLabel}.${fieldKey}`,
          level: 2,
          pending: options.pendingTargets.some((target) => isSameTrackerCleanupTarget(target, fieldTarget)),
        });
      });
    });
  }

  return rows;
}

/** Renders the tracker cleanup popup body with selectable targets and mode choices. */
export function buildCleanupPopupContent(rows: TrackerCleanupPopupRow[]): string {
  const rowsHtml = rows.length
    ? rows
        .map(
          (row, index) => `
              <label style="display:flex;align-items:flex-start;gap:8px;padding:4px 0 4px ${row.level * 18}px;">
                <input type="checkbox" data-ztracker-cleanup-target-index="${index}" />
                <span>${row.pending ? '[pending] ' : ''}${row.label}</span>
              </label>`,
        )
        .join('')
    : '<div>No cleanup targets are available for this tracker.</div>';

  return `
      <div id="ztracker-cleanup-popup" style="display:flex;flex-direction:column;gap:12px;min-width:min(560px,90vw);max-width:90vw;">
        <div>Clear wrong tracker sections before recreating them. Parent selections override child selections.</div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <label style="display:flex;align-items:flex-start;gap:8px;">
            <input type="radio" name="ztracker-cleanup-mode" value="clear-and-recreate" checked />
            <span>Clear and recreate selected targets</span>
          </label>
          <label style="display:flex;align-items:flex-start;gap:8px;">
            <input type="radio" name="ztracker-cleanup-mode" value="clear-only" />
            <span>Clear selected targets only</span>
          </label>
        </div>
        <div style="max-height:50vh;overflow:auto;border:1px solid rgba(127,127,127,0.22);border-radius:6px;padding:8px 10px;">
          ${rowsHtml}
        </div>
        <div id="ztracker-cleanup-selection-summary" style="font-size:0.9em;opacity:0.85;">0 effective targets selected</div>
      </div>
    `;
}

/** Keeps the popup summary aligned with effective ancestor-filtered target selection. */
export function bindCleanupPopupSummary(rows: TrackerCleanupPopupRow[]): void {
  const popupRoot = document.getElementById('ztracker-cleanup-popup');
  if (!popupRoot) {
    return;
  }

  const updateSummary = () => {
    const selectedTargets = Array.from(
      popupRoot.querySelectorAll<HTMLInputElement>('[data-ztracker-cleanup-target-index]:checked'),
    )
      .map((input) => rows[Number(input.getAttribute('data-ztracker-cleanup-target-index') ?? '-1')]?.target)
      .filter((target): target is TrackerCleanupTarget => !!target);
    const effectiveTargetCount = normalizeTrackerCleanupTargets(selectedTargets).length;
    const summary = popupRoot.querySelector('#ztracker-cleanup-selection-summary');
    if (summary) {
      summary.textContent = `${effectiveTargetCount} effective ${effectiveTargetCount === 1 ? 'target' : 'targets'} selected`;
    }
  };

  popupRoot.querySelectorAll('[data-ztracker-cleanup-target-index]').forEach((input) => {
    input.addEventListener('change', updateSummary);
  });
  updateSummary();
}

/** Orders cleanup actions from broadest to narrowest so recreation runs predictably. */
export function sortCleanupTargets(targets: TrackerCleanupTarget[]): TrackerCleanupTarget[] {
  const priority = new Map<TrackerCleanupTarget['kind'], number>([
    ['part', 0],
    ['array-item', 1],
    ['array-item-field', 2],
  ]);

  return [...targets].sort((left, right) => {
    if (left.partKey !== right.partKey) {
      return left.partKey.localeCompare(right.partKey);
    }

    const priorityDelta = (priority.get(left.kind) ?? 0) - (priority.get(right.kind) ?? 0);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    if (left.kind === 'part' || right.kind === 'part') {
      return 0;
    }

    if (left.index !== right.index) {
      return left.index - right.index;
    }

    if (left.kind === 'array-item' || right.kind === 'array-item') {
      return 0;
    }

    return left.fieldKey.localeCompare(right.fieldKey);
  });
}