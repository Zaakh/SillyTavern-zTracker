/**
 * @jest-environment jsdom
 */

import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { POPUP_RESULT } from 'sillytavern-utils-lib/types/popup';

const stEchoMock = jest.fn();
jest.unstable_mockModule('sillytavern-utils-lib/config', () => ({
  st_echo: stEchoMock,
  selected_group: false,
}));

const { createLorebookActions } = await import('../ui/lorebook-actions.js');
const { renderTracker } = await import('../tracker.js');
const { LOREBOOK_KEYS_ACTION } = await import('../lorebook-export.js');
const { createDefaultTrackerModule, defaultSettings } = await import('../config.js');

const hostEntry = (uid: number) => ({ uid, key: [], comment: '', content: '', order: 100, disable: false });

function makeFixture(options: { link?: boolean; books?: Record<string, any> } = {}) {
  const module = createDefaultTrackerModule({ id: 'scene', name: 'Scene', order: 0 });
  const settings: any = { ...JSON.parse(JSON.stringify(defaultSettings)), modules: [module] };
  const record: Record<string, any> = { value: { species: 'Elf' }, html: '<div>{{data.species}}</div>' };
  if (options.link) record.lorebookLink = { book: 'Characters', uid: 0, title: 'Bob' };
  const message = { extra: { zTracker: { byId: { scene: record } } } };

  const books: Record<string, any> = options.books ?? { Characters: { entries: {} } };
  const persisted: Record<string, any> = JSON.parse(JSON.stringify(books));
  // Title requests get a title-like reply, keys requests a comma list (told apart by their own default prompt).
  const request = jest.fn<any>(async (messages: Array<{ role: string; content: string }>) =>
    messages[0].content === LOREBOOK_KEYS_ACTION.defaultInstruction ? 'Bob, Bobby' : 'Bob the Elf',
  );
  const host: any = {
    getWorldInfoNames: () => Object.keys(books),
    loadWorldInfo: async (name: string) => books[name] ?? null,
    saveWorldInfo: jest.fn(async (name: string, data: any) => {
      persisted[name] = JSON.parse(JSON.stringify(data));
    }),
    readBook: async (name: string) => (persisted[name] ? { entries: Object.values(persisted[name].entries) } : null),
    reloadWorldInfoEditor: jest.fn(),
    createWorldInfoEntry: (_n: string, data: any) => (data.entries[Object.keys(data.entries).length] = hostEntry(Object.keys(data.entries).length)),
  };

  // The popup stub exposes the built form and lets each test drive it before choosing a result.
  let drive: (form: HTMLElement) => Promise<number> | number = () => POPUP_RESULT.AFFIRMATIVE;
  let driveAdvanced: (form: HTMLElement) => Promise<number> | number = () => POPUP_RESULT.CANCELLED;
  const globalContext: any = {
    chat: [message],
    saveChat: jest.fn(async () => undefined),
    callGenericPopup: jest.fn(async (form: HTMLElement, _type: unknown, _title: string, popupOptions: any) => {
      document.body.append(form);
      const result = await (_title === 'Export to lorebook' ? drive : driveAdvanced)(form);
      return (await popupOptions.onClosing?.({ result })) === false ? POPUP_RESULT.CANCELLED : result;
    }),
    Popup: { show: { confirm: jest.fn(async () => false) } },
  };
  const renderTrackerWithDeps = jest.fn();
  const saveSettings = jest.fn();
  const actions = createLorebookActions({
    globalContext,
    settingsManager: { getSettings: () => settings, saveSettings } as any,
    renderTrackerWithDeps,
    requestWithActiveConnection: request,
    getActiveConnectionLabel: () => 'Test API',
    createHost: async () => host,
  });
  return {
    actions, host, books, persisted, record, globalContext, request, renderTrackerWithDeps, settings, saveSettings, message,
    onPopup(fn: typeof drive) {
      drive = fn;
    },
    onAdvanced(fn: typeof drive) {
      driveAdvanced = fn;
    },
  };
}

const field = (form: HTMLElement, selector: string) => form.querySelector(selector) as HTMLInputElement;

