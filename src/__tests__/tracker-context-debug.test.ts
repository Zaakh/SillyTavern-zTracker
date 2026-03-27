/**
 * @jest-environment jsdom
 *
 * Regression coverage for the live-like tracker-context debug harnesses.
 * These checks ensure the reusable harness stays aligned across JSON, XML, and TOON modes.
 */

const { PromptEngineeringMode } = await import('../config.js');
const { captureTrackerContext, expectLiveLikeTrackerContext } = await import('../../scripts/debug-tracker-context-capture.js');

describe('tracker-context debug harness parity', () => {
	test.each([
		PromptEngineeringMode.JSON,
		PromptEngineeringMode.XML,
		PromptEngineeringMode.TOON,
	])('captures the live-like prompt shape for %s mode', async (mode) => {
		const captured = await captureTrackerContext(mode);

		expectLiveLikeTrackerContext(mode, captured);
	});
});