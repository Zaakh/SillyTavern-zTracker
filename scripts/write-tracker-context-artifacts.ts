/**
 * @jest-environment jsdom
 *
 * Refreshes the saved live-like tracker-context artifacts so maintainers can
 * inspect both the raw request payload and the plain-text inspection flatten.
 */

export {};

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { PromptEngineeringMode } = await import('../src/config.js');
const {
  captureTrackerContext,
  expectLiveLikeTrackerContext,
  flattenCapturedTrackerContext,
} = await import('./debug-tracker-context-capture.js');

type ArtifactMode = {
  mode: (typeof PromptEngineeringMode)[keyof typeof PromptEngineeringMode];
  slug: 'json' | 'xml' | 'toon';
  label: 'JSON' | 'XML' | 'TOON';
};

const ARTIFACT_MODES: ArtifactMode[] = [
  { mode: PromptEngineeringMode.JSON, slug: 'json', label: 'JSON' },
  { mode: PromptEngineeringMode.XML, slug: 'xml', label: 'XML' },
  { mode: PromptEngineeringMode.TOON, slug: 'toon', label: 'TOON' },
];

describe('write tracker context artifacts', () => {
  test('refreshes the saved plain-text tracker-context snapshots', async () => {
    for (const artifact of ARTIFACT_MODES) {
      const captured = await captureTrackerContext(artifact.mode);

      expectLiveLikeTrackerContext(artifact.mode, captured);

      writeFileSync(
        resolve(process.cwd(), 'test-output', `tracker-context-${artifact.slug}.txt`),
        `${flattenCapturedTrackerContext(captured)}\n`,
        'utf8',
      );
    }
  });
});