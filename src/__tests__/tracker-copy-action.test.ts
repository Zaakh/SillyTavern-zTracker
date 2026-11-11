/**
 * @jest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

jest.unstable_mockModule('sillytavern-utils-lib/config', () => ({
  st_echo: jest.fn(),
  selected_group: false,
}));

const { findCopyControl, handleCopyControlClick } = await import('../ui/tracker-copy-action.js');
const { createDefaultTrackerModule, defaultSettings } = await import('../config.js');

function block(moduleId: string, id: string, text: string, control = `<button type="button" data-ztracker-copy="${id}"><i class="icon"></i></button>`) {
  return `<div class="mes_ztracker" data-ztracker-module="${moduleId}">${control}<div data-ztracker-copy-source="${id}">${text}</div></div>`;
}

const control = (n = 0) => document.querySelectorAll<HTMLElement>('[data-ztracker-copy]')[n];

function setClipboard(writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: writeText ? { writeText } : undefined, configurable: true });
}

describe('handleCopyControlClick', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('copies trimmed textContent and shows then resets success feedback without touching content', async () => {
    document.body.innerHTML = block('a', 'p', '\n    A &lt;b&gt; &amp; c\n  ');
    control().setAttribute('title', 'Copy prompt');
    const writeText = jest.fn<(t: string) => Promise<void>>(async () => undefined);
    setClipboard(writeText);

    await handleCopyControlClick(control());

    expect(writeText).toHaveBeenCalledWith('A <b> & c');
    expect(control().classList.contains('is-copied')).toBe(true);
    expect(control().title).toBe('Copied');
    expect(control().querySelector('.icon')).not.toBeNull();

    jest.advanceTimersByTime(2000);
    expect(control().classList.contains('is-copied')).toBe(false);
    expect(control().title).toBe('Copy prompt');
  });

  test('does nothing when the target is missing or only exists in another Module block', async () => {
    document.body.innerHTML =
      `<div class="mes_ztracker" data-ztracker-module="a"><button data-ztracker-copy="p"></button></div>` +
      block('b', 'p', 'other');
    const writeText = jest.fn<(t: string) => Promise<void>>(async () => undefined);
    setClipboard(writeText);

    await handleCopyControlClick(control());

    expect(writeText).not.toHaveBeenCalled();
    expect(control().classList.contains('is-copied')).toBe(false);
    expect(control().classList.contains('is-copy-failed')).toBe(false);
  });

  test('falls back to execCommand when the clipboard API is unavailable', async () => {
    document.body.innerHTML = block('a', 'p', 'text');
    setClipboard(undefined);
    (document as any).execCommand = jest.fn(() => true);

    await handleCopyControlClick(control());

    expect((document as any).execCommand).toHaveBeenCalledWith('copy');
    expect(control().classList.contains('is-copied')).toBe(true);
  });

  test('shows failure when both the clipboard API and the fallback fail', async () => {
    document.body.innerHTML = block('a', 'p', 'text');
    setClipboard(async () => {
      throw new Error('denied');
    });
    (document as any).execCommand = jest.fn(() => false);

    await handleCopyControlClick(control());

    expect(control().classList.contains('is-copy-failed')).toBe(true);
    jest.advanceTimersByTime(2000);
    expect(control().classList.contains('is-copy-failed')).toBe(false);
  });

  test('findCopyControl resolves a nested element to its control', () => {
    document.body.innerHTML = block('a', 'p', 'text');
    expect(findCopyControl(document.querySelector('.icon'))).toBe(control());
    expect(findCopyControl(document.body)).toBeNull();
  });
});

describe('copy control in the delegated click handler', () => {
  test('clicking the control or a nested icon runs no tracker action', async () => {
    const { initializeGlobalUI } = await import('../ui/ui-init.js');
    const { bootExtensionForTest, createSillyTavernHost, installChatMessageDom, installMessageTemplateDom } = await import(
      '../test-utils/sillytavern-host-harness.js'
    );
    const host = createSillyTavernHost();
    const actions: any = new Proxy({ renderExtensionTemplates: jest.fn(async () => undefined) }, {
      get: (t: any, k) => t[k] ?? (t[k] = jest.fn()),
      has: () => true,
    });
    document.body.innerHTML = '';
    installMessageTemplateDom();
    const settings = { ...JSON.parse(JSON.stringify(defaultSettings)), modules: [createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 })] };
    await bootExtensionForTest({
      host,
      boot: () =>
        initializeGlobalUI({
          globalContext: host.context,
          settingsManager: { getSettings: jest.fn(() => settings) } as any,
          actions,
          renderTrackerWithDeps: () => undefined,
        }),
    });
    installChatMessageDom(3, { innerHtml: `<div class="mes_text">x</div>${block('scene', 'p', 'text', '<button type="button" data-ztracker-copy="p" class="ztracker-edit-button"><i class="icon"></i></button>')}` });
    setClipboard(async () => undefined);
    // Real stored tracker data, so "untouched" is a meaningful assertion rather than [] === [].
    (host.context.chat as unknown[]).push({ mes: 'x', extra: { zTracker: { byId: { scene: { value: { a: 1 }, html: '<i/>' } } } } });
    const before = JSON.stringify(host.context.chat);
    const called = () => ['editTracker', 'generateTracker', 'deleteTracker', 'generateTrackerPart'].filter((k) => actions[k].mock.calls.length);

    control().click();
    document.querySelector<HTMLElement>('.icon')!.click();

    expect(called()).toEqual([]);
    expect(before).toContain('"a":1');
    expect(JSON.stringify(host.context.chat)).toBe(before);
  });
});
