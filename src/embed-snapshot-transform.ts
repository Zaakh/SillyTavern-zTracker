import type { ExtensionSettings } from './config.js';

// Formats zTracker tracker snapshots for embedding into prompt context.

function minifyEmbeddingWhitespace(text: string): string {
  // Preserve indentation (YAML-like), but remove blank lines and trailing whitespace.
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/g, ''))
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) return '';
  return `${lines.join('\n')}\n`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function shouldQuoteMinimalString(value: string): boolean {
  // Keep quotes only when the value is a direct quote or would be ambiguous in plain text.
  return (
    value.length === 0 ||
    value.includes('"') ||
    value.includes('\n') ||
    value.startsWith(' ') ||
    value.endsWith(' ') ||
    value.startsWith('\t') ||
    value.endsWith('\t')
  );
}

function formatScalarMinimal(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    return shouldQuoteMinimalString(value) ? JSON.stringify(value) : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // Fallback for unexpected scalars (e.g. bigint, symbol): keep deterministic JSON-like output.
  return JSON.stringify(value);
}

function pickArrayItemLabel(item: Record<string, unknown>, index: number): string {
  const candidates: Array<string> = [];
  const name = item.name;
  const id = item.id;
  const uid = item.uid;
  const key = item.key;

  if (typeof name === 'string') candidates.push(name);
  if (typeof id === 'string') candidates.push(id);
  if (typeof id === 'number') candidates.push(String(id));
  if (typeof uid === 'string') candidates.push(uid);
  if (typeof key === 'string') candidates.push(key);

  const label = candidates.find((c) => c.trim().length > 0 && !c.includes(']') && !c.includes('\n'));
  return label ?? `item${index + 1}`;
}

function buildMinimalLinesForEmbedding(value: unknown, indent = ''): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}(empty)\n`;
    return value
      .map((item, index) => {
        if (isPlainObject(item) || Array.isArray(item)) {
          const label = isPlainObject(item) ? pickArrayItemLabel(item, index) : `item${index + 1}`;
          return (
            `${indent}[${label}:\n` +
            `${buildMinimalLinesForEmbedding(item, `${indent}  `)}` +
            `${indent}]\n`
          );
        }
        return `${indent}- ${formatScalarMinimal(item)}\n`;
      })
      .join('');
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return `${indent}(empty)\n`;
    return entries
      .map(([key, v]) => {
        if (isPlainObject(v) || Array.isArray(v)) {
          return `${indent}${key}:\n${buildMinimalLinesForEmbedding(v, `${indent}  `)}`;
        }
        return `${indent}${key}: ${formatScalarMinimal(v)}\n`;
      })
      .join('');
  }

  return `${indent}${formatScalarMinimal(value)}\n`;
}

function buildMinimalLines(value: unknown, indent = ''): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}(empty)\n`;
    return value
      .map((item) => {
        if (isPlainObject(item) || Array.isArray(item)) {
          return `${indent}-\n${buildMinimalLines(item, `${indent}  `)}`;
        }
        return `${indent}- ${JSON.stringify(item)}\n`;
      })
      .join('');
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return `${indent}(empty)\n`;
    return entries
      .map(([key, v]) => {
        if (isPlainObject(v) || Array.isArray(v)) {
          return `${indent}${key}:\n${buildMinimalLines(v, `${indent}  `)}`;
        }
        return `${indent}${key}: ${JSON.stringify(v)}\n`;
      })
      .join('');
  }

  return `${indent}${JSON.stringify(value)}\n`;
}

function buildTopLevelLines(value: unknown): string {
  if (!isPlainObject(value)) {
    return buildMinimalLines(value);
  }

  const blocks = Object.entries(value)
    .map(([key, v]) => {
      if (isPlainObject(v) || Array.isArray(v)) {
        return `${key}:\n${buildMinimalLines(v, '  ')}`.trimEnd();
      }
      return `${key}: ${JSON.stringify(v)}`;
    })
    .join('\n\n');

  return `${blocks}\n`;
}

function buildTopLevelLinesForEmbedding(value: unknown): string {
  if (!isPlainObject(value)) {
    return buildMinimalLinesForEmbedding(value);
  }

  const blocks = Object.entries(value)
    .map(([key, v]) => {
      if (isPlainObject(v) || Array.isArray(v)) {
        return `${key}:\n${buildMinimalLinesForEmbedding(v, '  ')}`.trimEnd();
      }
      return `${key}: ${formatScalarMinimal(v)}`;
    })
    .join('\n');

  return `${blocks}\n`;
}

export function formatEmbeddedTrackerSnapshot(
  trackerValue: unknown,
  settings: Pick<ExtensionSettings, 'embedZTrackerSnapshotTransformPreset' | 'embedZTrackerSnapshotTransformPresets'>,
): { lang: string; text: string; wrapInCodeFence: boolean } {
  const presets = settings.embedZTrackerSnapshotTransformPresets;
  const presetKey = settings.embedZTrackerSnapshotTransformPreset;
  const preset = (presetKey && presets && presets[presetKey]) || presets?.default;

  const input = preset?.input ?? 'pretty_json';
  const baseText =
    input === 'top_level_lines'
      ? presetKey === 'minimal'
        ? buildTopLevelLinesForEmbedding(trackerValue)
        : buildTopLevelLines(trackerValue)
      : JSON.stringify(trackerValue ?? {}, null, 2);

  const pattern = preset?.pattern ?? '';
  const flags = preset?.flags ?? '';
  const replacement = preset?.replacement ?? '';
  const lang = preset?.codeFenceLang || (input === 'pretty_json' ? 'json' : 'text');
  const wrapInCodeFence =
    typeof preset?.wrapInCodeFence === 'boolean' ? preset.wrapInCodeFence : presetKey === 'minimal' ? false : true;

  const baseOrMinified = presetKey === 'minimal' ? minifyEmbeddingWhitespace(baseText) : baseText;

  if (!pattern.trim()) {
    return { lang, text: baseOrMinified, wrapInCodeFence };
  }

  try {
    const re = new RegExp(pattern, flags);
    const replaced = baseOrMinified.replace(re, replacement);
    return { lang, text: replaced, wrapInCodeFence };
  } catch {
    return { lang, text: baseOrMinified, wrapInCodeFence };
  }
}
