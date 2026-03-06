/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('sillytavern-utils-lib/config', () => ({
  st_echo: jest.fn(),
}));

jest.unstable_mockModule('sillytavern-utils-lib/types/translate', () => ({
  AutoModeOptions: {
    RESPONSES: 'responses',
    BOTH: 'both',
    INPUT: 'input',
  },
}));

jest.unstable_mockModule('sillytavern-utils-lib/types', () => ({
  EventNames: {
    CHARACTER_MESSAGE_RENDERED: 'CHARACTER_MESSAGE_RENDERED',
    USER_MESSAGE_RENDERED: 'USER_MESSAGE_RENDERED',
    CHAT_CHANGED: 'CHAT_CHANGED',
  },
}));

jest.unstable_mockModule('../tracker.js', () => ({
  includeZTrackerMessages: (chat: unknown[]) => chat,
}));

const { initializeGlobalUI } = await import('../ui/ui-init.js');

function buildMessageWithPartsMenu(messageId: number, label: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'mes';
  wrapper.setAttribute('mesid', String(messageId));
  wrapper.innerHTML = `
    <div class="mes_ztracker">
      <details class="ztracker-parts-details">
        <summary>${label}</summary>
        <ul class="ztracker-parts-list">
          <li>item</li>
        </ul>
      </details>
    </div>
  `;
  return wrapper;
}

describe('initializeGlobalUI parts menu portal cleanup', () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

  beforeAll(async () => {
    // initializeGlobalUI installs document-level listeners — call it once to avoid duplicates.
    await initializeGlobalUI({
      globalContext: {
        chat: [],
        saveChat: jest.fn(async () => undefined),
        eventSource: { on: jest.fn() },
      },
      settingsManager: {
        getSettings: jest.fn(() => ({ autoMode: 'none', includeLastXZTrackerMessages: 1 })),
      } as any,
      actions: {
        renderExtensionTemplates: jest.fn(async () => undefined),
        generateTracker: jest.fn(),
        editTracker: jest.fn(),
        deleteTracker: jest.fn(),
        generateTrackerPart: jest.fn(),
        generateTrackerArrayItem: jest.fn(),
        generateTrackerArrayItemByName: jest.fn(),
        generateTrackerArrayItemByIdentity: jest.fn(),
        generateTrackerArrayItemField: jest.fn(),
        generateTrackerArrayItemFieldByName: jest.fn(),
        generateTrackerArrayItemFieldByIdentity: jest.fn(),
      } as any,
      renderTrackerWithDeps: () => undefined,
    });
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    }) as typeof requestAnimationFrame;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    // Reset the activePartsMenu singleton via the registered mousedown handler so tests are isolated.
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });

  test('does not keep orphaned portaled menu after tracker rerender and reopening menu', () => {
    const oldMessage = buildMessageWithPartsMenu(0, 'old');
    document.body.append(oldMessage);
    const oldDetails = oldMessage.querySelector('.ztracker-parts-details') as HTMLDetailsElement;
    oldDetails.open = true;
    oldDetails.dispatchEvent(new Event('toggle', { bubbles: true }));
    const oldPortaledList = document.querySelector('.ztracker-parts-list-portal') as HTMLElement;

    expect(document.querySelectorAll('.ztracker-parts-list-portal')).toHaveLength(1);

    oldMessage.remove();

    const newMessage = buildMessageWithPartsMenu(0, 'new');
    document.body.append(newMessage);
    const newDetails = newMessage.querySelector('.ztracker-parts-details') as HTMLDetailsElement;
    newDetails.open = true;
    newDetails.dispatchEvent(new Event('toggle', { bubbles: true }));

    expect(document.querySelectorAll('.ztracker-parts-list-portal')).toHaveLength(1);
    expect(document.body.contains(oldPortaledList)).toBe(false);
  });

  test('does not leave stale portaled menu when switching to another message parts menu', () => {
    const messageA = buildMessageWithPartsMenu(0, 'a');
    const messageB = buildMessageWithPartsMenu(1, 'b');
    document.body.append(messageA, messageB);

    const detailsA = messageA.querySelector('.ztracker-parts-details') as HTMLDetailsElement;
    const detailsB = messageB.querySelector('.ztracker-parts-details') as HTMLDetailsElement;

    detailsA.open = true;
    detailsA.dispatchEvent(new Event('toggle', { bubbles: true }));

    const oldPortaledList = document.querySelector('.ztracker-parts-list-portal') as HTMLElement;
    expect(oldPortaledList).not.toBeNull();
    expect(document.querySelectorAll('.ztracker-parts-list-portal')).toHaveLength(1);

    detailsB.open = true;
    detailsB.dispatchEvent(new Event('toggle', { bubbles: true }));

    expect(document.querySelectorAll('.ztracker-parts-list-portal')).toHaveLength(1);
    expect(oldPortaledList.classList.contains('ztracker-parts-list-portal')).toBe(false);
    expect(oldPortaledList.parentElement).not.toBe(document.body);
  });
});