describe('lorebook controls on the tracker block', () => {
  function renderBlock(link: boolean) {
    const { message, settings } = makeFixture({ link });
    document.body.innerHTML = '<div class="mes" mesid="0"><div class="mes_text"></div></div>';
    renderTracker(0, { context: { chat: [message as any] }, settings });
    return {
      exportButton: document.querySelector('.ztracker-lorebook-export-button') as HTMLButtonElement,
      replaceButton: document.querySelector('.ztracker-lorebook-replace-button') as HTMLButtonElement,
    };
  }

  test('without a link Replace is disabled and Export is enabled', () => {
    const { exportButton, replaceButton } = renderBlock(false);
    expect(exportButton.textContent).toBe('Export to lorebook...');
    expect(exportButton.disabled).toBe(false);
    expect(replaceButton.disabled).toBe(true);
  });

  test('with a link Replace is enabled and names the book and entry', () => {
    const { replaceButton } = renderBlock(true);
    expect(replaceButton.disabled).toBe(false);
    expect(replaceButton.textContent).toContain('Characters');
    expect(replaceButton.textContent).toContain('Bob');
  });
});

describe('lorebook buttons reach the handlers', () => {
  test('clicks on the export and replace buttons call the matching actions for the owning module', async () => {
    jest.resetModules();
    const { initializeGlobalUI } = await import('../ui/ui-init.js');
    const { bootExtensionForTest, createSillyTavernHost, installChatMessageDom, installMessageTemplateDom } = await import(
      '../test-utils/sillytavern-host-harness.js'
    );
    const host = createSillyTavernHost();
    const actions: any = {
      renderExtensionTemplates: jest.fn(async () => undefined),
      exportToLorebook: jest.fn(),
      replaceLorebookEntry: jest.fn(),
    };
    document.body.innerHTML = '';
    installMessageTemplateDom();
    await bootExtensionForTest({
      host,
      boot: () =>
        initializeGlobalUI({
          globalContext: host.context,
          settingsManager: { getSettings: jest.fn(() => ({ autoMode: 'none', includeLastXZTrackerMessages: 1 })) } as any,
          actions,
          renderTrackerWithDeps: () => undefined,
        }),
    });
    installChatMessageDom(3, {
      innerHtml: `<div class="mes_text">x</div>
        <div class="mes_ztracker" data-ztracker-module="scene">
          <button class="ztracker-lorebook-export-button">Export to lorebook...</button>
          <button class="ztracker-lorebook-replace-button">Replace linked entry</button>
        </div>`,
    });

    (document.querySelector('.ztracker-lorebook-export-button') as HTMLElement).click();
    (document.querySelector('.ztracker-lorebook-replace-button') as HTMLElement).click();

    expect(actions.exportToLorebook).toHaveBeenCalledWith(3, 'scene');
    expect(actions.replaceLorebookEntry).toHaveBeenCalledWith(3, 'scene');
  });
});

