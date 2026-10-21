import { describe, it, expect } from '@jest/globals';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { decode } from '@toon-format/toon';
import { formatEmbeddedTrackerSnapshot } from '../embed-snapshot-transform.js';
import type { ExtensionSettings } from '../config.js';

const trackerValue = {
  time: '14:32:05; 09/27/2025 (Saturday)',
  location: 'Cozy downtown bar interior',
  weather: 'Warm indoor, 72°F, no precipitation',
  topics: {
    primaryTopic: 'Water request',
    emotionalTone: 'Calm',
    interactionTheme: 'Customer-service',
  },
  charactersPresent: ['Silvia', 'Jeff'],
  characters: [
    {
      name: 'Silvia',
      hair: 'Long auburn hair, neatly tied back',
      makeup: 'Light natural makeup',
      outfit: 'Black apron over a white button-down shirt, dark slacks, black shoes',
      stateOfDress: 'Professional and tidy',
      postureAndInteraction:
        "Silvia stands behind the polished wooden bar, leaning slightly forward with one hand resting on the counter, her eyes warm and attentive as she listens to the customer's request, occasionally glancing toward Jeff at the nearby stool.",
    },
    {
      name: 'Jeff',
      hair: 'Violet flames looking like hair',
      makeup: 'None',
      outfit: 'Jeff is a flaming elemental, he has not clothing but i clad in red flames',
      stateOfDress: 'Clad in flames.',
      postureAndInteraction: 'Sitting on a bar stool a few seats away.',
    },
  ],
};

const toonTrackerValue = {
  ...trackerValue,
  notes: {
    multiline: 'line1\nline2',
    punctuation: 'comma, colon: bracket[] pipe| tab\t value',
  },
};

const embedSettings = {
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
    toon: {
      name: 'TOON (compact)',
      input: 'toon' as any,
      pattern: '',
      flags: 'g',
      replacement: '',
      codeFenceLang: 'toon',
      wrapInCodeFence: true,
    },
  },
} as Pick<ExtensionSettings, 'embedZTrackerSnapshotTransformPresets'>;

describe('formatEmbeddedTrackerSnapshot (minimal)', () => {
  it('transforms a nested object and writes an artifact file', async () => {
    const settings = {
      ...embedSettings,
      embedZTrackerSnapshotTransformPreset: 'minimal',
    } as Pick<ExtensionSettings, 'embedZTrackerSnapshotTransformPreset' | 'embedZTrackerSnapshotTransformPresets'>;

    const { lang, text, wrapInCodeFence } = formatEmbeddedTrackerSnapshot(trackerValue, settings);
    expect(lang).toBe('text');
    expect(wrapInCodeFence).toBe(false);

    const expected =
      'time: 14:32:05; 09/27/2025 (Saturday)\n' +
      'location: Cozy downtown bar interior\n' +
      'weather: Warm indoor, 72°F, no precipitation\n' +
      'topics:\n' +
      '  primaryTopic: Water request\n' +
      '  emotionalTone: Calm\n' +
      '  interactionTheme: Customer-service\n' +
      'charactersPresent:\n' +
      '  - Silvia\n' +
      '  - Jeff\n' +
      'characters:\n' +
      '  [Silvia:\n' +
      '    name: Silvia\n' +
      '    hair: Long auburn hair, neatly tied back\n' +
      '    makeup: Light natural makeup\n' +
      '    outfit: Black apron over a white button-down shirt, dark slacks, black shoes\n' +
      '    stateOfDress: Professional and tidy\n' +
      "    postureAndInteraction: Silvia stands behind the polished wooden bar, leaning slightly forward with one hand resting on the counter, her eyes warm and attentive as she listens to the customer's request, occasionally glancing toward Jeff at the nearby stool.\n" +
      '  ]\n' +
      '  [Jeff:\n' +
      '    name: Jeff\n' +
      '    hair: Violet flames looking like hair\n' +
      '    makeup: None\n' +
      '    outfit: Jeff is a flaming elemental, he has not clothing but i clad in red flames\n' +
      '    stateOfDress: Clad in flames.\n' +
      '    postureAndInteraction: Sitting on a bar stool a few seats away.\n' +
      '  ]\n';

    expect(text).toBe(expected);

    const outDir = path.join(process.cwd(), 'test-output');
    await mkdir(outDir, { recursive: true });

    const outPath = path.join(outDir, 'embed-snapshot-minimal.txt');
    await writeFile(outPath, text, 'utf8');
  });
});

