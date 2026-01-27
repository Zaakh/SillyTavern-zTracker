export function getTopLevelSchemaKeys(schema: any): string[] {
  const props = schema?.properties;
  if (!props || typeof props !== 'object') {
    return [];
  }
  return Object.keys(props);
}

function normalizeDependsOn(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (Array.isArray(value)) {
    return value
      .filter((v) => typeof v === 'string')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Resolves a stable top-level generation order, honoring optional schema annotations.
 *
 * Supported JSON-schema extension fields (per top-level property):
 * - x-ztracker-dependsOn: string | string[] (other top-level keys)
 *
 * If a cycle is detected, falls back to the schema's declared property order.
 */
export function resolveTopLevelPartsOrder(schema: any): string[] {
  const baseOrder = getTopLevelSchemaKeys(schema);
  if (baseOrder.length <= 1) return baseOrder;

  const props = schema?.properties;
  if (!props || typeof props !== 'object') return baseOrder;

  const nodes = new Set(baseOrder);
  const depsByNode = new Map<string, Set<string>>();
  for (const key of baseOrder) {
    const def = (props as any)[key];
    const deps = normalizeDependsOn(def?.['x-ztracker-dependsOn']).filter((d) => nodes.has(d));
    depsByNode.set(key, new Set(deps));
  }

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, Set<string>>();
  for (const key of baseOrder) {
    inDegree.set(key, 0);
    dependents.set(key, new Set());
  }
  for (const [key, deps] of depsByNode.entries()) {
    for (const dep of deps) {
      inDegree.set(key, (inDegree.get(key) ?? 0) + 1);
      dependents.get(dep)!.add(key);
    }
  }

  const rank = new Map<string, number>(baseOrder.map((k, i) => [k, i]));
  const ready: string[] = baseOrder.filter((k) => (inDegree.get(k) ?? 0) === 0);
  ready.sort((a, b) => (rank.get(a)! - rank.get(b)!));

  const out: string[] = [];
  while (ready.length) {
    const next = ready.shift()!;
    out.push(next);
    for (const dep of dependents.get(next) ?? []) {
      const nd = (inDegree.get(dep) ?? 0) - 1;
      inDegree.set(dep, nd);
      if (nd === 0) {
        ready.push(dep);
        ready.sort((a, b) => (rank.get(a)! - rank.get(b)!));
      }
    }
  }

  // Cycle or disconnected graph with remaining nodes -> fallback for safety.
  if (out.length !== baseOrder.length) return baseOrder;
  return out;
}

export function getArrayItemIdentityKey(schema: any, partKey: string): string {
  const partDef = schema?.properties?.[partKey];
  const key = partDef?.['x-ztracker-idKey'];
  return typeof key === 'string' && key.trim() ? key.trim() : 'name';
}

export function buildTopLevelPartSchema(schema: any, partKey: string): any {
  const partDef = schema?.properties?.[partKey];
  if (!partDef) {
    throw new Error(`Unknown schema part: ${partKey}`);
  }

  const partSchema: any = {
    $schema: schema?.$schema ?? 'http://json-schema.org/draft-07/schema#',
    title: `${schema?.title ?? 'SceneTracker'}Part`,
    type: 'object',
    properties: {
      [partKey]: partDef,
    },
    required: [partKey],
  };

  // Preserve definitions when present (future-proofing for presets that rely on them).
  if (schema?.definitions) {
    partSchema.definitions = schema.definitions;
  }
  if (schema?.$defs) {
    partSchema.$defs = schema.$defs;
  }

  return partSchema;
}

export function buildArrayItemSchema(schema: any, partKey: string): any {
  const partDef = schema?.properties?.[partKey];
  if (!partDef) {
    throw new Error(`Unknown schema part: ${partKey}`);
  }

  const itemsDef = partDef?.items;
  if (!itemsDef) {
    throw new Error(`Schema part is not an array with items: ${partKey}`);
  }

  const itemSchema: any = {
    $schema: schema?.$schema ?? 'http://json-schema.org/draft-07/schema#',
    title: `${schema?.title ?? 'SceneTracker'}${partKey}Item`,
    type: 'object',
    properties: {
      item: itemsDef,
    },
    required: ['item'],
  };

  if (schema?.definitions) {
    itemSchema.definitions = schema.definitions;
  }
  if (schema?.$defs) {
    itemSchema.$defs = schema.$defs;
  }

  return itemSchema;
}

export function buildArrayItemFieldSchema(schema: any, partKey: string, fieldKey: string): any {
  const partDef = schema?.properties?.[partKey];
  if (!partDef) {
    throw new Error(`Unknown schema part: ${partKey}`);
  }

  const itemsDef = partDef?.items;
  if (!itemsDef) {
    throw new Error(`Schema part is not an array with items: ${partKey}`);
  }
  if (itemsDef?.type !== 'object') {
    throw new Error(`Schema array items are not an object: ${partKey}`);
  }

  const props = itemsDef?.properties;
  if (!props || typeof props !== 'object') {
    throw new Error(`Schema array items missing properties: ${partKey}`);
  }
  const fieldDef = (props as any)[fieldKey];
  if (!fieldDef) {
    throw new Error(`Unknown array item field: ${partKey}.${fieldKey}`);
  }

  const fieldSchema: any = {
    $schema: schema?.$schema ?? 'http://json-schema.org/draft-07/schema#',
    title: `${schema?.title ?? 'SceneTracker'}${partKey}Item${fieldKey}Field`,
    type: 'object',
    properties: {
      value: fieldDef,
    },
    required: ['value'],
  };

  if (schema?.definitions) {
    fieldSchema.definitions = schema.definitions;
  }
  if (schema?.$defs) {
    fieldSchema.$defs = schema.$defs;
  }

  return fieldSchema;
}

export function mergeTrackerPart(currentTracker: any, partKey: string, partObject: any): any {
  if (!partObject || typeof partObject !== 'object') {
    throw new Error('Part response must be an object');
  }
  if (!(partKey in partObject)) {
    throw new Error(`Part response missing key: ${partKey}`);
  }

  const base = currentTracker && typeof currentTracker === 'object' ? currentTracker : {};
  return {
    ...base,
    [partKey]: (partObject as any)[partKey],
  };
}

export function replaceTrackerArrayItem(currentTracker: any, partKey: string, index: number, item: unknown): any {
  const base = currentTracker && typeof currentTracker === 'object' ? structuredClone(currentTracker) : {};
  const arr = (base as any)[partKey];
  if (!Array.isArray(arr)) {
    throw new Error(`Tracker field is not an array: ${partKey}`);
  }
  if (index < 0 || index >= arr.length) {
    throw new Error(`Array index out of range for ${partKey}: ${index}`);
  }
  arr[index] = item;
  return base;
}

export function replaceTrackerArrayItemField(
  currentTracker: any,
  partKey: string,
  index: number,
  fieldKey: string,
  value: unknown,
): any {
  const base = currentTracker && typeof currentTracker === 'object' ? structuredClone(currentTracker) : {};
  const arr = (base as any)[partKey];
  if (!Array.isArray(arr)) {
    throw new Error(`Tracker field is not an array: ${partKey}`);
  }
  if (index < 0 || index >= arr.length) {
    throw new Error(`Array index out of range for ${partKey}: ${index}`);
  }

  const item = arr[index];
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`Array item is not an object at ${partKey}[${index}]`);
  }
  if (!fieldKey) {
    throw new Error('Field key is required');
  }

  (item as any)[fieldKey] = value;
  arr[index] = item;
  return base;
}

