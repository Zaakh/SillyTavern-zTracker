import type { ExtensionSettings } from './config.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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
      ? buildTopLevelLines(trackerValue)
      : JSON.stringify(trackerValue ?? {}, null, 2);

  const pattern = preset?.pattern ?? '';
  const flags = preset?.flags ?? '';
  const replacement = preset?.replacement ?? '';
  const lang = preset?.codeFenceLang || (input === 'pretty_json' ? 'json' : 'text');
  const wrapInCodeFence =
    typeof preset?.wrapInCodeFence === 'boolean' ? preset.wrapInCodeFence : presetKey === 'minimal' ? false : true;

  if (!pattern.trim()) {
    return { lang, text: baseText, wrapInCodeFence };
  }

  try {
    const re = new RegExp(pattern, flags);
    return { lang, text: baseText.replace(re, replacement), wrapInCodeFence };
  } catch {
    return { lang, text: baseText, wrapInCodeFence };
  }
}
