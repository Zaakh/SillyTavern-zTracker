import type { ExtensionSettings, TrackerModule } from '../config.js';
import { createDefaultTrackerModule, getSettingsForTrackerModule } from '../config.js';
import { CHAT_MESSAGE_MODULES_KEY, CHAT_MESSAGE_SCHEMA_VALUE_KEY } from '../tracker.js';
import { EXTENSION_KEY } from '../extension-metadata.js';
import {
  applyTrackerModuleIncludeList,
  getEligibleChainableModules,
  isChainedIncludeTargetEligible,
  resolveTrackerModuleIncludeEntries,
} from '../tracker-module-chaining.js';

// Builds a message carrying stored tracker data for one or more Modules, matching the
// `message.extra.zTracker.byId[moduleId]` storage shape read by includeZTrackerMessages.
function buildMessageWithModuleTrackers(byModuleId: Record<string, Record<string, unknown>>) {
  return {
    content: 'base',
    role: 'assistant',
    extra: {
      [EXTENSION_KEY]: {
        [CHAT_MESSAGE_MODULES_KEY]: Object.fromEntries(
          Object.entries(byModuleId).map(([moduleId, value]) => [moduleId, { [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: value }]),
        ),
      },
    },
  };
}

describe('resolveTrackerModuleIncludeEntries / isChainedIncludeTargetEligible', () => {
  test('self entries are always eligible', () => {
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });

    expect(isChainedIncludeTargetEligible(scene, undefined)).toBe(false);
    const resolved = resolveTrackerModuleIncludeEntries(scene, [scene]);
    expect(resolved).toEqual([{ entry: { target: 'self', count: 1 }, isSelf: true, eligible: true }]);
  });

  test('a chained entry is eligible only when its target is enabled and strictly earlier in order', () => {
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    const agenda = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 1 });
    agenda.generation.includeModules = [
      { target: 'self', count: 1 },
      { target: 'scene', count: 2 },
    ];

    const resolvedWhileEarlier = resolveTrackerModuleIncludeEntries(agenda, [scene, agenda]);
    expect(resolvedWhileEarlier[1]).toEqual({
      entry: { target: 'scene', count: 2 },
      isSelf: false,
      targetModule: scene,
      eligible: true,
    });

    // Reordering scene to be no longer earlier than agenda makes the same stored entry dormant.
    scene.order = 2;
    const resolvedAfterReorder = resolveTrackerModuleIncludeEntries(agenda, [scene, agenda]);
    expect(resolvedAfterReorder[1].eligible).toBe(false);
    expect(resolvedAfterReorder[1].entry).toEqual({ target: 'scene', count: 2 }); // stored entry is untouched

    // Disabling the (now-earlier-again) target also makes the entry dormant.
    scene.order = 0;
    scene.enabled = false;
    const resolvedAfterDisable = resolveTrackerModuleIncludeEntries(agenda, [scene, agenda]);
    expect(resolvedAfterDisable[1].eligible).toBe(false);

    // Re-enabling restores it.
    scene.enabled = true;
    const resolvedAfterReenable = resolveTrackerModuleIncludeEntries(agenda, [scene, agenda]);
    expect(resolvedAfterReenable[1].eligible).toBe(true);
  });

  test('a chained entry referencing a no-longer-existing module is ineligible', () => {
    const agenda = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 1 });
    agenda.generation.includeModules = [{ target: 'self', count: 1 }, { target: 'deleted', count: 1 }];

    const resolved = resolveTrackerModuleIncludeEntries(agenda, [agenda]);
    expect(resolved[1]).toEqual({ entry: { target: 'deleted', count: 1 }, isSelf: false, targetModule: undefined, eligible: false });
  });
});

describe('getEligibleChainableModules', () => {
  test('excludes the source module, disabled modules, and later-or-equal-order modules', () => {
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    const disabled = createDefaultTrackerModule({ id: 'disabled', name: 'Disabled', order: 1 });
    disabled.enabled = false;
    const agenda = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 2 });
    const inventory = createDefaultTrackerModule({ id: 'inventory', name: 'Inventory', order: 3 });

    const eligible = getEligibleChainableModules(agenda, [scene, disabled, agenda, inventory]);

    expect(eligible.map((module) => module.id)).toEqual(['scene']);
  });
});