export function redactTrackerArrayItemFieldValue(
  currentTracker: any,
  partKey: string,
  index: number,
  fieldKey: string,
): any {
  const base = currentTracker && typeof currentTracker === 'object' ? structuredClone(currentTracker) : {};
  const arr = (base as any)[partKey];
  if (!Array.isArray(arr)) {
    throw new Error(`Tracker field is not an array: ${partKey}`);
  }
  if (index < 0 || index >= arr.length) {
    throw new Error(`Array index out of range for ${partKey}: ${index}`);
  }

  const item = arr[index];
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`Array item is not an object at ${partKey}[${index}]`);
  }
  if (!fieldKey) {
    throw new Error('Field key is required');
  }

  // Remove the old value entirely so the model isn't anchored to it.
  if (fieldKey in (item as any)) {
    delete (item as any)[fieldKey];
  }

  arr[index] = item;
  return base;
}

export function findArrayItemIndexByName(items: unknown[], name: string): number {
  if (!Array.isArray(items)) return -1;
  if (!name) return -1;

  // Prefer exact match first.
  const exact = items.findIndex(
    (it: any) => it && typeof it === 'object' && typeof it.name === 'string' && it.name === name,
  );
  if (exact !== -1) return exact;

  // Fallback to case-insensitive match only when unique.
  const lowered = name.toLowerCase();
  const matches: number[] = [];
  items.forEach((it: any, idx) => {
    if (it && typeof it === 'object' && typeof it.name === 'string' && it.name.toLowerCase() === lowered) {
      matches.push(idx);
    }
  });
  if (matches.length === 1) return matches[0];
  return -1;
}

export function findArrayItemIndexByIdentity(items: unknown[], idKey: string, idValue: string): number {
  if (!Array.isArray(items)) return -1;
  if (!idKey) return -1;
  if (!idValue) return -1;

  // Prefer exact match first.
  const exact = items.findIndex(
    (it: any) => it && typeof it === 'object' && typeof it[idKey] === 'string' && it[idKey] === idValue,
  );
  if (exact !== -1) return exact;

  // Fallback to case-insensitive match only when unique.
  const lowered = idValue.toLowerCase();
  const matches: number[] = [];
  items.forEach((it: any, idx) => {
    if (it && typeof it === 'object' && typeof it[idKey] === 'string' && it[idKey].toLowerCase() === lowered) {
      matches.push(idx);
    }
  });
  if (matches.length === 1) return matches[0];
  return -1;
}
