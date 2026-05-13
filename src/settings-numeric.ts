/** Normalizes integer settings so UI edits and migrated saved data share the same bounds. */
export function sanitizeIntegerSetting(
  value: unknown,
  options: {
    fallback: number;
    min: number;
  },
): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    return options.fallback;
  }

  return Math.max(options.min, parsed);
}
