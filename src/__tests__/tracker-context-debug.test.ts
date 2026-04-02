/**
 * @jest-environment jsdom
 *
 * Regression coverage for the live-like tracker-context debug harnesses.
 * These checks ensure the reusable harness stays aligned across JSON, XML, and TOON modes.
 */

const { PromptEngineeringMode } = await import('../config.js');
const {
	captureTrackerContext,
	expectLiveLikeTrackerContext,
	flattenCapturedTrackerContext,
} = await import('../../scripts/debug-tracker-context-capture.js');

describe('tracker-context debug harness parity', () => {
	test.each([
		PromptEngineeringMode.JSON,
		PromptEngineeringMode.XML,
		PromptEngineeringMode.TOON,
	])('captures the live-like prompt shape for %s mode', async (mode) => {
		const captured = await captureTrackerContext(mode);

		expectLiveLikeTrackerContext(mode, captured);
	});

	test.each([
		PromptEngineeringMode.JSON,
		PromptEngineeringMode.XML,
		PromptEngineeringMode.TOON,
	])('builds the plain-text inspection prompt for %s mode', async (mode) => {
		const captured = await captureTrackerContext(mode);
		const flattenedPrompt = flattenCapturedTrackerContext(captured);

		expect(flattenedPrompt).toContain('Bar is the narrator in a simple scenario.');
		expect(flattenedPrompt).toContain('Bar is the narrator in a simple scenario. It narrates the action of the environment and the dialogue of character other than Tobias.\n\n\nThe interior of the bar is cozy and inviting.');
		expect(flattenedPrompt).toContain('The interior of the bar is cozy and inviting.');
		expect(flattenedPrompt).toContain('Bar: As you enter the bar you realize you are the only customer.');
		expect(flattenedPrompt).toContain('Bar: As you enter the bar you realize you are the only customer. The barkeeper greets you: "Hello I am Silvia, what can I get you?"\n\nTobias: "Just checking the room for a moment."');
		expect(flattenedPrompt).toContain('Tobias: I would like an iced tea and a quiet seat near the wall while I keep an eye on the room.');
		expect(flattenedPrompt).toContain('Tobias: I would like an iced tea and a quiet seat near the wall while I keep an eye on the room.\n\n[zTracker scene-state context; not dialogue]');
		expect(flattenedPrompt).toContain('[zTracker scene-state context; not dialogue]\nScene details:');
		expect(flattenedPrompt).toContain('Scene details:');
		expect(flattenedPrompt).not.toContain('Tobias: Scene details:');
		expect(flattenedPrompt).not.toContain('System:\n');
		if (mode === PromptEngineeringMode.JSON) {
			expect(flattenedPrompt).toContain('single, valid JSON object');
			return;
		}
		if (mode === PromptEngineeringMode.XML) {
			expect(flattenedPrompt).toContain('single, valid XML structure');
			return;
		}
		expect(flattenedPrompt).toContain('single, valid TOON structure');
	});
});