describe('applyTrackerModuleIncludeList', () => {
  function buildSettings(modules: TrackerModule[]): ExtensionSettings {
    return { version: '0', formatVersion: 'test', modules, debugLogging: false };
  }

  test('reads a chained module snapshot into the source module generation context', () => {
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    scene.injection.snapshotHeader = 'Scene Tracker:';
    const agenda = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 1 });
    agenda.generation.includeModules = [
      { target: 'self', count: 0 },
      { target: 'scene', count: 1 },
    ];
    const rawSettings = buildSettings([scene, agenda]);
    const agendaSettings = getSettingsForTrackerModule(rawSettings, 'agenda');

    const messages = [
      buildMessageWithModuleTrackers({ scene: { place: 'Bridge' }, agenda: { goal: 'Find exit' } }),
      { content: 'current', role: 'user' },
    ];

    const result = applyTrackerModuleIncludeList(messages as any, agenda, agendaSettings) as any[];

    expect(result).toHaveLength(3);
    expect(result[1].content).toContain('Scene Tracker:');
    expect(result[1].content).toContain('Bridge');
    expect(result[1].content).not.toContain('Find exit');
  });

  test('self entry count is independent of injection.includeLastXMessages', () => {
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    scene.injection.includeLastXMessages = 0; // downstream injection disabled
    scene.generation.includeModules = [{ target: 'self', count: 1 }]; // self-history still active
    const rawSettings = buildSettings([scene]);
    const sceneSettings = getSettingsForTrackerModule(rawSettings, 'scene');

    const messages = [
      buildMessageWithModuleTrackers({ scene: { place: 'Bridge' } }),
      { content: 'current', role: 'user' },
    ];

    const result = applyTrackerModuleIncludeList(messages as any, scene, sceneSettings) as any[];

    expect(result).toHaveLength(3);
    expect(result[1].content).toContain('Bridge');
  });

  test('a zero-count entry (self or chained) contributes nothing', () => {
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    const agenda = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 1 });
    agenda.generation.includeModules = [
      { target: 'self', count: 0 },
      { target: 'scene', count: 0 },
    ];
    const rawSettings = buildSettings([scene, agenda]);
    const agendaSettings = getSettingsForTrackerModule(rawSettings, 'agenda');

    const messages = [
      buildMessageWithModuleTrackers({ scene: { place: 'Bridge' }, agenda: { goal: 'Find exit' } }),
      { content: 'current', role: 'user' },
    ];

    const result = applyTrackerModuleIncludeList(messages as any, agenda, agendaSettings) as any[];

    expect(result).toHaveLength(2);
  });

  test('a dormant chained entry (target reordered past the source) contributes nothing', () => {
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 2 }); // no longer earlier than agenda
    const agenda = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 1 });
    agenda.generation.includeModules = [
      { target: 'self', count: 0 },
      { target: 'scene', count: 1 },
    ];
    const rawSettings = buildSettings([scene, agenda]);
    const agendaSettings = getSettingsForTrackerModule(rawSettings, 'agenda');

    const messages = [
      buildMessageWithModuleTrackers({ scene: { place: 'Bridge' }, agenda: { goal: 'Find exit' } }),
      { content: 'current', role: 'user' },
    ];

    const result = applyTrackerModuleIncludeList(messages as any, agenda, agendaSettings) as any[];

    expect(result).toHaveLength(2);
    // The stored entry itself is untouched by the dormant read.
    expect(agenda.generation.includeModules).toEqual([{ target: 'self', count: 0 }, { target: 'scene', count: 1 }]);
  });

  test('a dormant chained entry (disabled target) contributes nothing', () => {
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    scene.enabled = false;
    const agenda = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 1 });
    agenda.generation.includeModules = [
      { target: 'self', count: 0 },
      { target: 'scene', count: 1 },
    ];
    const rawSettings = buildSettings([scene, agenda]);
    const agendaSettings = getSettingsForTrackerModule(rawSettings, 'agenda');

    const messages = [
      buildMessageWithModuleTrackers({ scene: { place: 'Bridge' }, agenda: { goal: 'Find exit' } }),
      { content: 'current', role: 'user' },
    ];

    const result = applyTrackerModuleIncludeList(messages as any, agenda, agendaSettings) as any[];

    expect(result).toHaveLength(2);
  });

  test('chained snapshot formatting is sourced from the target module, not the source module', () => {
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    scene.injection.embedAsCharacter = true;
    scene.injection.snapshotHeader = 'Scene Tracker:';
    const agenda = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 1 });
    agenda.injection.embedAsCharacter = false;
    agenda.injection.snapshotHeader = 'Agenda Tracker:';
    agenda.generation.includeModules = [
      { target: 'self', count: 0 },
      { target: 'scene', count: 1 },
    ];
    const rawSettings = buildSettings([scene, agenda]);
    const agendaSettings = getSettingsForTrackerModule(rawSettings, 'agenda');

    const messages = [
      buildMessageWithModuleTrackers({ scene: { place: 'Bridge' } }),
      { content: 'current', role: 'user' },
    ];

    const result = applyTrackerModuleIncludeList(messages as any, agenda, agendaSettings) as any[];

    // Scene's own injection uses embedAsCharacter, so the pulled-in snapshot uses a `name` field
    // and its own "Scene Tracker" label - not Agenda's header/formatting.
    expect(result[1].name).toBe('Scene Tracker');
    expect(result[1].content).not.toContain('Agenda Tracker:');
  });

  test('composes self and multiple chained entries in include-list order', () => {
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    scene.injection.snapshotHeader = 'Scene Tracker:';
    const inventory = createDefaultTrackerModule({ id: 'inventory', name: 'Inventory', order: 1 });
    inventory.injection.snapshotHeader = 'Inventory Tracker:';
    const agenda = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 2 });
    agenda.injection.snapshotHeader = 'Agenda Tracker:';
    agenda.generation.includeModules = [
      { target: 'scene', count: 1 },
      { target: 'self', count: 1 },
      { target: 'inventory', count: 1 },
    ];
    const rawSettings = buildSettings([scene, inventory, agenda]);
    const agendaSettings = getSettingsForTrackerModule(rawSettings, 'agenda');

    const messages = [
      buildMessageWithModuleTrackers({
        scene: { place: 'Bridge' },
        agenda: { goal: 'Find exit' },
        inventory: { item: 'Flashlight' },
      }),
      { content: 'current', role: 'user' },
    ];

    const result = applyTrackerModuleIncludeList(messages as any, agenda, agendaSettings) as any[];

    // Each entry re-scans from the start of the array, so all three land right after the source message
    // in include-list order: scene, self (agenda), inventory.
    expect(result).toHaveLength(5);
    expect(result[1].content).toContain('Scene Tracker:');
    expect(result[2].content).toContain('Agenda Tracker:');
    expect(result[3].content).toContain('Inventory Tracker:');
  });
});
