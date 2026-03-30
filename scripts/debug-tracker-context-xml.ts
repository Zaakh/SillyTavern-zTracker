/**
 * @jest-environment jsdom
 *
 * Debug harness that prints one live-like XML prompt-engineering request using
 * the same `Bar`-style prompt stack observed in SillyTavern.
 */

export {};

const { PromptEngineeringMode } = await import('../src/config.js');
const { captureTrackerContext, expectLiveLikeTrackerContext, printCapturedTrackerContext } = await import(
  './debug-tracker-context-capture.js'
);

describe('debug tracker context xml', () => {
  test('prints one captured XML-mode request payload', async () => {
    const captured = await captureTrackerContext(PromptEngineeringMode.XML);

    printCapturedTrackerContext('TRACKER_CONTEXT_XML', captured);
    expectLiveLikeTrackerContext(PromptEngineeringMode.XML, captured);
  });
});
