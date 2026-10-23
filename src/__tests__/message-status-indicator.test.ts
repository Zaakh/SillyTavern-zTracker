/**
 * @jest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import {
  clearMessageStatusIndicator,
  CONTEXT_MENU_STATUS_CLASS,
  syncMessageStatusIndicator,
  withMessageStatusIndicator,
} from '../ui/message-status-indicator.js';

/** Builds a minimal message row so the shared status helper can attach badges above message text. */
function buildMessage(messageId: number): string {
  return `<div class="mes" mesid="${messageId}"><div class="mes_text">Message ${messageId}</div></div>`;
}

describe('message status indicator helper', () => {
  beforeEach(() => {
    document.body.innerHTML = buildMessage(0);
  });

  test('adds and removes a context-menu status badge for a message', () => {
    syncMessageStatusIndicator({
      messageId: 0,
      text: 'Updating tracker from menu',
      statusClassName: CONTEXT_MENU_STATUS_CLASS,
    });

    expect(document.querySelector('.ztracker-context-menu-status')?.textContent).toContain('Updating tracker from menu');

    clearMessageStatusIndicator({ statusClassName: CONTEXT_MENU_STATUS_CLASS });

    expect(document.querySelector('.ztracker-context-menu-status')).toBeNull();
  });

  test('cleans up the badge after async work resolves', async () => {
    let finishWork: (() => void) | undefined;
    const work = new Promise<void>((resolve) => {
      finishWork = resolve;
    });

    const pending = withMessageStatusIndicator(
      {
        messageId: 0,
        text: 'Updating tracker from menu',
        statusClassName: CONTEXT_MENU_STATUS_CLASS,
      },
      async () => {
        expect(document.querySelector('.ztracker-context-menu-status')).not.toBeNull();
        await work;
      },
    );

    await Promise.resolve();
    expect(document.querySelector('.ztracker-context-menu-status')).not.toBeNull();

    finishWork?.();
    await pending;

    expect(document.querySelector('.ztracker-context-menu-status')).toBeNull();
  });

  test('cleans up the badge after async work rejects', async () => {
    await expect(
      withMessageStatusIndicator(
        {
          messageId: 0,
          text: 'Updating tracker from menu',
          statusClassName: CONTEXT_MENU_STATUS_CLASS,
        },
        async () => {
          expect(document.querySelector('.ztracker-context-menu-status')).not.toBeNull();
          throw new Error('boom');
        },
      ),
    ).rejects.toThrow('boom');

    expect(document.querySelector('.ztracker-context-menu-status')).toBeNull();
  });

  test('clears only the targeted message when a message id is provided', () => {
    document.body.innerHTML = `${buildMessage(0)}${buildMessage(1)}`;

    syncMessageStatusIndicator({
      messageId: 0,
      text: 'Updating tracker from menu',
      statusClassName: CONTEXT_MENU_STATUS_CLASS,
    });
    syncMessageStatusIndicator({
      messageId: 1,
      text: 'Updating tracker from menu',
      statusClassName: CONTEXT_MENU_STATUS_CLASS,
    });

    clearMessageStatusIndicator({ statusClassName: CONTEXT_MENU_STATUS_CLASS, messageId: 0 });

    expect(document.querySelector('.mes[mesid="0"] .ztracker-context-menu-status')).toBeNull();
    expect(document.querySelector('.mes[mesid="1"] .ztracker-context-menu-status')).not.toBeNull();
  });
});
describe('per-run badge', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    document.body.innerHTML = buildMessage(0);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const badge = (runKey: string) => document.querySelector(`[data-run-key="${runKey}"]`);

  test('updates phase and step text and ticks the timer without recreating the badge', async () => {
    let release: (() => void) | undefined;
    const pending = withMessageStatusIndicator(
      { messageId: 0, text: 'Updating tracker', statusClassName: CONTEXT_MENU_STATUS_CLASS, runKey: '0:a' },
      async (handle) => {
        handle.setPhase('preparing');
        handle.setStep('part 1/2');
        await new Promise<void>((resolve) => (release = resolve));
      },
    );
    await Promise.resolve();

    const element = badge('0:a')!;
    expect(element.querySelector('.ztracker-message-status-phase')?.textContent).toBe('preparing');
    expect(element.querySelector('.ztracker-message-status-step')?.textContent).toBe('part 1/2');
    expect(element.querySelector('.ztracker-message-status-timer')?.textContent).toBe('0:00');
    expect(element.querySelector('.ztracker-message-status-timer')?.getAttribute('aria-hidden')).toBe('true');

    jest.advanceTimersByTime(5000);
    expect(element.querySelector('.ztracker-message-status-timer')?.textContent).toBe('0:05');
    expect(badge('0:a')).toBe(element);

    release?.();
    await pending;
    expect(badge('0:a')).toBeNull();
  });

  test('removing the badge stops its timer', () => {
    syncMessageStatusIndicator({
      messageId: 0,
      text: 'x',
      statusClassName: CONTEXT_MENU_STATUS_CLASS,
      runKey: '0:a',
      startedAt: 0,
    });
    const timer = document.querySelector('.ztracker-message-status-timer')!;
    clearMessageStatusIndicator({ statusClassName: CONTEXT_MENU_STATUS_CLASS, runKey: '0:a' });
    jest.advanceTimersByTime(3000);
    expect(timer.textContent).toBe('0:00');
    expect(jest.getTimerCount()).toBe(0);
  });

  test('a badge dropped by a host re-render comes back with its elapsed time and phase', async () => {
    let release: (() => void) | undefined;
    const pending = withMessageStatusIndicator(
      { messageId: 0, text: 'x', statusClassName: CONTEXT_MENU_STATUS_CLASS, runKey: '0:a' },
      async (handle) => {
        handle.setPhase('waiting for the model');
        await new Promise<void>((resolve) => (release = resolve));
      },
    );
    await Promise.resolve();
    jest.advanceTimersByTime(40_000);

    // The host re-renders the message: the old badge is gone; the next tick rebuilds it.
    document.body.innerHTML = buildMessage(0);
    expect(badge('0:a')).toBeNull();
    jest.advanceTimersByTime(1000);

    const element = badge('0:a')!;
    expect(document.querySelectorAll('[data-run-key="0:a"]')).toHaveLength(1);
    expect(element.querySelector('.ztracker-message-status-timer')?.textContent).toBe('0:41');
    expect(element.querySelector('.ztracker-message-status-phase')?.textContent).toBe('waiting for the model');

    release?.();
    await pending;
  });

  test('two run keys on one message coexist and ending one leaves the other', async () => {
    let releaseA: (() => void) | undefined;
    let releaseB: (() => void) | undefined;
    const a = withMessageStatusIndicator(
      { messageId: 0, text: 'A', statusClassName: CONTEXT_MENU_STATUS_CLASS, runKey: '0:a' },
      () => new Promise<void>((resolve) => (releaseA = resolve)),
    );
    const b = withMessageStatusIndicator(
      { messageId: 0, text: 'B', statusClassName: CONTEXT_MENU_STATUS_CLASS, runKey: '0:b' },
      () => new Promise<void>((resolve) => (releaseB = resolve)),
    );
    await Promise.resolve();
    expect(badge('0:a')).not.toBeNull();
    expect(badge('0:b')).not.toBeNull();

    releaseA?.();
    await a;
    expect(badge('0:a')).toBeNull();
    expect(badge('0:b')).not.toBeNull();

    releaseB?.();
    await b;
  });

  test('cancel button calls the handler and does not propagate the click', () => {
    const onCancel = jest.fn();
    const parentClick = jest.fn();
    document.querySelector('.mes')!.addEventListener('click', parentClick);
    syncMessageStatusIndicator({
      messageId: 0,
      text: 'x',
      statusClassName: CONTEXT_MENU_STATUS_CLASS,
      runKey: '0:a',
      startedAt: 0,
      onCancel,
    });

    (document.querySelector('.ztracker-message-status-cancel') as HTMLElement).click();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(parentClick).not.toHaveBeenCalled();
  });
});
