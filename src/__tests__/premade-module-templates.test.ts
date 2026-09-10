/**
 * Regression coverage for the pre-made Module templates shipped under `templates/modules/`
 * (see openspec/changes/add-narrator-plot-modules). These are static JSON files nobody
 * exercises through normal development, so this suite guards against a future change to the
 * Module/import/render pipeline silently breaking a shipped template: each file must still
 * parse, import, and render exactly like a real user-exported Module would.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
// Jest runs from the repo root, so resolving relative to process.cwd() avoids needing
// import.meta.url/__dirname handling under this project's mixed CJS/ESM Jest transform.
import Handlebars from 'handlebars';
import {
  createImportedTrackerModule,
  parseImportedTrackerModule,
  type ImportedTrackerModule,
} from '../components/settings/module-import.js';
import type { TrackerModule } from '../config.js';
import { resolveTrackerModuleIncludeEntries } from '../tracker-module-chaining.js';

// The Settings UI import flow has no `join` helper registered on its own - it relies on the
// global registration in src/index.tsx (not imported in tests, see repo test conventions), so
// tests that render a template using `join` must register it themselves.
if (!Handlebars.helpers['join']) {
  Handlebars.registerHelper('join', function (array: unknown, separator: unknown) {
    return Array.isArray(array) ? array.join(typeof separator === 'string' ? separator : ', ') : '';
  });
}

const TEMPLATES_DIR = joinPath(process.cwd(), 'templates', 'modules');

function loadTemplate(fileName: string): ImportedTrackerModule {
  const text = readFileSync(joinPath(TEMPLATES_DIR, fileName), 'utf8');
  const parsed = parseImportedTrackerModule(text);
  if (!parsed) {
    throw new Error(`${fileName} failed to parse as an importable Module`);
  }
  return parsed;
}

/** Renders a Module's active schema preset HTML against `data`, matching renderTracker's own compile options. */
function renderModuleHtml(module: TrackerModule, data: unknown): string {
  const preset = module.schema.presets[module.schema.preset];
  if (!preset) {
    throw new Error(`Module "${module.id}" has no schema preset "${module.schema.preset}"`);
  }
  const template = Handlebars.compile(preset.html, { strict: true });
  return template({ data });
}

