import { describe, it, expect } from '@jest/globals';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { formatEmbeddedTrackerSnapshot } from '../embed-snapshot-transform.js';
import type { ExtensionSettings } from '../config.js';

describe('formatEmbeddedTrackerSnapshot (minimal)', () => {
  it('transforms a nested object and writes an artifact file', async () => {
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
