/** Repairs known malformed schema shapes before prompt generation or persistence. */

function normalizeStringArrayLike(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim());
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const orderedEntries = Object.entries(value)
    .filter(([key]) => /^\d+$/.test(key))
    .sort((left, right) => Number(left[0]) - Number(right[0]));
  if (orderedEntries.length === 0) {
    return undefined;
  }

  const hasSequentialIndexes = orderedEntries.every(([key], index) => Number(key) === index);
  const hasOnlyStrings = orderedEntries.every(([, item]) => typeof item === 'string' && item.trim().length > 0);
  if (!hasSequentialIndexes || !hasOnlyStrings) {
    return undefined;
  }

  return orderedEntries.map(([, item]) => (item as string).trim());
}

/**
 * Restores corrupted `required` metadata that was accidentally moved into `properties.required`.
 * The repair is intentionally narrow so legitimate field schemas named `required` are left intact.
 */
export function repairCorruptedRequiredMetadata(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map((item) => repairCorruptedRequiredMetadata(item));
  }

  const source = schema as Record<string, unknown>;
  const repaired: Record<string, unknown> = { ...source };

  const sourceProperties = source.properties;
  const properties = sourceProperties && typeof sourceProperties === 'object' && !Array.isArray(sourceProperties)
    ? (sourceProperties as Record<string, unknown>)
    : undefined;
  const misplacedRequired = normalizeStringArrayLike(properties?.required);
  const currentRequired = normalizeStringArrayLike(source.required);

  if (currentRequired && currentRequired.length > 0) {
    repaired.required = currentRequired;
  } else if (misplacedRequired && misplacedRequired.length > 0) {
    repaired.required = misplacedRequired;
  }

  if (properties) {
    repaired.properties = Object.fromEntries(
      Object.entries(properties)
        .filter(([key, value]) => key !== 'required' || normalizeStringArrayLike(value) === undefined)
        .map(([key, value]) => [key, repairCorruptedRequiredMetadata(value)]),
    );
  }

  if (source.items !== undefined) {
    repaired.items = repairCorruptedRequiredMetadata(source.items);
  }

  return repaired;
}