/**
 * @jest-environment jsdom
 *
 * Debug harness that prints one live-like TOON prompt-engineering request using
 * the same `Bar`-style prompt stack observed in SillyTavern.
 */

export {};

const { PromptEngineeringMode } = await import('../src/config.js');
const { captureTrackerContext, expectLiveLikeTrackerContext, printCapturedTrackerContext } = await import(
  './debug-tracker-context-capture.js'
);

describe('debug tracker context toon', () => {
  test('prints one captured TOON-mode request payload', async () => {
    const captured = await captureTrackerContext(PromptEngineeringMode.TOON);

    printCapturedTrackerContext('TRACKER_CONTEXT_TOON', captured);
    expectLiveLikeTrackerContext(PromptEngineeringMode.TOON, captured);
  });
});
