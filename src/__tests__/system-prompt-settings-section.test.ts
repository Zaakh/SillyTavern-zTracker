/**
 * @jest-environment jsdom
 */

/**
 * Focused component test for the "Recreate from shipped prompt" action added to
 * SystemPromptSettingsSection (see openspec/changes/seed-starter-modules). Renders the section
 * directly with controlled props rather than through the full Settings.tsx tree, since that tree
 * mocks TrackerGenerationSection (and therefore this section) away in settings-ui.test.ts.
 */
import { jest } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

const buttonMock = jest.fn(({ children, onClick, title, className }: any) =>
  React.createElement('button', { type: 'button', title, className, onClick }, children),
);

jest.unstable_mockModule('sillytavern-utils-lib/components/react', () => ({
  STButton: buttonMock,
}));

const { SystemPromptSettingsSection } = await import('../components/settings/SystemPromptSettingsSection.js');

function makeSettings() {
  return {
    trackerSystemPromptMode: 'saved' as const,
    trackerSystemPromptSavedName: 'zTracker-Custom-1.0',
  };
}

describe('SystemPromptSettingsSection recreate-preset action', () => {
  let root: Root | undefined;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
  });

  function renderSection(props: {
    showMissingSavedSystemPromptWarning: boolean;
    showRecreateSystemPromptAction: boolean;
    recreateModuleSystemPromptPreset: () => void | Promise<void>;
    isRecreatingSystemPrompt?: boolean;
  }) {
    act(() => {
      root!.render(
        React.createElement(SystemPromptSettingsSection, {
          settings: makeSettings(),
          updateAndRefresh: jest.fn(),
          systemPromptItems: [{ value: 'zTracker-Custom-1.0', label: 'zTracker-Custom-1.0' }],
          refreshSystemPromptState: jest.fn(),
          showMissingSavedSystemPromptWarning: props.showMissingSavedSystemPromptWarning,
          showSharedSystemPromptWarning: false,
          showRecreateSystemPromptAction: props.showRecreateSystemPromptAction,
          recreateModuleSystemPromptPreset: props.recreateModuleSystemPromptPreset,
          isRecreatingSystemPrompt: props.isRecreatingSystemPrompt ?? false,
        } as any),
      );
    });
  }

  function findRecreateButton(): HTMLButtonElement | undefined {
    const button = container.querySelector('[data-testid="recreate-system-prompt-button"]');
    return button instanceof HTMLButtonElement ? button : undefined;
  }

  test('is hidden for a content-less Module even while the missing-preset warning is shown', () => {
    renderSection({
      showMissingSavedSystemPromptWarning: true,
      showRecreateSystemPromptAction: false,
      recreateModuleSystemPromptPreset: jest.fn<() => void>(),
    });

    expect(container.textContent).toContain('the selected saved system prompt no longer exists');
    expect(findRecreateButton()).toBeUndefined();
  });

  test('is shown for a Module with content, and clears the warning once the preset is recreated', async () => {
    let showMissingSavedSystemPromptWarning = true;
    let showRecreateSystemPromptAction = true;
    const recreateModuleSystemPromptPreset = jest.fn(async () => {
      // Simulates the real flow: after a successful recreate, hasSystemPromptPreset() would
      // report the preset exists again, so both warning-driving flags flip and Settings.tsx
      // re-renders this section with them cleared.
      showMissingSavedSystemPromptWarning = false;
      showRecreateSystemPromptAction = false;
      renderSection({ showMissingSavedSystemPromptWarning, showRecreateSystemPromptAction, recreateModuleSystemPromptPreset });
    });

    renderSection({ showMissingSavedSystemPromptWarning, showRecreateSystemPromptAction, recreateModuleSystemPromptPreset });

    const recreateButton = findRecreateButton();
    expect(recreateButton).toBeDefined();

    await act(async () => {
      recreateButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(recreateModuleSystemPromptPreset).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('the selected saved system prompt no longer exists');
    expect(findRecreateButton()).toBeUndefined();
  });

  test('is disabled and shows in-flight text while a recreate call is pending', () => {
    renderSection({
      showMissingSavedSystemPromptWarning: true,
      showRecreateSystemPromptAction: true,
      recreateModuleSystemPromptPreset: jest.fn<() => void>(),
      isRecreatingSystemPrompt: true,
    });

    const recreateButton = findRecreateButton();
    expect(recreateButton).toBeDefined();
    expect(recreateButton?.disabled).toBe(true);
    expect(recreateButton?.textContent).toBe('Recreating…');
  });
});

/** Updates one controlled select through the native DOM setter so React sees the change. */
function setSelectValue(element: HTMLSelectElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('System Prompt Source mode switch', () => {
  let root: Root | undefined;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
  });

  function renderWithSettings(settings: { trackerSystemPromptMode: string; trackerSystemPromptSavedName: string }) {
    act(() => {
      root!.render(
        React.createElement(SystemPromptSettingsSection, {
          settings,
          updateAndRefresh: (updater: (current: typeof settings) => void) =>
            act(() => {
              updater(settings);
              renderWithSettings(settings);
            }),
          systemPromptItems: [],
          refreshSystemPromptState: jest.fn(),
          showMissingSavedSystemPromptWarning: false,
          showSharedSystemPromptWarning: false,
          showRecreateSystemPromptAction: false,
          recreateModuleSystemPromptPreset: jest.fn(),
          isRecreatingSystemPrompt: false,
        } as any),
      );
    });
  }

  function findModeSelect(): HTMLSelectElement {
    const select = container.querySelector('select');
    if (!(select instanceof HTMLSelectElement)) throw new Error('mode select not found');
    return select;
  }

  test('switching to saved mode with no prior selection leaves the saved name empty', () => {
    const settings = { trackerSystemPromptMode: 'profile', trackerSystemPromptSavedName: '' };
    renderWithSettings(settings);

    act(() => {
      setSelectValue(findModeSelect(), 'saved');
    });

    expect(settings.trackerSystemPromptMode).toBe('saved');
    expect(settings.trackerSystemPromptSavedName).toBe('');
  });

  test('switching to saved mode preserves an existing saved name', () => {
    const settings = { trackerSystemPromptMode: 'profile', trackerSystemPromptSavedName: 'zTracker-Custom-1.0' };
    renderWithSettings(settings);

    act(() => {
      setSelectValue(findModeSelect(), 'saved');
    });

    expect(settings.trackerSystemPromptMode).toBe('saved');
    expect(settings.trackerSystemPromptSavedName).toBe('zTracker-Custom-1.0');
  });
});
