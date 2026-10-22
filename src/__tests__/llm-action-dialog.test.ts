/**
 * @jest-environment jsdom
 */
import { describe, expect, jest, test } from '@jest/globals';
import { POPUP_RESULT } from 'sillytavern-utils-lib/types/popup';
import { buildLlmActionDialog } from '../ui/llm-action-dialog.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(options: { overrides?: Record<string, string>; parts?: number; run?: any; apply?: any } = {}) {
  const settings: { promptOverrides: Record<string, string> } = { promptOverrides: { ...options.overrides } };
  const store = { getSettings: () => settings, saveSettings: jest.fn() };
  const parts = Array.from({ length: options.parts ?? 1 }, (_, i) => ({ id: `p${i}`, label: `Part ${i}`, defaultInstruction: `default ${i}` }));
  const run = options.run ?? jest.fn(async (_instructions: string[]) => parts.map((_, i) => `result ${i}`));
  const apply = options.apply ?? jest.fn();
  const dialog = buildLlmActionDialog({ title: 't', parts, store, run, apply });
  const q = <T extends HTMLElement>(selector: string, index = 0) => dialog.element.querySelectorAll(selector)[index] as T;
  return {
    dialog, settings, store, run, apply,
    instruction: (i = 0) => q<HTMLTextAreaElement>('.ztracker-llm-dialog-instruction', i),
    preview: (i = 0) => q<HTMLTextAreaElement>('.ztracker-llm-dialog-preview', i),
    generate: () => q<HTMLButtonElement>('.ztracker-llm-dialog-generate'),
    stop: () => q<HTMLButtonElement>('.ztracker-llm-dialog-stop'),
    reset: (i = 0) => q<HTMLButtonElement>('.ztracker-llm-dialog-reset', i),
    marker: (i = 0) => q<HTMLElement>('.ztracker-llm-dialog-edited', i),
    error: () => q('.ztracker-llm-dialog-error').textContent,
    close: (result: number) => dialog.onClosing({ result }),
  };
}

