/**
 * @jest-environment jsdom
 */

// Component tests for the Design brief / Generate schema (Quick + Advanced) / Generate prompts
// (Advanced-only) controls and their hook (openspec: add-llm-schema-generation 5.4,
// add-llm-action-dialog 4.2), rendered through a small harness that mirrors how Settings.tsx wires
// them: real hook + real controls + real dialog, scripted active-connection request and popup.
import { jest } from '@jest/globals';
import React, { act, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { POPUP_RESULT } from 'sillytavern-utils-lib/types/popup';

jest.unstable_mockModule('sillytavern-utils-lib/components/react', () => ({
  STButton: ({ title, disabled, onClick, children }: any) => React.createElement('button', { type: 'button', title, disabled, onClick }, children),
  STTextarea: ({ value, onChange, placeholder }: any) => React.createElement('textarea', { value, onChange, placeholder }),
}));

const { createDefaultTrackerModule, PromptEngineeringMode } = await import('../config.js');
const { SchemaGenerationControls } = await import('../components/settings/SchemaGenerationControls.js');
const { useSchemaGeneration } = await import('../components/settings/useSchemaGeneration.js');

const CLEAN = JSON.stringify({ type: 'object', description: 'T', properties: { a: { type: 'string', description: 'A' } }, required: ['a'] });
// $ref is reported as a warning by the dialect lint, which triggers a repair round.
const WARNING = JSON.stringify({ type: 'object', description: 'T', properties: { a: { $ref: '#/$defs/x' } }, required: ['a'] });
const KEEP = '{"keep":true}';

type Request = (messages: any[], override?: any, signal?: AbortSignal) => Promise<string>;
type HarnessProps = {
  request: Request;
  initial?: { brief?: string; schemaText?: string };
  modules?: any[];
  applyPrompts?: () => Promise<void>;
};

describe('schema generation controls', () => {
  let root: Root | undefined;
  let state: { schemaText: string; module: any; applied: any[]; overrides: Record<string, string>; saveSettings: jest.Mock };
  let popup: { form: HTMLElement; options: any } | undefined;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="root"></div>';
    popup = undefined;
    // The popup stub keeps the built dialog so tests can drive it and then close it like the host would.
    (globalThis as any).SillyTavern = {
      getContext: () => ({
        getPresetManager: () => null,
        callGenericPopup: async (form: HTMLElement, _type: unknown, _title: string, options: any) => {
          document.body.append(form);
          popup = { form, options };
        },
      }),
    };
    const overrides: Record<string, string> = {};
    state = { schemaText: '', module: undefined, applied: [], overrides, saveSettings: jest.fn() };
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
  });

  function isValidJson(text: string): boolean {
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  }

  function Harness(props: HarnessProps) {
    const [modules, setModules] = useState(
      props.modules ?? [{ ...createDefaultTrackerModule({ id: 'a', name: 'A' }), designBrief: props.initial?.brief ?? '' }],
    );
    const [selected, setSelected] = useState(0);
    const [schemaText, setSchemaText] = useState(props.initial?.schemaText ?? '');
    const module = modules[selected];
    state.module = module;
    state.schemaText = schemaText;
    const setBrief = (brief: string) => setModules((current) => current.map((m, i) => (i === selected ? { ...m, designBrief: brief } : m)));
    const generation = useSchemaGeneration({
      module,
      schemaPresetKey: 'default',
      schemaText,
      schemaDraftIsValid: isValidJson(schemaText),
      promptEngineeringMode: PromptEngineeringMode.JSON,
      grammarEnforcementEnabled: false,
      setSchemaText,
      applyGeneratedPrompts:
        props.applyPrompts ??
        (async (moduleId, result) => {
          state.applied.push({ moduleId, result });
        }),
      requestWithActiveConnection: props.request,
      overrideStore: { getSettings: () => ({ promptOverrides: state.overrides }), saveSettings: state.saveSettings },
      activeConnectionLabel: 'openai · gpt-x',
    });
    return React.createElement(
      'div',
      null,
      React.createElement('button', { 'data-testid': 'switch', onClick: () => setSelected(1) }),
      React.createElement(SchemaGenerationControls, {
        brief: generation.brief,
        onBriefChange: setBrief,
        activeConnectionLabel: 'openai · gpt-x',
        canGenerateSchema: generation.canGenerateSchema,
        canGeneratePrompts: generation.canGeneratePrompts,
        isRunning: generation.isRunning,
        replacesDraft: generation.replacesDraft,
        status: generation.status,
        onGenerateSchema: generation.generateSchema,
        onGenerateSchemaAdvanced: generation.generateSchemaAdvanced,
        onGeneratePromptsAdvanced: generation.generatePromptsAdvanced,
        onCancel: generation.cancel,
      }),
    );
  }

  function render(props: HarnessProps) {
    root = createRoot(document.getElementById('root')!);
    act(() => root!.render(React.createElement(Harness, props)));
  }

  const button = (startsWith: string) => [...document.querySelectorAll('button')].find((b) => b.title.startsWith(startsWith)) as HTMLButtonElement;
  const click = (el: Element) =>
    act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  const flush = () =>
    act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
  const inDialog = <T extends HTMLElement>(selector: string, index = 0) => popup!.form.querySelectorAll(selector)[index] as T;
  /** Presses Generate in the open dialog and waits for the reply. */
  const generateInDialog = async () => {
    await click(inDialog('.ztracker-llm-dialog-generate'));
    await flush();
  };
  /** Closes the open dialog the way the host popup does; resolves to whether it really closed. */
  const closeDialog = async (result: number) => {
    let closed = true;
    await act(async () => {
      closed = await popup!.options.onClosing({ result });
    });
    return closed;
  };

  test('tooltips state what each button produces, depends on and replaces; connection is named', () => {
    render({ request: jest.fn<Request>(), initial: { brief: 'x' } });

    expect(button('Generate schema:').title).toMatch(/Schema JSON.*Design brief.*fills the Schema JSON draft/);
    expect(button('Generate schema (advanced)').title).toMatch(/only when you press Apply/);
    expect(button('Generate prompts').title).toMatch(/Design brief.*Schema JSON draft.*Apply then replaces.*immediately/);
    expect(button('Generate schema:').textContent).toBe(' Generate schema');
    expect(document.body.textContent).toMatch(/global active connection \(openai · gpt-x\)/);
    for (const el of document.querySelectorAll('button')) expect(el.title).not.toMatch(/applies immediately \(not as a draft\)/);
  });

  test('Generate prompts offers no Quick button', () => {
    render({ request: jest.fn<Request>(), initial: { brief: 'x', schemaText: CLEAN } });

    expect([...document.querySelectorAll('button')].filter((b) => b.title.startsWith('Generate prompts'))).toHaveLength(1);
  });

  test('disabled states: empty brief; invalid draft for prompts', () => {
    render({ request: jest.fn<Request>() });
    expect(button('Generate schema:').disabled).toBe(true);
    expect(button('Generate schema (advanced)').disabled).toBe(true);
    expect(button('Generate prompts').disabled).toBe(true);
    act(() => root?.unmount());

    render({ request: jest.fn<Request>(), initial: { brief: 'x', schemaText: '{ nope' } });
    expect(button('Generate schema:').disabled).toBe(false);
    expect(button('Generate schema (advanced)').disabled).toBe(false);
    expect(button('Generate prompts').disabled).toBe(true);
  });

  test('Generate schema (Quick) fills only the draft and hints to generate HTML next', async () => {
    render({ request: jest.fn<Request>(async () => CLEAN), initial: { brief: 'weather' } });

    await click(button('Generate schema:'));
    await flush();

    expect(JSON.parse(state.schemaText)).toMatchObject({ type: 'object' });
    expect(state.applied).toEqual([]);
    expect(popup).toBeUndefined();
    expect(document.body.textContent).toMatch(/generate HTML next/);
  });

  test('Quick uses a saved schema instruction', async () => {
    state.overrides.schema = 'MY SCHEMA LEAD';
    const request = jest.fn<Request>(async () => CLEAN);
    render({ request, initial: { brief: 'weather' } });

    await click(button('Generate schema:'));
    await flush();

    expect(request.mock.calls[0][0][0].content.startsWith('MY SCHEMA LEAD')).toBe(true);
    expect(request.mock.calls[0][0][0].content).toMatch(/Rules:/);
  });

  test('Advanced schema sends nothing on open, previews, and changes the draft only on Apply', async () => {
    const request = jest.fn<Request>(async () => CLEAN);
    render({ request, initial: { brief: 'weather', schemaText: KEEP } });

    await click(button('Generate schema (advanced)'));
    expect(request).not.toHaveBeenCalled();
    await generateInDialog();
    expect(request).toHaveBeenCalledTimes(1);
    expect(inDialog<HTMLTextAreaElement>('.ztracker-llm-dialog-preview').value).toContain('"type": "object"');
    expect(state.schemaText).toBe(KEEP);

    expect(await closeDialog(POPUP_RESULT.AFFIRMATIVE)).toBe(true);
    await flush();
    expect(JSON.parse(state.schemaText)).toMatchObject({ type: 'object' });
    expect(document.body.textContent).toMatch(/generate HTML next/);
  });

  test('Advanced schema Cancel leaves the draft unchanged', async () => {
    render({ request: jest.fn<Request>(async () => CLEAN), initial: { brief: 'weather', schemaText: KEEP } });

    await click(button('Generate schema (advanced)'));
    await generateInDialog();
    await closeDialog(POPUP_RESULT.CANCELLED);

    expect(state.schemaText).toBe(KEEP);
  });

  test('Advanced schema: an edited prompt reaches the request and the dialog keeps the dialect rules out of the editor', async () => {
    const request = jest.fn<Request>(async () => CLEAN);
    render({ request, initial: { brief: 'weather' } });

    await click(button('Generate schema (advanced)'));
    const editor = inDialog<HTMLTextAreaElement>('.ztracker-llm-dialog-instruction');
    expect(editor.value).not.toMatch(/Rules:/);
    expect(popup!.form.textContent).toMatch(/Additional rules are added automatically/);
    editor.value = 'Custom lead.';
    await generateInDialog();

    expect(request.mock.calls[0][0][0].content.startsWith('Custom lead.')).toBe(true);
    expect(request.mock.calls[0][0][0].content).toMatch(/Rules:/);
    await closeDialog(POPUP_RESULT.CANCELLED);
    expect(state.overrides.schema).toBe('Custom lead.');
  });

  test('Advanced schema Apply rejects a preview that is not valid JSON and keeps the dialog open', async () => {
    render({ request: jest.fn<Request>(async () => CLEAN), initial: { brief: 'weather', schemaText: KEEP } });

    await click(button('Generate schema (advanced)'));
    await generateInDialog();
    inDialog<HTMLTextAreaElement>('.ztracker-llm-dialog-preview').value = '{ not json';

    expect(await closeDialog(POPUP_RESULT.AFFIRMATIVE)).toBe(false);
    expect(inDialog('.ztracker-llm-dialog-error').textContent).toMatch(/not valid JSON/);
    expect(state.schemaText).toBe(KEEP);
  });

  test('Generate prompts shows two parts, changes nothing before Apply, and applies by captured Module id', async () => {
    const replies = ['SYSTEM', 'BASE'];
    render({ request: jest.fn<Request>(async () => replies.shift()!), initial: { brief: 'weather', schemaText: CLEAN } });

    await click(button('Generate prompts'));
    expect(popup!.form.querySelectorAll('.ztracker-llm-dialog-instruction')).toHaveLength(2);
    await generateInDialog();
    expect(inDialog<HTMLTextAreaElement>('.ztracker-llm-dialog-preview', 0).value).toBe('SYSTEM');
    expect(inDialog<HTMLTextAreaElement>('.ztracker-llm-dialog-preview', 1).value).toBe('BASE');
    expect(state.applied).toEqual([]);

    inDialog<HTMLTextAreaElement>('.ztracker-llm-dialog-preview', 1).value = 'EDITED BASE';
    expect(await closeDialog(POPUP_RESULT.AFFIRMATIVE)).toBe(true);
    await flush();

    expect(state.applied).toEqual([{ moduleId: 'a', result: { systemPrompt: 'SYSTEM', prompt: 'EDITED BASE' } }]);
    expect(state.schemaText).toBe(CLEAN);
    expect(document.body.textContent).toMatch(/Prompts applied/);
  });

  test('Generate prompts Cancel after a result changes nothing', async () => {
    const replies = ['SYSTEM', 'BASE'];
    render({ request: jest.fn<Request>(async () => replies.shift()!), initial: { brief: 'weather', schemaText: CLEAN } });

    await click(button('Generate prompts'));
    await generateInDialog();
    await closeDialog(POPUP_RESULT.CANCELLED);

    expect(state.applied).toEqual([]);
  });

  test('Generate prompts edits only one part: one override, the other part stays default', async () => {
    const replies = ['SYSTEM', 'BASE'];
    render({ request: jest.fn<Request>(async () => replies.shift()!), initial: { brief: 'weather', schemaText: CLEAN } });

    await click(button('Generate prompts'));
    inDialog<HTMLTextAreaElement>('.ztracker-llm-dialog-instruction', 0).value = 'Own system lead.';
    await closeDialog(POPUP_RESULT.CANCELLED);

    expect(state.overrides).toEqual({ 'prompts-system': 'Own system lead.' });
  });

  test('overwrite notice sits beside Apply in the Generate prompts dialog for a Module with existing prompt text', async () => {
    const module = { ...createDefaultTrackerModule({ id: 'a' }), designBrief: 'x' };
    module.systemPrompt.content = 'existing';
    render({ request: jest.fn<Request>(), modules: [module], initial: { schemaText: CLEAN } });

    await click(button('Generate prompts'));

    expect(inDialog('.ztracker-llm-dialog-notice').textContent).toMatch(/Apply overwrites this Module’s prompt text and generated preset immediately/);
  });

  test('overwrite notices are inline and no confirm dialog is used', () => {
    const confirm = jest.fn();
    (globalThis as any).SillyTavern = { getContext: () => ({ getPresetManager: () => null, Popup: { show: { confirm } } }) };
    render({ request: jest.fn<Request>(), initial: { brief: 'x', schemaText: CLEAN } });

    expect(document.body.textContent).toMatch(/Generate schema \(Quick\) will replace the current Schema JSON draft/);
    expect(confirm).not.toHaveBeenCalled();
  });

  test('no overwrite notice when nothing would be replaced', () => {
    render({ request: jest.fn<Request>(), initial: { brief: 'x' } });

    expect(document.body.textContent).not.toMatch(/will replace|will overwrite/);
  });

  test('double click does not start a second request while running', async () => {
    let release!: (value: string) => void;
    const request = jest.fn<Request>(() => new Promise<string>((resolve) => (release = resolve)));
    render({ request, initial: { brief: 'x' } });

    await click(button('Generate schema:'));
    expect(button('Generate schema:').disabled).toBe(true);
    expect(button('Generate schema (advanced)').disabled).toBe(true);
    expect(button('Generate prompts').disabled).toBe(true);
    await click(button('Generate schema:'));
    expect(request).toHaveBeenCalledTimes(1);

    release(CLEAN);
    await flush();
  });

  test('cancel mid-repair sends no further request and leaves the draft unchanged', async () => {
    const request = jest.fn<Request>(async (_messages, _override, signal) => {
      if (request.mock.calls.length === 1) return WARNING;
      return new Promise<string>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
      });
    });
    render({ request, initial: { brief: 'x', schemaText: KEEP } });

    await click(button('Generate schema:'));
    await flush();
    expect(request).toHaveBeenCalledTimes(2);

    await click(button('Cancel'));
    await flush();

    expect(request).toHaveBeenCalledTimes(2);
    expect(state.schemaText).toBe(KEEP);
    expect(button('Generate schema:').disabled).toBe(false);
  });

  test('switching Module mid-run discards the result for both Modules', async () => {
    let release!: (value: string) => void;
    const request = jest.fn<Request>(() => new Promise<string>((resolve) => (release = resolve)));
    const modules = [
      { ...createDefaultTrackerModule({ id: 'a' }), designBrief: 'x' },
      { ...createDefaultTrackerModule({ id: 'b' }), designBrief: 'y' },
    ];
    render({ request, modules, initial: { schemaText: KEEP } });

    await click(button('Generate schema:'));
    await click(document.querySelector('[data-testid="switch"]')!);
    release(CLEAN);
    await flush();

    expect(state.module.id).toBe('b');
    expect(state.schemaText).toBe(KEEP);
    expect(state.applied).toEqual([]);
  });

  test('a failed prompts generation leaves everything unchanged and shows the failure in the dialog', async () => {
    const request = jest.fn<Request>(async () => {
      throw new Error('boom');
    });
    render({ request, initial: { brief: 'x', schemaText: CLEAN } });

    await click(button('Generate prompts'));
    await generateInDialog();

    expect(state.applied).toEqual([]);
    expect(inDialog('.ztracker-llm-dialog-error').textContent).toMatch(/boom/);
    expect(await closeDialog(POPUP_RESULT.AFFIRMATIVE)).toBe(false);
    expect(state.applied).toEqual([]);
  });

  test('a failing apply (preset save) keeps the dialog open with the previews and reports the failure', async () => {
    const replies = ['SYSTEM', 'BASE'];
    render({
      request: jest.fn<Request>(async () => replies.shift()!),
      initial: { brief: 'x', schemaText: CLEAN },
      applyPrompts: async () => {
        throw new Error('preset save failed');
      },
    });

    await click(button('Generate prompts'));
    await generateInDialog();

    expect(await closeDialog(POPUP_RESULT.AFFIRMATIVE)).toBe(false);
    expect(inDialog('.ztracker-llm-dialog-error').textContent).toMatch(/preset save failed/);
    expect(inDialog<HTMLTextAreaElement>('.ztracker-llm-dialog-preview', 0).value).toBe('SYSTEM');
    expect(document.body.textContent).not.toMatch(/Prompts applied/);
  });
});
