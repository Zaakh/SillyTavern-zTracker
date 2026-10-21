/**
 * @jest-environment jsdom
 */

// Component tests for the Design brief / Generate schema / Generate prompts controls and their
// hook (openspec: add-llm-schema-generation 5.4), rendered through a small harness that mirrors
// how Settings.tsx wires them: real hook + real controls, scripted active-connection request.
import { jest } from '@jest/globals';
import React, { act, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';

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
  let state: { schemaText: string; module: any; applied: any[] };

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="root"></div>';
    (globalThis as any).SillyTavern = { getContext: () => ({ getPresetManager: () => null }) };
    state = { schemaText: '', module: undefined, applied: [] };
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
        runningKind: generation.runningKind,
        replacesDraft: generation.replacesDraft,
        replacesPrompts: generation.replacesPrompts,
        status: generation.status,
        onGenerateSchema: generation.generateSchema,
        onGeneratePrompts: generation.generatePrompts,
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

  test('tooltips state what each button produces, depends on and replaces; connection is named', () => {
    render({ request: jest.fn<Request>(), initial: { brief: 'x' } });

    expect(button('Generate schema').title).toMatch(/Schema JSON.*Design brief.*Replaces the Schema JSON draft/);
    expect(button('Generate prompts').title).toMatch(/Design brief.*Schema JSON draft.*applies immediately/);
    expect(button('Generate schema').textContent).toBe(' Generate schema');
    expect(button('Generate prompts').textContent).toBe(' Generate prompts');
    expect(document.body.textContent).toMatch(/global active connection \(openai · gpt-x\)/);
  });

  test('disabled states: empty brief; invalid draft for prompts', () => {
    render({ request: jest.fn<Request>() });
    expect(button('Generate schema').disabled).toBe(true);
    expect(button('Generate prompts').disabled).toBe(true);
    act(() => root?.unmount());

    render({ request: jest.fn<Request>(), initial: { brief: 'x', schemaText: '{ nope' } });
    expect(button('Generate schema').disabled).toBe(false);
    expect(button('Generate prompts').disabled).toBe(true);
  });

  test('Generate schema fills only the draft and hints to generate HTML next', async () => {
    render({ request: jest.fn<Request>(async () => CLEAN), initial: { brief: 'weather' } });

    await click(button('Generate schema'));
    await flush();

    expect(JSON.parse(state.schemaText)).toMatchObject({ type: 'object' });
    expect(state.applied).toEqual([]);
    expect(document.body.textContent).toMatch(/generate HTML next/);
  });

  test('Generate prompts applies by captured Module id and leaves the draft alone', async () => {
    const replies = ['SYSTEM', 'BASE'];
    render({ request: jest.fn<Request>(async () => replies.shift()!), initial: { brief: 'weather', schemaText: CLEAN } });

    await click(button('Generate prompts'));
    await flush();

    expect(state.applied).toEqual([{ moduleId: 'a', result: { systemPrompt: 'SYSTEM', prompt: 'BASE' } }]);
    expect(state.schemaText).toBe(CLEAN);
    expect(document.body.textContent).toMatch(/applied immediately/);
  });

  test('overwrite notices are inline and no dialog is used', () => {
    const confirm = jest.fn();
    (globalThis as any).SillyTavern = { getContext: () => ({ getPresetManager: () => null, Popup: { show: { confirm } } }) };
    render({ request: jest.fn<Request>(), initial: { brief: 'x', schemaText: CLEAN } });

    expect(document.body.textContent).toMatch(/will replace the current Schema JSON draft/);
    expect(confirm).not.toHaveBeenCalled();
  });

  test('a prompts overwrite notice appears for a Module with existing prompt text', () => {
    const module = { ...createDefaultTrackerModule({ id: 'a' }), designBrief: 'x' };
    module.systemPrompt.content = 'existing';
    render({ request: jest.fn<Request>(), modules: [module] });

    expect(document.body.textContent).toMatch(/Generate prompts will overwrite/);
  });

  test('no overwrite notice when nothing would be replaced', () => {
    render({ request: jest.fn<Request>(), initial: { brief: 'x' } });

    expect(document.body.textContent).not.toMatch(/will replace|will overwrite/);
  });

  test('double click does not start a second request while running', async () => {
    let release!: (value: string) => void;
    const request = jest.fn<Request>(() => new Promise<string>((resolve) => (release = resolve)));
    render({ request, initial: { brief: 'x' } });

    await click(button('Generate schema'));
    expect(button('Generate schema').disabled).toBe(true);
    expect(button('Generate prompts').disabled).toBe(true);
    await click(button('Generate schema'));
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

    await click(button('Generate schema'));
    await flush();
    expect(request).toHaveBeenCalledTimes(2);

    await click(button('Cancel'));
    await flush();

    expect(request).toHaveBeenCalledTimes(2);
    expect(state.schemaText).toBe(KEEP);
    expect(button('Generate schema').disabled).toBe(false);
  });

  test('switching Module mid-run discards the result for both Modules', async () => {
    let release!: (value: string) => void;
    const request = jest.fn<Request>(() => new Promise<string>((resolve) => (release = resolve)));
    const modules = [
      { ...createDefaultTrackerModule({ id: 'a' }), designBrief: 'x' },
      { ...createDefaultTrackerModule({ id: 'b' }), designBrief: 'y' },
    ];
    render({ request, modules, initial: { schemaText: KEEP } });

    await click(button('Generate schema'));
    await click(document.querySelector('[data-testid="switch"]')!);
    release(CLEAN);
    await flush();

    expect(state.module.id).toBe('b');
    expect(state.schemaText).toBe(KEEP);
    expect(state.applied).toEqual([]);
  });

  test('a failed prompts generation leaves everything unchanged and shows the failure', async () => {
    const request = jest.fn<Request>(async () => {
      throw new Error('boom');
    });
    render({ request, initial: { brief: 'x', schemaText: CLEAN } });

    await click(button('Generate prompts'));
    await flush();

    expect(state.applied).toEqual([]);
    expect(document.body.textContent).toMatch(/boom/);
  });

  test('a failing apply (preset save) is reported and not announced as applied', async () => {
    const replies = ['SYSTEM', 'BASE'];
    render({
      request: jest.fn<Request>(async () => replies.shift()!),
      initial: { brief: 'x', schemaText: CLEAN },
      applyPrompts: async () => {
        throw new Error('preset save failed');
      },
    });

    await click(button('Generate prompts'));
    await flush();

    expect(document.body.textContent).toMatch(/preset save failed/);
    expect(document.body.textContent).not.toMatch(/applied immediately/);
  });
});