describe('LLM action dialog', () => {
  test('opening sends nothing', () => {
    const t = setup();
    expect(t.run).not.toHaveBeenCalled();
  });

  test('Apply writes the edited preview', async () => {
    const t = setup();
    t.generate().click();
    await flush();
    t.preview().value = 'edited';
    await expect(t.close(POPUP_RESULT.AFFIRMATIVE)).resolves.toBe(true);
    expect(t.apply).toHaveBeenCalledWith(['edited']);
  });

  test('Cancel writes nothing', async () => {
    const t = setup();
    t.generate().click();
    await flush();
    await expect(t.close(POPUP_RESULT.CANCELLED)).resolves.toBe(true);
    expect(t.apply).not.toHaveBeenCalled();
  });

  test('Apply without a result keeps the dialog open', async () => {
    const t = setup();
    await expect(t.close(POPUP_RESULT.AFFIRMATIVE)).resolves.toBe(false);
    expect(t.error()).toContain('Generate a result first');
    expect(t.apply).not.toHaveBeenCalled();
  });

  test('Apply with an empty part keeps the dialog open', async () => {
    const t = setup({ parts: 2 });
    t.generate().click();
    await flush();
    t.preview(1).value = '  ';
    await expect(t.close(POPUP_RESULT.AFFIRMATIVE)).resolves.toBe(false);
    expect(t.apply).not.toHaveBeenCalled();
  });

  test('a throwing apply keeps the dialog open with the preview intact and saves no override', async () => {
    const t = setup({ apply: jest.fn(async () => { throw new Error('save failed'); }) });
    t.generate().click();
    await flush();
    t.instruction().value = 'mine';
    await expect(t.close(POPUP_RESULT.AFFIRMATIVE)).resolves.toBe(false);
    expect(t.error()).toContain('save failed');
    expect(t.preview().value).toBe('result 0');
    expect(t.store.saveSettings).not.toHaveBeenCalled();
  });

  test('a failed request shows the error and keeps the previous preview', async () => {
    const run = jest.fn<any>().mockResolvedValueOnce(['first']).mockRejectedValueOnce(new Error('offline'));
    const t = setup({ run });
    t.generate().click();
    await flush();
    expect(t.generate().textContent).toBe('Regenerate');
    t.generate().click();
    await flush();
    expect(t.error()).toContain('offline');
    expect(t.preview().value).toBe('first');
  });

  test('Regenerate sends the edited prompt and replaces the preview', async () => {
    const t = setup();
    t.generate().click();
    await flush();
    t.instruction().value = 'edited prompt';
    t.generate().click();
    await flush();
    expect(t.run.mock.calls[1][0]).toEqual(['edited prompt']);
  });

  test('running disables Generate, blocks a second request and Stop leaves the preview unchanged', async () => {
    let signal!: AbortSignal;
    const run = jest.fn((_i: string[], s: AbortSignal) => new Promise<string[]>((_, reject) => {
      signal = s;
      s.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
    }));
    const t = setup({ run });
    t.preview().value = 'keep';
    t.generate().click();
    expect(t.generate().disabled).toBe(true);
    t.generate().click();
    expect(run).toHaveBeenCalledTimes(1);
    t.stop().click();
    await flush();
    expect(signal.aborted).toBe(true);
    expect(t.preview().value).toBe('keep');
    expect(t.error()).toBe('');
    expect(t.generate().disabled).toBe(false);
  });

  test('closing during a run aborts it and never applies the late reply', async () => {
    let signal!: AbortSignal;
    let finish!: (value: string[]) => void;
    const run = jest.fn((_i: string[], s: AbortSignal) => new Promise<string[]>((resolve) => { signal = s; finish = resolve; }));
    const t = setup({ run });
    t.generate().click();
    await t.close(POPUP_RESULT.CANCELLED);
    expect(signal.aborted).toBe(true);
    finish(['late']);
    await flush();
    expect(t.preview().value).toBe('');
    expect(t.apply).not.toHaveBeenCalled();
  });

  test('closing with an emptied prompt drops the override', async () => {
    const t = setup({ overrides: { p0: 'mine' } });
    t.instruction().value = '';
    await t.close(POPUP_RESULT.CANCELLED);
    expect(t.settings.promptOverrides).toEqual({});
  });
});

describe('LLM action dialog prompt persistence', () => {
  test('an active override is loaded and marked edited', () => {
    const t = setup({ overrides: { p0: 'mine' } });
    expect(t.instruction().value).toBe('mine');
    expect(t.marker().hidden).toBe(false);
  });

  test('no override shows the default and no marker', () => {
    const t = setup();
    expect(t.instruction().value).toBe('default 0');
    expect(t.marker().hidden).toBe(true);
  });

  test('Cancel after an edit keeps the override', async () => {
    const t = setup();
    t.instruction().value = 'mine';
    await t.close(POPUP_RESULT.CANCELLED);
    expect(t.settings.promptOverrides).toEqual({ p0: 'mine' });
  });

  test('Reset then close drops the override and leaves the preview alone', async () => {
    const t = setup({ overrides: { p0: 'mine' } });
    t.generate().click();
    await flush();
    t.reset().click();
    expect(t.instruction().value).toBe('default 0');
    expect(t.marker().hidden).toBe(true);
    expect(t.preview().value).toBe('result 0');
    await t.close(POPUP_RESULT.CANCELLED);
    expect(t.settings.promptOverrides).toEqual({});
  });

  test('an unchanged prompt writes nothing', async () => {
    const t = setup({ overrides: { p0: 'mine' } });
    await t.close(POPUP_RESULT.CANCELLED);
    expect(t.store.saveSettings).not.toHaveBeenCalled();
  });

  test('two parts keep one override each; resetting one leaves the other', async () => {
    const t = setup({ parts: 2, overrides: { p0: 'a', p1: 'b' } });
    t.reset(0).click();
    await t.close(POPUP_RESULT.CANCELLED);
    expect(t.settings.promptOverrides).toEqual({ p1: 'b' });
  });
});