describe('pre-made Module templates (templates/modules/*.json)', () => {
  test('scene-tracker.json parses, imports, and renders with representative data', () => {
    const imported = loadTemplate('scene-tracker.json');
    const sceneTracker = createImportedTrackerModule(imported, []);

    expect(sceneTracker.id).toBe('scene-tracker');
    expect(sceneTracker.enabled).toBe(true);
    expect(sceneTracker.systemPrompt.content.length).toBeGreaterThan(0);
    expect(sceneTracker.systemPrompt.savedName).toBe('zTracker-SceneTracker-1.0');

    const html = renderModuleHtml(sceneTracker, {
      time: '08:00:00; 01/01/2026 (Thursday)',
      location: 'Kitchen, downtown apartment, Chicago, IL',
      weather: 'Clear, 60F',
      topics: { primaryTopic: 'breakfast', emotionalTone: 'calm', interactionTheme: 'domestic' },
      charactersPresent: ['Alex'],
      characters: [
        {
          name: 'Alex',
          hair: 'Tied back',
          makeup: 'None',
          outfit: 'Grey hoodie, jeans',
          stateOfDress: 'Put together',
          postureAndInteraction: 'Sitting at the table',
        },
      ],
    });
    expect(html).toContain('Kitchen, downtown apartment, Chicago, IL');
  });

  test('plot-log.json parses, imports, and renders with representative data', () => {
    const imported = loadTemplate('plot-log.json');
    const plotLog = createImportedTrackerModule(imported, []);

    expect(plotLog.id).toBe('plot-log');
    expect(plotLog.injection.includeLastXMessages).toBe(0);
    expect(plotLog.auto.enabled).toBe(false);
    expect(plotLog.connection.source).toBe('active');
    expect(plotLog.systemPrompt.content.length).toBeGreaterThan(0);
    expect(plotLog.systemPrompt.savedName).toBe('zTracker-PlotLog-1.0');

    const html = renderModuleHtml(plotLog, {
      arc: 'Investigating the missing shipment',
      openThreads: ['Who tipped off the smugglers?', 'The informant is still missing'],
      recentEvents: ['Found a forged manifest', 'The dockmaster went silent'],
      stakes: 'The shipment is the crew\'s only way to pay off their debt',
    });
    expect(html).toContain('Investigating the missing shipment');
    expect(html).toContain('Who tipped off the smugglers?, The informant is still missing');
  });

  test('plot-steer.json parses, imports, and renders with representative data', () => {
    // Import order matters for chaining (see the "Ordered import for chained templates"
    // requirement) - Plot Log must exist first for Plot Steer's chained entry to be eligible.
    const plotLog = createImportedTrackerModule(loadTemplate('plot-log.json'), []);
    const plotSteer = createImportedTrackerModule(loadTemplate('plot-steer.json'), [plotLog]);

    expect(plotSteer.id).toBe('plot-steer');
    expect(plotSteer.auto.enabled).toBe(true);
    expect(plotSteer.auto.direction).toBe('inputs');
    expect(plotSteer.injection.includeLastXMessages).toBe(1);
    expect(plotSteer.connection.source).toBe('active');
    expect(plotSteer.systemPrompt.content.length).toBeGreaterThan(0);
    expect(plotSteer.systemPrompt.savedName).toBe('zTracker-PlotSteer-1.0');
    // Plot Log and Plot Steer each carry their own tailored prompt, not a shared/duplicated one.
    expect(plotSteer.systemPrompt.content).not.toBe(plotLog.systemPrompt.content);

    const html = renderModuleHtml(plotSteer, { nextBeat: 'Reveal the dockmaster was bribed.', pacing: 'twist' });
    expect(html).toContain('Reveal the dockmaster was bribed.');
    expect(html).toContain('twist');
  });

  test('plot-steer.json chained entry is eligible when Plot Log is imported first and ordered earlier', () => {
    const plotLog = createImportedTrackerModule(loadTemplate('plot-log.json'), []);
    const plotSteer = createImportedTrackerModule(loadTemplate('plot-steer.json'), [plotLog]);

    const resolved = resolveTrackerModuleIncludeEntries(plotSteer, [plotLog, plotSteer]);
    const chainedEntry = resolved.find((entry) => !entry.isSelf);
    expect(chainedEntry?.entry).toEqual({ target: 'plot-log', count: 3 });
    expect(chainedEntry?.eligible).toBe(true);
  });

  // Self-heal (ensureModuleSystemPromptPresetInstalled) only ever creates a missing preset - it
  // never detects or repairs stale preset text, so a content edit that forgets to bump the
  // matching savedName version would silently strand existing users on the old preset forever.
  // This hash must be updated (and the corresponding savedName suffix bumped) whenever a shipped
  // template's systemPrompt.content intentionally changes - see design.md "Preset naming".
  const EXPECTED_SYSTEM_PROMPT_CONTENT_HASH: Record<string, string> = {
    'zTracker-SceneTracker-1.0': 'cdecf934ae2a',
    'zTracker-PlotLog-1.0': '0ec04f04cf72',
    'zTracker-PlotSteer-1.0': '40a23137b36b',
  };

  test.each(['scene-tracker.json', 'plot-log.json', 'plot-steer.json'])(
    '%s system-prompt content hash matches its declared preset version',
    (fileName) => {
      const { systemPrompt } = loadTemplate(fileName);
      const savedName = systemPrompt?.savedName ?? '';
      const content = systemPrompt?.content ?? '';
      const actualHash = createHash('sha256').update(content).digest('hex').slice(0, 12);

      expect(EXPECTED_SYSTEM_PROMPT_CONTENT_HASH[savedName]).toBe(actualHash);
    },
  );

  test('plot-steer.json chained entry goes dormant (not an error) when imported before Plot Log', () => {
    // Simulates a user importing the files in the wrong order: Plot Steer ends up with an
    // earlier generation.order than Plot Log, per createImportedTrackerModule's append-only
    // ordering, so the chained entry must be dormant rather than throwing or silently resolving
    // as eligible - see the "Ordered import for chained templates" spec requirement.
    const plotSteer = createImportedTrackerModule(loadTemplate('plot-steer.json'), []);
    const plotLog = createImportedTrackerModule(loadTemplate('plot-log.json'), [plotSteer]);

    const resolved = resolveTrackerModuleIncludeEntries(plotSteer, [plotSteer, plotLog]);
    const chainedEntry = resolved.find((entry) => !entry.isSelf);
    expect(chainedEntry?.eligible).toBe(false);
    // The stored entry itself must survive untouched, per the existing dormancy contract.
    expect(chainedEntry?.entry).toEqual({ target: 'plot-log', count: 3 });
  });
});
