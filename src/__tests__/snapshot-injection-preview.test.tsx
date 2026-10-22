/**
 * @jest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SnapshotInjectionPreview } from '../components/settings/SnapshotInjectionPreview.js';
import { EXTENSION_KEY } from '../extension-metadata.js';

const presets = {
  default: { name: 'Default', input: 'pretty_json', pattern: '', flags: 'g', replacement: '', codeFenceLang: 'json', wrapInCodeFence: true },
};
const baseSettings = (over: Record<string, unknown> = {}, presetOver: Record<string, unknown> = {}) =>
  ({
    embedZTrackerSnapshotHeader: 'Tracker:',
    embedZTrackerAsCharacter: false,
    embedZTrackerSnapshotTransformPreset: 'default',
    embedZTrackerSnapshotTransformPresets: { default: { ...presets.default, ...presetOver } },
    schemaPreset: 'default',
    schemaPresets: { default: { value: { type: 'object', properties: { mood: { type: 'string' } } } } },
    ...over,
  }) as any;

const withSnapshot = (value: unknown) => ({ name: 'Ann', mes: 'hello', extra: { [EXTENSION_KEY]: { byId: { default: { value } } } } });
const out = (id: string) => document.querySelector(`[data-testid="injection-preview-${id}"]`)?.textContent;

describe('SnapshotInjectionPreview', () => {
  let root: Root;
  let chat: any[];
  const render = (settings: any) =>
    act(() => {
      root.render(<SnapshotInjectionPreview settings={settings} moduleId="default" />);
    });

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById('root')!);
    chat = [withSnapshot({ mood: 'calm' })];
    (globalThis as any).SillyTavern = { getContext: () => ({ chat }) };
  });
  afterEach(() => act(() => root.unmount()));

  it('shows the stored snapshot and updates the final block as header, virtual character and pattern change', () => {
    render(baseSettings());
    expect(out('final-block')).toBe('Tracker:\n```json\n{\n  "mood": "calm"\n}\n```');

    render(baseSettings({ embedZTrackerSnapshotHeader: 'Scene:' }));
    expect(out('final-block')).toMatch(/^Scene:\n/);

    render(baseSettings({ embedZTrackerAsCharacter: true }));
    expect(out('final-block')).toMatch(/^```json/);

    render(baseSettings({}, { pattern: 'calm', replacement: 'angry' }));
    expect(out('after-regex')).toContain('angry');
    expect(out('after-input-formatting')).toContain('calm');
  });

  it('shows the regex error and keeps the untransformed text', () => {
    render(baseSettings({}, { pattern: '(' }));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Invalid regex');
    expect(out('final-block')).toContain('"calm"');
  });

  it('labels the schema example when the chat has no snapshot', () => {
    chat = [];
    render(baseSettings());
    expect(document.body.textContent).toContain('showing an example built from the schema');
    expect(out('raw-snapshot')).toContain('"mood": "string"');
  });

  it('says no preview is available when no example can be built', () => {
    chat = [];
    render(baseSettings({ schemaPresets: {} }));
    expect(document.body.textContent).toContain('No preview available');
  });

  it('picks up a newly stored snapshot on Refresh', () => {
    render(baseSettings());
    chat.push(withSnapshot({ mood: 'new' }));
    expect(out('raw-snapshot')).toContain('calm');
    act(() => {
      (document.querySelector('button') as HTMLButtonElement).click();
    });
    expect(out('raw-snapshot')).toContain('new');
  });

  describe('host events and picker', () => {
    const makeEvents = () => {
      const handlers = new Map<string, Set<() => void>>();
      return {
        handlers,
        on: (name: string, fn: () => void) => handlers.set(name, (handlers.get(name) ?? new Set()).add(fn)),
        removeListener: (name: string, fn: () => void) => handlers.get(name)?.delete(fn),
        emit: (name: string) => handlers.get(name)?.forEach((fn) => fn()),
      };
    };
    const select = () => document.querySelector('select') as HTMLSelectElement;
    const pick = (value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select(), value);
        select().dispatchEvent(new Event('change', { bubbles: true }));
      });

    it('re-reads the chat on MESSAGE_EDITED, resets the pick on CHAT_CHANGED, and unsubscribes on unmount', () => {
      const events = makeEvents();
      chat = [withSnapshot({ mood: 'a' }), withSnapshot({ mood: 'b' })];
      (globalThis as any).SillyTavern = { getContext: () => ({ chat, eventSource: events }) };
      render(baseSettings());
      expect(out('raw-snapshot')).toContain('"b"');

      pick('0');
      expect(out('raw-snapshot')).toContain('"a"');

      chat = [withSnapshot({ mood: 'a' }), withSnapshot({ mood: 'b' }), withSnapshot({ mood: 'c' })];
      act(() => events.emit('message_edited'));
      expect(out('raw-snapshot')).toContain('"a"'); // pick survives a message edit
      expect(select().options.length).toBe(3);

      act(() => events.emit('chat_id_changed'));
      expect(out('raw-snapshot')).toContain('"c"'); // back to newest

      act(() => root.unmount());
      expect([...events.handlers.values()].every((set) => set.size === 0)).toBe(true);
      root = createRoot(document.getElementById('root')!);
    });

    it('resets the pick to newest when the Module changes', () => {
      chat = [withSnapshot({ mood: 'a' }), withSnapshot({ mood: 'b' })];
      const view = (moduleId: string) =>
        act(() => {
          root.render(<SnapshotInjectionPreview settings={baseSettings()} moduleId={moduleId} />);
        });
      view('default');
      pick('0');
      expect(out('raw-snapshot')).toContain('"a"');
      view('other'); // no snapshots for this Module: example shown, pick cleared
      view('default');
      expect(out('raw-snapshot')).toContain('"b"');
    });
  });
});
