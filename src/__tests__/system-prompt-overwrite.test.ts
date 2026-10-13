/**
 * @jest-environment jsdom
 */

// Covers overwriteModuleSystemPromptPreset (openspec: add-llm-schema-generation 4.1): an explicit
// save replaces an existing preset or creates a new one, then restores the user's previously
// selected global system prompt and enabled state, which the host's savePreset changes.
import { jest } from '@jest/globals';
import { ensureModuleSystemPromptPresetInstalled, overwriteModuleSystemPromptPreset } from '../system-prompt.js';

const module = { systemPrompt: { mode: 'saved' as const, savedName: 'zTracker-x-generated', content: 'new text' } };

/** Fake host: savePreset selects the saved preset and force-enables system prompts, like SillyTavern 1.18. */
function makeHost(existing: boolean, selected = 'MyPrompt', enabled = false) {
  document.body.innerHTML = '<input id="sysprompt_enabled" type="checkbox">';
  const checkbox = document.getElementById('sysprompt_enabled') as HTMLInputElement;
  const sysprompt = { name: selected, enabled };
  checkbox.checked = enabled;
  checkbox.addEventListener('input', () => {
    sysprompt.enabled = checkbox.checked;
  });
  const presets = new Map<string, string>(existing ? [[module.systemPrompt.savedName, 'old text']] : []);
  const manager = {
    getCompletionPresetByName: (name?: string) => (name && presets.has(name) ? { name, content: presets.get(name)! } : undefined),
    getPresetList: () => ({ presets: [], preset_names: [...presets.keys()] }),
    savePreset: jest.fn(async (name: string, settings: { content: string }) => {
      presets.set(name, settings.content);
      sysprompt.name = name;
      checkbox.checked = true;
      sysprompt.enabled = true;
    }),
    findPreset: (name: string) => name,
    selectPreset: jest.fn((value: unknown) => {
      sysprompt.name = String(value);
    }),
  };
  return { sysprompt, manager, presets, context: { getPresetManager: () => manager, powerUserSettings: { sysprompt } } };
}

describe('overwriteModuleSystemPromptPreset', () => {
  test('replaces an existing preset and restores the previous selection and enabled state', async () => {
    const host = makeHost(true);

    await expect(overwriteModuleSystemPromptPreset(module, host.context)).resolves.toBe(true);

    expect(host.presets.get('zTracker-x-generated')).toBe('new text');
    expect(host.sysprompt).toEqual({ name: 'MyPrompt', enabled: false });
  });

  test('creates a missing preset', async () => {
    const host = makeHost(false, 'MyPrompt', true);

    await overwriteModuleSystemPromptPreset(module, host.context);

    expect(host.presets.get('zTracker-x-generated')).toBe('new text');
    expect(host.sysprompt).toEqual({ name: 'MyPrompt', enabled: true });
  });

  test('automatic install still does not overwrite an existing preset', async () => {
    const host = makeHost(true);

    await expect(ensureModuleSystemPromptPresetInstalled(module, host.context)).resolves.toBe(false);

    expect(host.manager.savePreset).not.toHaveBeenCalled();
    expect(host.presets.get('zTracker-x-generated')).toBe('old text');
  });

  test('does nothing for empty content', async () => {
    const host = makeHost(false);

    await expect(overwriteModuleSystemPromptPreset({ systemPrompt: { ...module.systemPrompt, content: ' ' } }, host.context)).resolves.toBe(false);

    expect(host.manager.savePreset).not.toHaveBeenCalled();
  });
});