describe('formatEmbeddedTrackerSnapshot (toon)', () => {
  it('encodes tracker data as TOON, round-trips it, and writes an artifact file', async () => {
    const settings = {
      ...embedSettings,
      embedZTrackerSnapshotTransformPreset: 'toon',
    } as Pick<ExtensionSettings, 'embedZTrackerSnapshotTransformPreset' | 'embedZTrackerSnapshotTransformPresets'>;

    const { lang, text, wrapInCodeFence } = formatEmbeddedTrackerSnapshot(toonTrackerValue, settings);

    expect(lang).toBe('toon');
    expect(wrapInCodeFence).toBe(true);
    expect(text.length).toBeGreaterThan(0);
    expect(text.startsWith('{')).toBe(false);
    expect(text).toContain('characters[');

    const decoded = decode(text);
    expect(decoded).toEqual(toonTrackerValue);
    expect(text.length).toBeLessThan(JSON.stringify(toonTrackerValue, null, 2).length);

    const outDir = path.join(process.cwd(), 'test-output');
    await mkdir(outDir, { recursive: true });

    const outPath = path.join(outDir, 'embed-snapshot-toon.txt');
    await writeFile(outPath, text, 'utf8');
  });
});

describe('formatEmbeddedTrackerSnapshot (flat)', () => {
  const flatSettings = {
    embedZTrackerSnapshotTransformPreset: 'flat',
    embedZTrackerSnapshotTransformPresets: {
      ...embedSettings.embedZTrackerSnapshotTransformPresets,
      flat: { name: 'Flat', input: 'flat_lines', pattern: '', flags: 'g', replacement: '', codeFenceLang: 'text' },
    },
  } as unknown as Pick<ExtensionSettings, 'embedZTrackerSnapshotTransformPreset' | 'embedZTrackerSnapshotTransformPresets'>;

  it('renders scalars, nested objects, scalar arrays and arrays of objects on one line each', () => {
    const { text, wrapInCodeFence } = formatEmbeddedTrackerSnapshot(
      {
        species: 'Elf',
        personality: 'Shy, curious',
        clothing: { top: 'red cloak', bottom: 'brown trousers' },
        quirks: ['humming', 'staring'],
        relationships: [
          { name: 'Alice', bond: 'sister' },
          { name: 'Cid', bond: 'rival' },
        ],
        age: 12,
        alive: true,
      },
      flatSettings,
      { title: 'Bob' },
    );
    expect(wrapInCodeFence).toBe(false);
    expect(text).toBe(
      '[Topic: Bob\n' +
        'species: Elf\n' +
        'personality: Shy, curious\n' +
        'clothing: top: red cloak; bottom: brown trousers\n' +
        'quirks: humming; staring\n' +
        'relationships: Alice (bond: sister); Cid (bond: rival)\n' +
        'age: 12\n' +
        'alive: true\n' +
        ']',
    );
  });

  it('labels unlabeled array items by position', () => {
    const { text } = formatEmbeddedTrackerSnapshot({ items: [{ a: 'x' }, { a: 'y' }] }, flatSettings, { title: 'T' });
    expect(text).toContain('items: item1 (a: x); item2 (a: y)');
  });

  it('omits empty values and collapses line breaks', () => {
    const { text } = formatEmbeddedTrackerSnapshot(
      { notes: '', quirks: [], gone: null, empty: {}, bio: 'line1\n  \nline2' },
      flatSettings,
      { title: 'T' },
    );
    expect(text).toBe('[Topic: T\nbio: line1 line2\n]');
  });

  it('uses the module name unless a title is supplied', () => {
    expect(formatEmbeddedTrackerSnapshot({ a: 1 }, flatSettings, { moduleName: 'Plot Steer' }).text).toMatch(/^\[Topic: Plot Steer\n/);
    expect(formatEmbeddedTrackerSnapshot({ a: 1 }, flatSettings, { moduleName: 'Plot Steer', title: 'Bob' }).text).toMatch(/^\[Topic: Bob\n/);
  });

  it('leaves minimal output unchanged when options are passed', () => {
    const settings = { ...embedSettings, embedZTrackerSnapshotTransformPreset: 'minimal' } as any;
    expect(formatEmbeddedTrackerSnapshot(trackerValue, settings, { title: 'X', moduleName: 'Y' }).text).toBe(
      formatEmbeddedTrackerSnapshot(trackerValue, settings).text,
    );
  });
});
