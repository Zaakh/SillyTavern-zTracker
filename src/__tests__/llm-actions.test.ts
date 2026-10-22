/**
 * @jest-environment node
 */
import { describe, expect, jest, test } from '@jest/globals';
import { resolveInstruction, runLlmAction, saveOverride } from '../llm-actions.js';
import type { LlmAction } from '../llm-actions.js';

function makeStore(overrides?: Record<string, string>) {
  const settings: { promptOverrides?: Record<string, string> } = overrides ? { promptOverrides: overrides } : {};
  return { settings, saveSettings: jest.fn(), getSettings: () => settings };
}

describe('prompt overrides', () => {
  test('resolveInstruction prefers the override and falls back to the default', () => {
    const store = makeStore({ a: 'mine' });
    expect(resolveInstruction(store, 'a', 'default')).toBe('mine');
    expect(resolveInstruction(store, 'b', 'default')).toBe('default');
    expect(resolveInstruction(makeStore(), 'a', 'default')).toBe('default');
  });

  test('saveOverride stores an edit and saves once', () => {
    const store = makeStore();
    saveOverride(store, 'a', 'default', 'mine');
    expect(store.settings.promptOverrides).toEqual({ a: 'mine' });
    expect(store.saveSettings).toHaveBeenCalledTimes(1);
  });

  test('editing back to the default removes the override', () => {
    const store = makeStore({ a: 'mine' });
    saveOverride(store, 'a', 'default', 'default');
    expect(store.settings.promptOverrides).toEqual({});
    expect(store.saveSettings).toHaveBeenCalledTimes(1);
  });

  test('an empty or whitespace prompt counts as the default', () => {
    const store = makeStore({ a: 'mine' });
    saveOverride(store, 'a', 'default', '   ');
    expect(store.settings.promptOverrides).toEqual({});
    expect(resolveInstruction(store, 'a', 'default')).toBe('default');
  });

  test('an unchanged prompt writes nothing', () => {
    const store = makeStore({ a: 'mine' });
    saveOverride(store, 'a', 'default', 'mine');
    saveOverride(store, 'b', 'default', 'default');
    expect(store.saveSettings).not.toHaveBeenCalled();
  });

  test('ids are isolated from each other', () => {
    const store = makeStore({ a: 'one', b: 'two' });
    saveOverride(store, 'a', 'default', 'default');
    expect(store.settings.promptOverrides).toEqual({ b: 'two' });
  });
});

describe('runLlmAction', () => {
  const action: LlmAction<string, string> = {
    id: 'x',
    defaultInstruction: 'DEFAULT',
    buildMessages: (instruction, input) => [
      { role: 'system', content: instruction },
      { role: 'user', content: input },
    ],
    parse: (reply) => reply.trim().toUpperCase(),
  };

  test('sends the instruction and input and parses the reply', async () => {
    const request = jest.fn<any>().mockResolvedValue(' hi ');
    await expect(runLlmAction(action, { instruction: 'MINE', input: 'text', request })).resolves.toBe('HI');
    expect(request.mock.calls[0][0]).toEqual([
      { role: 'system', content: 'MINE' },
      { role: 'user', content: 'text' },
    ]);
  });

  test('an empty instruction sends the default', async () => {
    const request = jest.fn<any>().mockResolvedValue('ok');
    await runLlmAction(action, { instruction: '  ', input: 'text', request });
    expect((request.mock.calls[0] as any)[0][0].content).toBe('DEFAULT');
  });

  test('an already aborted signal sends nothing', async () => {
    const request = jest.fn<any>();
    const controller = new AbortController();
    controller.abort();
    await expect(runLlmAction(action, { instruction: '', input: 't', request, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).not.toHaveBeenCalled();
  });

  test('a reply that arrives after abort is discarded', async () => {
    const controller = new AbortController();
    const request = jest.fn<any>(async () => {
      controller.abort();
      return 'late';
    });
    await expect(runLlmAction(action, { instruction: '', input: 't', request, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
