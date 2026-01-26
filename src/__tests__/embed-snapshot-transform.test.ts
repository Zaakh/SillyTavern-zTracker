import { describe, it, expect } from '@jest/globals';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { formatEmbeddedTrackerSnapshot } from '../embed-snapshot-transform.js';
import type { ExtensionSettings } from '../config.js';

describe('formatEmbeddedTrackerSnapshot (minimal)', () => {
  it('transforms a nested object and writes an artifact file', async () => {
    const trackerValue = {
      time: '10:00:00; 01/25/2026 (Sunday)',
      location: 'Food court, second floor',
      topics: {
        primaryTopic: 'Shopping',
        emotionalTone: 'Playful',
        interactionTheme: 'Teasing',
      },
      charactersPresent: ['Alice', 'Bob'],
      numbers: [1, 2, 3],
      meta: {
        flags: [true, false],
        note: null,
      },
    };

    const settings = {
      embedZTrackerSnapshotTransformPreset: 'minimal',
      embedZTrackerSnapshotTransformPresets: {
        default: {
          name: 'Default (JSON)',
          input: 'pretty_json',
          pattern: '',
          flags: 'g',
          replacement: '',
          codeFenceLang: 'json',
          wrapInCodeFence: true,
        },
        minimal: {
          name: 'Minimal (top-level properties)',
          input: 'top_level_lines',
          pattern: '^[\\t ]*\"([^\"]+)\"[\\t ]*:[\\t ]*(.*?)(?:,)?[\\t ]*$',
          flags: 'gm',
          replacement: '$1: $2',
          codeFenceLang: 'text',
          wrapInCodeFence: false,
        },
      },
    } as Pick<ExtensionSettings, 'embedZTrackerSnapshotTransformPreset' | 'embedZTrackerSnapshotTransformPresets'>;

    const { lang, text, wrapInCodeFence } = formatEmbeddedTrackerSnapshot(trackerValue, settings);
    expect(lang).toBe('text');
    expect(wrapInCodeFence).toBe(false);

    const expected =
      'time: "10:00:00; 01/25/2026 (Sunday)"\n\n' +
      'location: "Food court, second floor"\n\n' +
      'topics:\n' +
      '  primaryTopic: "Shopping"\n' +
      '  emotionalTone: "Playful"\n' +
      '  interactionTheme: "Teasing"\n\n' +
      'charactersPresent:\n' +
      '  - "Alice"\n' +
      '  - "Bob"\n\n' +
      'numbers:\n' +
      '  - 1\n' +
      '  - 2\n' +
      '  - 3\n\n' +
      'meta:\n' +
      '  flags:\n' +
      '    - true\n' +
      '    - false\n' +
      '  note: null\n';

    expect(text).toBe(expected);

    const outDir = path.join(process.cwd(), 'test-output');
    await mkdir(outDir, { recursive: true });

    const outPath = path.join(outDir, 'embed-snapshot-minimal.txt');
    await writeFile(outPath, text, 'utf8');
  });
});
