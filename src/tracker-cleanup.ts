import { getArrayItemIdentityKey } from './tracker-helpers.js';

/** Handles render-safe tracker cleanup targets and pending-redaction metadata. */

export type TrackerCleanupTarget =
  | {
      kind: 'part';
      partKey: string;
    }
  | {
      kind: 'array-item';
      partKey: string;
      index: number;
      displayLabel?: string;
      idKey?: string;
      idValue?: string;
    }
  | {
      kind: 'array-item-field';
      partKey: string;
      index: number;
      fieldKey: string;
      displayLabel?: string;
      idKey?: string;
      idValue?: string;
    };

export interface TrackerPendingRedactions {
  version: 1;
  targets: TrackerCleanupTarget[];
  schemaPresetKey?: string;
}

function getTrackerCleanupIdentity(target: TrackerCleanupTarget): { idKey: string; idValue: string } | undefined {
  if (target.kind === 'part') {
    return undefined;
  }

  return typeof target.idKey === 'string' && target.idKey && typeof target.idValue === 'string' && target.idValue
    ? { idKey: target.idKey, idValue: target.idValue }
    : undefined;
}

function getSchemaType(schema: any): string | undefined {
  if (typeof schema?.type === 'string') {
    return schema.type;
  }
  if (Array.isArray(schema?.type)) {
    return schema.type.find((value: unknown) => typeof value === 'string');
  }
  if (schema?.properties && typeof schema.properties === 'object') {
    return 'object';
  }
  if (schema?.items) {
    return 'array';
  }
  return undefined;
}

function buildBlankValueFromSchema(schema: any): unknown {
  if (schema?.const !== undefined) {
    return schema.const;
  }

  if (Array.isArray(schema?.enum) && schema.enum.length === 1) {
    return schema.enum[0];
  }

  switch (getSchemaType(schema)) {
    case 'object': {
      const properties = schema?.properties;
      if (!properties || typeof properties !== 'object') {
        return {};
      }

      return Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [key, buildBlankValueFromSchema(value)]),
      );
    }
    case 'array':
      return [];
    case 'string':
      return '';
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

function isSameTrackerCleanupItemTarget(
  left: Extract<TrackerCleanupTarget, { kind: 'array-item' | 'array-item-field' }>,
  right: Extract<TrackerCleanupTarget, { kind: 'array-item' | 'array-item-field' }>,
): boolean {
  const leftIdentity = getTrackerCleanupIdentity(left);
  const rightIdentity = getTrackerCleanupIdentity(right);
  if (leftIdentity && rightIdentity) {
    return leftIdentity.idKey === rightIdentity.idKey && leftIdentity.idValue === rightIdentity.idValue;
  }

  return left.index === right.index;
}

export function isSameTrackerCleanupTarget(left: TrackerCleanupTarget, right: TrackerCleanupTarget): boolean {
  if (left.kind !== right.kind || left.partKey !== right.partKey) {
    return false;
  }

  if (left.kind === 'part') {
    return true;
  }

  const leftIndexed = left as Extract<TrackerCleanupTarget, { kind: 'array-item' | 'array-item-field' }>;
  const rightIndexed = right as Extract<TrackerCleanupTarget, { kind: 'array-item' | 'array-item-field' }>;

  if (!isSameTrackerCleanupItemTarget(leftIndexed, rightIndexed)) {
    return false;
  }

  if (left.kind === 'array-item') {
    return true;
  }

  const leftFieldTarget = left as Extract<TrackerCleanupTarget, { kind: 'array-item-field' }>;
  const rightFieldTarget = right as Extract<TrackerCleanupTarget, { kind: 'array-item-field' }>;
  return leftFieldTarget.fieldKey === rightFieldTarget.fieldKey;
}

function isTrackerCleanupAncestor(ancestor: TrackerCleanupTarget, target: TrackerCleanupTarget): boolean {
  if (ancestor.kind === 'part') {
    return ancestor.partKey === target.partKey;
  }

  if (ancestor.kind === 'array-item') {
    return (
      target.kind === 'array-item-field' &&
      ancestor.partKey === target.partKey &&
      isSameTrackerCleanupItemTarget(ancestor, target)
    );
  }

  return false;
}

function isTrackerCleanupTargetResolved(currentTarget: TrackerCleanupTarget, resolvedTarget: TrackerCleanupTarget): boolean {
  return isSameTrackerCleanupTarget(currentTarget, resolvedTarget) || isTrackerCleanupAncestor(resolvedTarget, currentTarget);
}

function applyPartCleanupTarget(nextTracker: any, schema: any, target: Extract<TrackerCleanupTarget, { kind: 'part' }>): void {
  if (!nextTracker || typeof nextTracker !== 'object') {
    throw new Error('Tracker value must be an object');
  }

  nextTracker[target.partKey] = buildBlankValueFromSchema(schema?.properties?.[target.partKey]);
}