describe('export dialog', () => {
  beforeEach(() => {
    stEchoMock.mockClear();
    document.body.innerHTML = '';
  });

  test('confirm creates the entry with the title as comment and keys defaulting to the title', async () => {
    const f = makeFixture();
    f.onPopup((form) => {
      const title = field(form, '.ztracker-lorebook-title');
      title.value = 'Bob';
      title.dispatchEvent(new Event('input'));
      return POPUP_RESULT.AFFIRMATIVE;
    });

    await f.actions.exportToLorebook(0, 'scene');

    expect(f.persisted.Characters.entries[0]).toMatchObject({ comment: 'Bob', key: ['Bob'], content: '[Topic: Bob\nspecies: Elf\n]' });
    expect(f.record.lorebookLink).toEqual({ book: 'Characters', uid: 0, title: 'Bob' });
    expect(f.globalContext.saveChat).toHaveBeenCalled();
    expect(f.renderTrackerWithDeps).toHaveBeenCalledWith(0, 'scene');
    expect(f.request).not.toHaveBeenCalled();
  });

  test('a chat save failure after a good export tells the user the link was not kept', async () => {
    const f = makeFixture();
    f.globalContext.saveChat.mockRejectedValueOnce(new Error('disk full'));
    f.onPopup((form) => {
      field(form, '.ztracker-lorebook-title').value = 'Bob';
      return POPUP_RESULT.AFFIRMATIVE;
    });
    await f.actions.exportToLorebook(0, 'scene');
    expect(stEchoMock).toHaveBeenCalledWith('error', expect.stringContaining('link'));
    expect(stEchoMock).not.toHaveBeenCalledWith('success', expect.anything());
  });

  test('cancel writes nothing', async () => {
    const f = makeFixture();
    f.onPopup(() => POPUP_RESULT.NEGATIVE);
    await f.actions.exportToLorebook(0, 'scene');
    expect(f.host.saveWorldInfo).not.toHaveBeenCalled();
    expect(f.record.lorebookLink).toBeUndefined();
  });

  test('an empty title refuses to continue and writes nothing', async () => {
    const f = makeFixture();
    f.onPopup(() => POPUP_RESULT.AFFIRMATIVE);
    await f.actions.exportToLorebook(0, 'scene');
    expect(f.host.saveWorldInfo).not.toHaveBeenCalled();
    expect(stEchoMock).toHaveBeenCalledWith('warning', expect.stringContaining('title'));
  });

  test('cleared keys export with no keys and warn the user', async () => {
    const f = makeFixture();
    f.onPopup((form) => {
      field(form, '.ztracker-lorebook-title').value = 'Bob';
      field(form, '.ztracker-lorebook-keys').value = '';
      field(form, '.ztracker-lorebook-keys').dispatchEvent(new Event('input'));
      return POPUP_RESULT.AFFIRMATIVE;
    });
    await f.actions.exportToLorebook(0, 'scene');
    expect(f.persisted.Characters.entries[0].key).toEqual([]);
    expect(stEchoMock).toHaveBeenCalledWith('warning', expect.stringContaining('no keys'));
  });

  test('no lorebooks tells the user to create one and opens no dialog', async () => {
    const f = makeFixture({ books: {} });
    await f.actions.exportToLorebook(0, 'scene');
    expect(f.globalContext.callGenericPopup).not.toHaveBeenCalled();
    expect(stEchoMock).toHaveBeenCalledWith('warning', expect.stringContaining('Create a lorebook first'));
  });

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const click = (form: HTMLElement, selector: string) => (form.querySelector(selector) as HTMLButtonElement).click();
  const sentTo = (f: ReturnType<typeof makeFixture>, call = 0) => (f.request.mock.calls[call] as any)[0] as Array<{ role: string; content: string }>;

  test('Suggest title fills the title and the keys that still follow it, only when pressed', async () => {
    const f = makeFixture();
    let sentBeforePress = -1;
    f.onPopup(async (form) => {
      sentBeforePress = f.request.mock.calls.length;
      click(form, '.ztracker-lorebook-suggest-title');
      await tick();
      expect(field(form, '.ztracker-lorebook-title').value).toBe('Bob the Elf');
      expect(field(form, '.ztracker-lorebook-keys').value).toBe('Bob the Elf');
      return POPUP_RESULT.NEGATIVE;
    });
    await f.actions.exportToLorebook(0, 'scene');
    expect(sentBeforePress).toBe(0);
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.globalContext.callGenericPopup).toHaveBeenCalledTimes(1);
  });

  test('Suggest keys sends the typed title, fills the keys and stops them following the title', async () => {
    const f = makeFixture();
    f.onPopup(async (form) => {
      const title = field(form, '.ztracker-lorebook-title');
      title.value = 'Bob the Builder';
      title.dispatchEvent(new Event('input'));
      click(form, '.ztracker-lorebook-suggest-keys');
      await tick();
      expect(field(form, '.ztracker-lorebook-keys').value).toBe('Bob, Bobby');
      title.value = 'Renamed';
      title.dispatchEvent(new Event('input'));
      expect(field(form, '.ztracker-lorebook-keys').value).toBe('Bob, Bobby');
      return POPUP_RESULT.NEGATIVE;
    });
    await f.actions.exportToLorebook(0, 'scene');
    expect(sentTo(f)[1].content).toContain('Bob the Builder');
  });

  test('Suggest keys without a title still sends the request', async () => {
    const f = makeFixture();
    f.onPopup(async (form) => {
      click(form, '.ztracker-lorebook-suggest-keys');
      await tick();
      expect(field(form, '.ztracker-lorebook-keys').value).toBe('Bob, Bobby');
      return POPUP_RESULT.NEGATIVE;
    });
    await f.actions.exportToLorebook(0, 'scene');
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(sentTo(f)[1].content).not.toContain('Entry title');
  });

  test('Quick uses a saved override', async () => {
    const f = makeFixture();
    f.settings.promptOverrides = { 'lorebook-title': 'MY TITLE PROMPT' };
    f.onPopup(async (form) => {
      click(form, '.ztracker-lorebook-suggest-title');
      await tick();
      return POPUP_RESULT.NEGATIVE;
    });
    await f.actions.exportToLorebook(0, 'scene');
    expect(sentTo(f)[0].content).toBe('MY TITLE PROMPT');
  });

  test('a failed suggestion keeps the typed title and reports an error', async () => {
    const f = makeFixture();
    f.request.mockRejectedValueOnce(new Error('offline'));
    f.onPopup(async (form) => {
      field(form, '.ztracker-lorebook-title').value = 'Typed';
      click(form, '.ztracker-lorebook-suggest-title');
      await tick();
      expect(field(form, '.ztracker-lorebook-title').value).toBe('Typed');
      expect((form.querySelector('.ztracker-lorebook-suggest-title') as HTMLButtonElement).disabled).toBe(false);
      return POPUP_RESULT.NEGATIVE;
    });
    await f.actions.exportToLorebook(0, 'scene');
    expect(stEchoMock).toHaveBeenCalledWith('error', expect.stringContaining('offline'));
  });

  test('an unusable keys reply keeps the keys field and reports an error', async () => {
    const f = makeFixture();
    f.request.mockResolvedValueOnce(' , - ');
    f.onPopup(async (form) => {
      field(form, '.ztracker-lorebook-keys').value = 'kept';
      click(form, '.ztracker-lorebook-suggest-keys');
      await tick();
      expect(field(form, '.ztracker-lorebook-keys').value).toBe('kept');
      return POPUP_RESULT.NEGATIVE;
    });
    await f.actions.exportToLorebook(0, 'scene');
    expect(stEchoMock).toHaveBeenCalledWith('error', expect.stringContaining('keys'));
  });

  test('one suggestion at a time: all four buttons are disabled while one runs', async () => {
    const f = makeFixture();
    let release!: (title: string) => void;
    f.request.mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve; }));
    f.onPopup(async (form) => {
      const names = ['suggest-title', 'suggest-keys', 'advanced-title', 'advanced-keys'];
      const buttons = names.map((name) => form.querySelector(`.ztracker-lorebook-${name}`) as HTMLButtonElement);
      buttons[0].click();
      expect(buttons.every((button) => button.disabled)).toBe(true);
      buttons[1].click();
      release('Done');
      await tick();
      expect(buttons.every((button) => !button.disabled)).toBe(true);
      return POPUP_RESULT.NEGATIVE;
    });
    await f.actions.exportToLorebook(0, 'scene');
    expect(f.request).toHaveBeenCalledTimes(1);
  });

  test('a failure while opening an Advanced dialog is reported and re-enables the buttons', async () => {
    const f = makeFixture();
    f.globalContext.callGenericPopup.mockImplementation(async (form: HTMLElement, _t: unknown, title: string) => {
      if (title !== 'Export to lorebook') throw new Error('popup exploded');
      document.body.append(form);
      click(form, '.ztracker-lorebook-advanced-keys');
      await tick();
      expect((form.querySelector('.ztracker-lorebook-suggest-keys') as HTMLButtonElement).disabled).toBe(false);
      return POPUP_RESULT.NEGATIVE;
    });
    await f.actions.exportToLorebook(0, 'scene');
    expect(stEchoMock).toHaveBeenCalledWith('error', expect.stringContaining('popup exploded'));
  });

  test('Advanced sends nothing until Generate is pressed', async () => {
    const f = makeFixture();
    let sentOnOpen = -1;
    f.onPopup(async (form) => {
      click(form, '.ztracker-lorebook-advanced-keys');
      await tick();
      return POPUP_RESULT.NEGATIVE;
    });
    f.onAdvanced(() => {
      sentOnOpen = f.request.mock.calls.length;
      return POPUP_RESULT.CANCELLED;
    });
    await f.actions.exportToLorebook(0, 'scene');
    expect(sentOnOpen).toBe(0);
    expect(f.request).not.toHaveBeenCalled();
  });

  test('Advanced title Apply fills the edited title; Cancel leaves it', async () => {
    for (const result of [POPUP_RESULT.AFFIRMATIVE, POPUP_RESULT.CANCELLED]) {
      const f = makeFixture();
      let titleAfter = '';
      f.onPopup(async (form) => {
        field(form, '.ztracker-lorebook-title').value = 'Typed';
        click(form, '.ztracker-lorebook-advanced-title');
        await tick();
        await tick();
        titleAfter = field(form, '.ztracker-lorebook-title').value;
        return POPUP_RESULT.NEGATIVE;
      });
      f.onAdvanced(async (dialog) => {
        click(dialog, '.ztracker-llm-dialog-generate');
        await tick();
        (dialog.querySelector('.ztracker-llm-dialog-preview') as HTMLTextAreaElement).value = 'Edited title';
        return result;
      });
      await f.actions.exportToLorebook(0, 'scene');
      expect(titleAfter).toBe(result === POPUP_RESULT.AFFIRMATIVE ? 'Edited title' : 'Typed');
    }
  });

  test('Advanced keys Apply fills the keys; an edited prompt is saved even after Cancel', async () => {
    const f = makeFixture();
    f.onPopup(async (form) => {
      click(form, '.ztracker-lorebook-advanced-keys');
      await tick();
      await tick();
      expect(field(form, '.ztracker-lorebook-keys').value).toBe('Bob, Bobby');
      return POPUP_RESULT.NEGATIVE;
    });
    f.onAdvanced(async (dialog) => {
      click(dialog, '.ztracker-llm-dialog-generate');
      await tick();
      return POPUP_RESULT.AFFIRMATIVE;
    });
    await f.actions.exportToLorebook(0, 'scene');

    const g = makeFixture();
    g.onPopup(async (form) => {
      click(form, '.ztracker-lorebook-advanced-title');
      await tick();
      return POPUP_RESULT.NEGATIVE;
    });
    g.onAdvanced((dialog) => {
      const textarea = dialog.querySelector('.ztracker-llm-dialog-instruction') as HTMLTextAreaElement;
      textarea.value = 'tuned prompt';
      return POPUP_RESULT.CANCELLED;
    });
    await g.actions.exportToLorebook(0, 'scene');
    expect(g.settings.promptOverrides).toEqual({ 'lorebook-title': 'tuned prompt' });
    expect(g.saveSettings).toHaveBeenCalled();
  });
});

