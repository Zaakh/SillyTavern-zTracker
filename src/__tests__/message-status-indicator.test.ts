/**
 * @jest-environment jsdom
 */

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