function applyArrayItemCleanupTarget(
  nextTracker: any,
  schema: any,
  target: Extract<TrackerCleanupTarget, { kind: 'array-item' }>,
): void {
  const items = nextTracker?.[target.partKey];
  if (!Array.isArray(items)) {
    throw new Error(`Tracker field is not an array: ${target.partKey}`);
  }
  if (target.index < 0 || target.index >= items.length) {
    throw new Error(`Array index out of range for ${target.partKey}: ${target.index}`);
  }

  const itemSchema = schema?.properties?.[target.partKey]?.items;
  const blankItem = buildBlankValueFromSchema(itemSchema);
  const currentItem = items[target.index];
  const idKey = getArrayItemIdentityKey(schema, target.partKey);
  const idValue =
    currentItem && typeof currentItem === 'object' && !Array.isArray(currentItem) ? (currentItem as any)[idKey] : undefined;

  if (
    blankItem &&
    typeof blankItem === 'object' &&
    !Array.isArray(blankItem) &&
    typeof idValue !== 'undefined'
  ) {
    (blankItem as any)[idKey] = idValue;
  }

  items[target.index] = blankItem;
}

function applyArrayItemFieldCleanupTarget(
  nextTracker: any,
  schema: any,
  target: Extract<TrackerCleanupTarget, { kind: 'array-item-field' }>,
): void {
  const items = nextTracker?.[target.partKey];
  if (!Array.isArray(items)) {
    throw new Error(`Tracker field is not an array: ${target.partKey}`);
  }
  if (target.index < 0 || target.index >= items.length) {
    throw new Error(`Array index out of range for ${target.partKey}: ${target.index}`);
  }

  const item = items[target.index];
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`Array item is not an object at ${target.partKey}[${target.index}]`);
  }

  const fieldSchema = schema?.properties?.[target.partKey]?.items?.properties?.[target.fieldKey];
  (item as any)[target.fieldKey] = buildBlankValueFromSchema(fieldSchema);
  items[target.index] = item;
}

/** Removes duplicate cleanup targets and drops descendants when an ancestor target is selected. */
export function normalizeTrackerCleanupTargets(targets: TrackerCleanupTarget[]): TrackerCleanupTarget[] {
  const normalized: TrackerCleanupTarget[] = [];

  for (const target of targets) {
    if (normalized.some((existing) => isSameTrackerCleanupTarget(existing, target))) {
      continue;
    }
    if (normalized.some((existing) => isTrackerCleanupAncestor(existing, target))) {
      continue;
    }

    const filtered = normalized.filter((existing) => !isTrackerCleanupAncestor(target, existing));
    filtered.push(target);
    normalized.length = 0;
    normalized.push(...filtered);
  }

  return normalized;
}

/** Parses stored pending-redaction metadata into a normalized target list. */
export function getPendingRedactionTargets(value: unknown): TrackerCleanupTarget[] {
  const targets = (value as TrackerPendingRedactions | undefined)?.targets;
  if (!Array.isArray(targets)) {
    return [];
  }

  return normalizeTrackerCleanupTargets(
    targets.filter(
      (target): target is TrackerCleanupTarget => !!target && typeof target === 'object' && typeof (target as any).kind === 'string',
    ),
  );
}

/** Reads the persisted schema preset key for pending cleanup targets when present. */
export function getPendingRedactionSchemaPresetKey(value: unknown): string | undefined {
  const schemaPresetKey = (value as TrackerPendingRedactions | undefined)?.schemaPresetKey;
  return typeof schemaPresetKey === 'string' && schemaPresetKey.trim().length > 0 ? schemaPresetKey : undefined;
}

/** Builds the persisted pending-redaction payload or returns undefined when no targets remain. */
export function buildPendingRedactions(
  targets: TrackerCleanupTarget[],
  options?: { schemaPresetKey?: string },
): TrackerPendingRedactions | undefined {
  const normalized = normalizeTrackerCleanupTargets(targets);
  if (normalized.length === 0) {
    return undefined;
  }

  return {
    version: 1,
    targets: normalized,
    ...(typeof options?.schemaPresetKey === 'string' && options.schemaPresetKey.trim().length > 0
      ? { schemaPresetKey: options.schemaPresetKey }
      : {}),
  };
}

/** Removes one or more successfully recreated targets from pending-redaction metadata. */
export function removePendingRedactionTargets(
  value: unknown,
  resolvedTargets: TrackerCleanupTarget[],
): TrackerPendingRedactions | undefined {
  const currentTargets = getPendingRedactionTargets(value);
  if (currentTargets.length === 0) {
    return undefined;
  }

  const remainingTargets = currentTargets.filter(
    (currentTarget) => !resolvedTargets.some((resolvedTarget) => isTrackerCleanupTargetResolved(currentTarget, resolvedTarget)),
  );

  return buildPendingRedactions(remainingTargets, {
    schemaPresetKey: getPendingRedactionSchemaPresetKey(value),
  });
}

/** Applies render-safe blank values for the selected cleanup targets. */
export function clearTrackerCleanupTargets(currentTracker: any, schema: any, targets: TrackerCleanupTarget[]): any {
  const nextTracker = currentTracker && typeof currentTracker === 'object' ? structuredClone(currentTracker) : {};

  for (const target of normalizeTrackerCleanupTargets(targets)) {
    if (target.kind === 'part') {
      applyPartCleanupTarget(nextTracker, schema, target);
      continue;
    }

    if (target.kind === 'array-item') {
      applyArrayItemCleanupTarget(nextTracker, schema, target);
      continue;
    }

    applyArrayItemFieldCleanupTarget(nextTracker, schema, target);
  }

  return nextTracker;
}