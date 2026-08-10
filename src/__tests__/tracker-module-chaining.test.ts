import type { ExtensionSettings, TrackerModule } from '../config.js';
import { createDefaultTrackerModule, getSettingsForTrackerModule } from '../config.js';
import { CHAT_MESSAGE_MODULES_KEY, CHAT_MESSAGE_SCHEMA_VALUE_KEY, normalizeTrackerGenerationConversationRoles } from '../tracker.js';
import { EXTENSION_KEY } from '../extension-metadata.js';
import {
  applyTrackerModuleIncludeList,
  getEligibleChainableModules,
  isChainedIncludeTargetEligible,
  resolveTrackerModuleIncludeEntries,
} from '../tracker-module-chaining.js';

// Builds a message carrying stored tracker data for one or more Modules, matching the
// `message.extra.zTracker.byId[moduleId]` storage shape read by `getTrackerModuleRecord`.
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

  test('reads a chained module snapshot from full chat history, independent of the prompt window', () => {
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    scene.injection.snapshotHeader = 'Scene Tracker:';
    const agenda = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 1 });
    agenda.generation.includeModules = [
      { target: 'self', count: 0 },
      { target: 'scene', count: 1 },
    ];
    const rawSettings = buildSettings([scene, agenda]);
    const agendaSettings = getSettingsForTrackerModule(rawSettings, 'agenda');

    // The chained module already generated its snapshot on the current message (index 0, earlier
    // generation order) - the prompt window (`messages`) does not need to contain that message at all.
    const chat = [buildMessageWithModuleTrackers({ scene: { place: 'Bridge' }, agenda: { goal: 'Find exit' } })];
    const messages = [{ content: 'current', role: 'user' }];

    const result = applyTrackerModuleIncludeList(messages as any, agenda, agendaSettings, { chat: chat as any, messageId: 0 }) as any[];

    expect(result).toHaveLength(2);
    expect(result[0].content).toContain('Scene Tracker:');
    expect(result[0].content).toContain('Bridge');
    expect(result[0].content).not.toContain('Find exit');
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

  test('a non-zero injection.includeLastXMessages does not resurrect a self entry explicitly set to 0', () => {
    // Confirms isolation in the other direction from the "independent of injection" test above:
    // downstream generate_interceptor embedding config must have zero influence here.
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    scene.injection.includeLastXMessages = 5; // would matter for generate_interceptor, not here
    scene.generation.includeModules = [{ target: 'self', count: 0 }];
    const rawSettings = buildSettings([scene]);
    const sceneSettings = getSettingsForTrackerModule(rawSettings, 'scene');

    const messages = [
      buildMessageWithModuleTrackers({ scene: { place: 'Bridge' } }),
      { content: 'current', role: 'user' },
    ];

    const result = applyTrackerModuleIncludeList(messages as any, scene, sceneSettings) as any[];

    expect(result).toHaveLength(2);
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

    const chat = [buildMessageWithModuleTrackers({ scene: { place: 'Bridge' }, agenda: { goal: 'Find exit' } })];
    const messages = [{ content: 'current', role: 'user' }];

    const result = applyTrackerModuleIncludeList(messages as any, agenda, agendaSettings, { chat: chat as any, messageId: 0 }) as any[];

    expect(result).toHaveLength(1);
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

    const chat = [buildMessageWithModuleTrackers({ scene: { place: 'Bridge' }, agenda: { goal: 'Find exit' } })];
    const messages = [{ content: 'current', role: 'user' }];

    const result = applyTrackerModuleIncludeList(messages as any, agenda, agendaSettings, { chat: chat as any, messageId: 0 }) as any[];

    expect(result).toHaveLength(1);
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

    const chat = [buildMessageWithModuleTrackers({ scene: { place: 'Bridge' }, agenda: { goal: 'Find exit' } })];
    const messages = [{ content: 'current', role: 'user' }];

    const result = applyTrackerModuleIncludeList(messages as any, agenda, agendaSettings, { chat: chat as any, messageId: 0 }) as any[];

    expect(result).toHaveLength(1);
  });

  test('a chained entry with no chat context supplied contributes nothing (graceful degradation)', () => {
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    const agenda = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 1 });
    agenda.generation.includeModules = [
      { target: 'self', count: 0 },
      { target: 'scene', count: 1 },
    ];
    const rawSettings = buildSettings([scene, agenda]);
    const agendaSettings = getSettingsForTrackerModule(rawSettings, 'agenda');

    const messages = [{ content: 'current', role: 'user' }];

    const result = applyTrackerModuleIncludeList(messages as any, agenda, agendaSettings) as any[];

    expect(result).toHaveLength(1);
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

    const chat = [buildMessageWithModuleTrackers({ scene: { place: 'Bridge' } })];
    const messages = [{ content: 'current', role: 'user' }];

    const result = applyTrackerModuleIncludeList(messages as any, agenda, agendaSettings, { chat: chat as any, messageId: 0 }) as any[];

    // Scene's own injection uses embedAsCharacter, so the pulled-in snapshot uses a `name` field
    // and its own "Scene Tracker" label - not Agenda's header/formatting.
    expect(result[0].name).toBe('Scene Tracker');
    expect(result[0].content).not.toContain('Agenda Tracker:');
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

    // Chained snapshots (scene, inventory) are read from full chat history; self stays bound to
    // the windowed `messages`, interleaved inline as before.
    const chat = [buildMessageWithModuleTrackers({ scene: { place: 'Bridge' }, inventory: { item: 'Flashlight' } })];
    const messages = [
      buildMessageWithModuleTrackers({ agenda: { goal: 'Find exit' } }),
      { content: 'current', role: 'user' },
    ];

    const result = applyTrackerModuleIncludeList(messages as any, agenda, agendaSettings, { chat: chat as any, messageId: 0 }) as any[];

    // Chained entries are prepended ahead of the window in include-list order (scene, inventory);
    // self still interleaves inline right after the windowed message that owns it, so the
    // windowed message stays in place and self's snapshot lands directly after it.
    expect(result).toHaveLength(5);
    expect(result[0].content).toContain('Scene Tracker:');
    expect(result[1].content).toContain('Inventory Tracker:');
    expect(result[3].content).toContain('Agenda Tracker:');
    expect(result[4].content).toBe('current');
  });

  test('self-history keeps its embedded-snapshot role protection even with active chained entries', () => {
    // Regression guard for the marker-loss bug that existed when chaining re-cloned `messages`
    // once per active entry: self is now the only remaining includeZTrackerMessages call site
    // per invocation, so its embedded-snapshot marker can no longer be destroyed by a later clone.
    const scene = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
    const agenda = createDefaultTrackerModule({ id: 'agenda', name: 'Agenda', order: 1 });
    agenda.injection.embedRole = 'user';
    agenda.generation.conversationRoleMode = 'all_assistant';
    agenda.generation.includeModules = [
      { target: 'self', count: 1 },
      { target: 'scene', count: 1 },
    ];
    const rawSettings = buildSettings([scene, agenda]);
    const agendaSettings = getSettingsForTrackerModule(rawSettings, 'agenda');

    const chat = [buildMessageWithModuleTrackers({ scene: { place: 'Bridge' } })];
    const messages = [
      buildMessageWithModuleTrackers({ agenda: { goal: 'Find exit' } }),
      { content: 'current', role: 'user' },
    ];

    const withIncludeList = applyTrackerModuleIncludeList(
      messages as any,
      agenda,
      agendaSettings,
      { chat: chat as any, messageId: 0 },
    ) as any[];
    const normalized = normalizeTrackerGenerationConversationRoles(withIncludeList, agendaSettings) as any[];

    const selfSnapshot = normalized.find((message) => typeof message.content === 'string' && message.content.includes('Find exit'));
    expect(selfSnapshot?.role).toBe('user');
    const currentTurn = normalized.find((message) => message.content === 'current');
    expect(currentTurn?.role).toBe('assistant');
  });
});
