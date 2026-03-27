/**
 * @jest-environment jsdom
 *
 * Debug harness that prints one live-like JSON prompt-engineering request using
 * the same `Bar`-style prompt stack observed in SillyTavern.
 */

export {};

const { PromptEngineeringMode } = await import('../src/config.js');
const { captureTrackerContext, expectLiveLikeTrackerContext, printCapturedTrackerContext } = await import(
  './debug-tracker-context-capture.js'
);

describe('debug tracker context json', () => {
  test('prints one captured JSON-mode request payload', async () => {
    const captured = await captureTrackerContext(PromptEngineeringMode.JSON);

    printCapturedTrackerContext('TRACKER_CONTEXT_JSON', captured);
    expectLiveLikeTrackerContext(PromptEngineeringMode.JSON, captured);
  });
});
