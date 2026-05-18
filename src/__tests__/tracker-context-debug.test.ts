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
	summarizeCapturedPrompt,
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
		expect(flattenedPrompt).toContain('Tobias: I would like an iced tea and a quiet seat near the wall while I keep an eye on the room.\n\nScene details:');
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

	test('renders a live-like TOON prompt with fallback format/default hints and zTracker metadata when custom schema fields need them', async () => {
		const captured = await captureTrackerContext(PromptEngineeringMode.TOON, {
			schemaValue: {
				type: 'object',
				properties: {
					timestamp: { type: 'string', format: 'date-time', default: '2026-05-18T12:00:00Z' },
					describedTimestamp: {
						type: 'string',
						format: 'date-time',
						default: '2026-05-18T12:00:00Z',
						description: 'ISO 8601 timestamp',
					},
					items: {
						type: 'array',
						'x-ztracker-idKey': 'id',
						'x-ztracker-dependsOn': ['timestamp'],
						items: {
							type: 'object',
							properties: {
								id: { type: 'string', default: 'item-1' },
							},
						},
					},
				},
				required: ['timestamp', 'items'],
			},
		});

		const instruction = (captured.request.prompt as Array<{ role: string; content: string }>).at(-1)?.content ?? '';

		expect(instruction).toContain('format: date-time');
		expect(instruction).toContain('default: "2026-05-18T12:00:00Z"');
		expect(instruction).toContain('"x-ztracker-idKey": id');
		expect(instruction).toContain('"x-ztracker-dependsOn"[1');
		expect(instruction).not.toContain('describedTimestamp:\n    format: date-time');
		expect(instruction).not.toContain('describedTimestamp:\n    default: 2026-05-18T12:00:00Z');
	});

	test('keeps the live-like TOON prompt materially leaner than the JSON variant', async () => {
		const jsonCaptured = await captureTrackerContext(PromptEngineeringMode.JSON);
		const toonCaptured = await captureTrackerContext(PromptEngineeringMode.TOON);

		const jsonPrompt = summarizeCapturedPrompt(jsonCaptured as any);
		const toonPrompt = summarizeCapturedPrompt(toonCaptured as any);

		expect(toonPrompt.totalPromptChars).toBeLessThan(jsonPrompt.totalPromptChars - 400);
		expect(toonPrompt.totalPromptEstimatedTokens).toBeLessThan(jsonPrompt.totalPromptEstimatedTokens - 80);
		expect(toonPrompt.lastSystemChars).toBeLessThan(jsonPrompt.lastSystemChars - 400);
		expect(toonPrompt.lastSystemEstimatedTokens).toBeLessThan(jsonPrompt.lastSystemEstimatedTokens - 80);
		expect(toonPrompt.lastSystemChars).toBeLessThan(3600);
	});
});
