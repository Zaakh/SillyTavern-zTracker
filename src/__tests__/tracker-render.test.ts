/**
 * @jest-environment jsdom
 */

import Handlebars from 'handlebars';
import {
  renderTracker,
  CHAT_MESSAGE_SCHEMA_VALUE_KEY,
  CHAT_MESSAGE_SCHEMA_HTML_KEY,
  TrackerContext,
} from '../tracker.js';
import { EXTENSION_KEY } from '../extension-metadata.js';

describe('renderTracker', () => {
  const template = '<div class="tracker-content">{{data.time}}</div>';

  const createContext = (): TrackerContext => ({
    chat: [
      {
        extra: {
          [EXTENSION_KEY]: {
            [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: { time: '10:00' },
            [CHAT_MESSAGE_SCHEMA_HTML_KEY]: template,
          },
        },
      } as any,
    ],
  });

  beforeEach(() => {
    document.body.innerHTML = '<div class="mes" mesid="0"><div class="mes_text"></div></div>';
  });

  it('renders tracker markup before the message text', () => {
    const context = createContext();
    renderTracker(0, { context, document, handlebars: Handlebars });

    const tracker = document.querySelector('.mes_ztracker');
    expect(tracker).not.toBeNull();
    expect(tracker?.querySelector('.tracker-content')?.textContent).toBe('10:00');
    expect(tracker?.querySelector('.ztracker-controls')).not.toBeNull();
  });

  it('renders one clickable entry per array item in the parts menu', () => {
    const context: TrackerContext = {
      chat: [
        {
          extra: {
            [EXTENSION_KEY]: {
              [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: {
                time: '10:00',
                charactersPresent: ['Alice', 'Bob'],
              },
              [CHAT_MESSAGE_SCHEMA_HTML_KEY]: template,
            },
          },
        } as any,
      ],
    };

    renderTracker(0, { context, document, handlebars: Handlebars });

    const items = Array.from(
      document.querySelectorAll('.ztracker-array-item-regenerate-button[data-ztracker-part="charactersPresent"]'),
    ).map((el) => (el as HTMLElement).textContent);

    expect(items).toEqual(['Alice', 'Bob']);
  });

  it('removes previous tracker markup when data has been cleared', () => {
    const context = createContext();
    renderTracker(0, { context, document, handlebars: Handlebars });

    delete context.chat[0].extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY];
    renderTracker(0, { context, document, handlebars: Handlebars });

    expect(document.querySelector('.mes_ztracker')).toBeNull();
  });
});
