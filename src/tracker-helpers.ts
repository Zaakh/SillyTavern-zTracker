/** Shares small tracker helpers across render, cleanup, and schema modules. */

/** Resolves the stable identity field for object-array tracker parts. */
export function getArrayItemIdentityKey(schema: any, partKey: string): string {
  const partDef = schema?.properties?.[partKey];
  const key = partDef?.['x-ztracker-idKey'];
  return typeof key === 'string' && key.trim() ? key.trim() : 'name';
}

/** Builds a compact human-readable label for array items and pending cleanup rows. */
export function toShortTrackerLabel(value: unknown, maxLen = 28): string {
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else if (value && typeof value === 'object') {
    const name = (value as any).name;
    text = typeof name === 'string' && name.trim() ? name : '[object]';
  } else {
    text = String(value);
  }

  text = text.replaceAll('\n', ' ').trim();
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}