describe('Replace linked entry', () => {
  beforeEach(() => { stEchoMock.mockClear(); });

  test('overwrites the linked entry content without opening the dialog or calling the LLM', async () => {
    const f = makeFixture({ link: true, books: { Characters: { entries: { 0: { ...hostEntry(0), key: ['kept'], content: 'old' } } } } });
    await f.actions.replaceLorebookEntry(0, 'scene');

    expect(f.persisted.Characters.entries[0]).toMatchObject({ content: '[Topic: Bob\nspecies: Elf\n]', key: ['kept'] });
    expect(f.globalContext.callGenericPopup).not.toHaveBeenCalled();
    expect(f.request).not.toHaveBeenCalled();
    // Replace changes nothing in the chat, so it must not save or re-render it.
    expect(f.globalContext.saveChat).not.toHaveBeenCalled();
    expect(f.renderTrackerWithDeps).not.toHaveBeenCalled();
  });

  test('a host error is reported to the user instead of escaping', async () => {
    const f = makeFixture({ link: true });
    f.host.loadWorldInfo = async () => {
      throw new Error('host exploded');
    };
    await expect(f.actions.replaceLorebookEntry(0, 'scene')).resolves.toBeUndefined();
    expect(stEchoMock).toHaveBeenCalledWith('error', expect.stringContaining('host exploded'));
  });

  test('a missing entry writes nothing, says so, and offers Export as new', async () => {
    const f = makeFixture({ link: true });
    await f.actions.replaceLorebookEntry(0, 'scene');

    expect(f.host.saveWorldInfo).not.toHaveBeenCalled();
    expect(stEchoMock).toHaveBeenCalledWith('error', expect.stringContaining('no longer exists'));
    expect(f.globalContext.Popup.show.confirm).toHaveBeenCalled();
  });

  test('does nothing when there is no link', async () => {
    const f = makeFixture();
    await f.actions.replaceLorebookEntry(0, 'scene');
    expect(f.host.saveWorldInfo).not.toHaveBeenCalled();
  });
});
