/**
 * Shared capture helpers for tracker-context debug harnesses and regression tests.
 * Keeping request assembly in one place prevents the scripts and automated checks from drifting.
 */

import { jest } from '@jest/globals';

if (!globalThis.structuredClone) {
	globalThis.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
}

const buildPromptMock = jest.fn<() => Promise<{ result: Array<Record<string, unknown>> }>>();
const getWorldInfosMock = jest.fn(() => []);
const stEchoMock = jest.fn();

jest.unstable_mockModule('sillytavern-utils-lib', () => ({
	buildPrompt: buildPromptMock,
	Generator: class GeneratorMock {},
	getWorldInfos: getWorldInfosMock,
	Message: class MessageMock {},
}));

jest.unstable_mockModule('sillytavern-utils-lib/config', () => ({
	characters: [{ avatar: 'alice.png' }],
	selected_group: false,
	st_echo: stEchoMock,
}));

jest.unstable_mockModule('sillytavern-utils-lib/types/popup', () => ({
	POPUP_RESULT: { AFFIRMATIVE: 'affirmative' },
	POPUP_TYPE: { CONFIRM: 'confirm' },
}));

const { createTrackerActions } = await import('../src/ui/tracker-actions.js');
const { PromptEngineeringMode } = await import('../src/config.js');
const {
	LIVE_BAR_PROFILE_ID,
	installLiveLikeSillyTavernContext,
	makeLiveLikePromptMessages,
	makeLiveLikeSettings,
} = await import('./debug-tracker-context-fixture.js');

/** One captured tracker-generation request plus the settings scenario used to produce it. */
export type CapturedTrackerContext = {
	scenario: {
		promptEngineeringMode: string;
		includeLastXMessages: number;
		includeLastXZTrackerMessages: number;
		trackerSystemPromptMode: string;
	};
	request: Record<string, unknown>;
};

type CapturedPromptMessage = {
	role: string;
	content: string;
	name?: string;
	ignoreInstruct?: boolean;
};

function formatPromptMessageForInspection(message: CapturedPromptMessage): string {
	if (typeof message.name === 'string' && message.name.trim()) {
		return `${message.name}: ${String(message.content)}`;
	}
	return String(message.content);
}

const MODE_SAMPLE_RESPONSE: Record<string, string> = {
	[PromptEngineeringMode.JSON]:
		'```json\n{"time":"09:13:00; 03/27/2026 (Friday)","location":"Atrium cafe, east window booth","summary":"Alice greets a newly arrived customer near the front entrance."}\n```',
	[PromptEngineeringMode.XML]:
		'```xml\n<scene><time>09:13:00; 03/27/2026 (Friday)</time><location>Atrium cafe, east window booth</location><summary>Alice greets a newly arrived customer near the front entrance.</summary></scene>\n```',
	[PromptEngineeringMode.TOON]:
		'```toon\ntime: "09:13:00; 03/27/2026 (Friday)"\nlocation: "Atrium cafe, east window booth"\nsummary: "Alice greets a newly arrived customer near the front entrance."\n```',
};

const EXPECTED_PROMPT_ROLES = ['system', 'system', 'system', 'assistant', 'user', 'system', 'assistant', 'user', 'system', 'system'];

/** Captures one live-like tracker-generation request for the requested prompt-engineering mode. */
export async function captureTrackerContext(mode: (typeof PromptEngineeringMode)[keyof typeof PromptEngineeringMode]): Promise<CapturedTrackerContext> {
	jest.clearAllMocks();
	document.body.innerHTML = '<div id="extensionsMenu"></div><div class="mes" mesid="0"><div class="mes_text"></div></div>';

	const settings = makeLiveLikeSettings(mode);
	const capturedRequests: Array<Record<string, unknown>> = [];

	installLiveLikeSillyTavernContext();

	buildPromptMock.mockResolvedValue({
		result: makeLiveLikePromptMessages(),
	});

	const generator = {
		abortRequest: jest.fn(),
		generateRequest: jest.fn(
			(
				request: Record<string, unknown>,
				hooks: { onStart: (requestId: string) => void; onFinish: (requestId: string, data: unknown, error: unknown) => void },
			) => {
				capturedRequests.push(structuredClone(request));
				hooks.onStart(`debug-request-${mode}`);
				hooks.onFinish(`debug-request-${mode}`, { content: MODE_SAMPLE_RESPONSE[mode] }, null);
			},
		),
	} as any;

	const actions = createTrackerActions({
		globalContext: {
			chat: [{ original_avatar: 'alice.png', extra: {} }],
			saveChat: jest.fn(async () => undefined),
			extensionSettings: {
				connectionManager: {
					profiles: [
						{
							id: LIVE_BAR_PROFILE_ID,
							api: 'openai',
							preset: 'openrouter nvidia/nemotron-3-nano-30b-a3b:free',
							context: 'default',
							instruct: 'default',
							sysprompt: 'Profile system prompt',
						},
					],
				},
			},
			CONNECT_API_MAP: { openai: { selected: 'openai' } },
		},
		settingsManager: {
			getSettings: () => settings,
		} as any,
		generator,
		pendingRequests: new Map(),
		renderTrackerWithDeps: jest.fn(),
		importMetaUrl: import.meta.url,
	});

	await actions.generateTracker(0);

	expect(capturedRequests).toHaveLength(1);

	return {
		scenario: {
			promptEngineeringMode: settings.promptEngineeringMode,
			includeLastXMessages: settings.includeLastXMessages,
			includeLastXZTrackerMessages: settings.includeLastXZTrackerMessages,
			trackerSystemPromptMode: settings.trackerSystemPromptMode,
		},
		request: capturedRequests[0],
	};
}

/** Verifies the common live-like prompt shape shared by the JSON, XML, and TOON harnesses. */
export function expectLiveLikeTrackerContext(
	mode: (typeof PromptEngineeringMode)[keyof typeof PromptEngineeringMode],
	captured: CapturedTrackerContext,
): void {
	const promptMessages = captured.request.prompt as Array<Record<string, unknown>>;

	expect(captured.scenario.promptEngineeringMode).toBe(mode);
	expect(captured.scenario.includeLastXMessages).toBe(4);
	expect(captured.scenario.includeLastXZTrackerMessages).toBe(2);
	expect(captured.scenario.trackerSystemPromptMode).toBe('saved');
	expect(promptMessages.map((message) => message.role)).toEqual(EXPECTED_PROMPT_ROLES);
	expect(promptMessages[0]).toEqual({
		role: 'system',
		content:
			'Bar is the narrator in a simple scenario. It narrates the action of the environment and the dialogue of character other than Tobias.\n',
		ignoreInstruct: true,
	});
	expect(promptMessages[5]).toEqual({
		role: 'system',
		content: expect.stringContaining('Scene details:\ntime: 14:23:07; 09/28/2025 (Tuesday)'),
	});
	expect(promptMessages[3]).toMatchObject({
		role: 'assistant',
		name: 'Bar',
	});
	expect(promptMessages[4]).toMatchObject({
		role: 'user',
		name: 'Tobias',
	});
	expect(promptMessages[6]).toMatchObject({
		role: 'assistant',
		name: 'Bar',
	});
	expect(promptMessages[7]).toMatchObject({
		role: 'user',
		name: 'Tobias',
	});
	expect(captured.request.profileId).toBe(LIVE_BAR_PROFILE_ID);
	expect(captured.request.maxTokens).toBe(16000);
	expect(captured.request.overridePayload).toEqual({});

	for (const promptMessage of promptMessages) {
		expect(promptMessage).not.toHaveProperty('zTrackerFound');
		expect(promptMessage).not.toHaveProperty('source');
		expect(promptMessage).not.toHaveProperty('is_user');
		expect(promptMessage).not.toHaveProperty('mes');
		expect(promptMessage).not.toHaveProperty('is_system');
	}

	const trackerInstruction = promptMessages[promptMessages.length - 1];
	expect(trackerInstruction.role).toBe('system');
	if (mode === PromptEngineeringMode.JSON) {
		expect(trackerInstruction.content).toEqual(expect.stringContaining('```json'));
		return;
	}
	if (mode === PromptEngineeringMode.XML) {
		expect(trackerInstruction.content).toEqual(expect.stringContaining('```xml'));
		expect(trackerInstruction.content).toEqual(expect.stringContaining('EXAMPLE OF A PERFECT RESPONSE'));
		return;
	}
	expect(trackerInstruction.content).toEqual(expect.stringContaining('```toon'));
	expect(trackerInstruction.content).toEqual(expect.stringContaining('EXAMPLE OF A PERFECT RESPONSE'));
}

/** Prints one captured request with stable start and end markers for manual inspection. */
export function printCapturedTrackerContext(marker: string, captured: CapturedTrackerContext): void {
	console.log(`${marker}_START`);
	console.log(JSON.stringify(captured, null, 2));
	console.log(`${marker}_END`);
}

/**
 * Mirrors the currently verified live tracker-generation transport more closely
 * by flattening prompt message contents into one raw text-completion prompt.
 * This intentionally drops role labels because the live JSON tracker request
 * observed in SillyTavern shipped a single `prompt` string without them.
 *
 * The active profile path also preserved blank-line boundaries between message
 * bodies, so this uses the same double-newline join SillyTavern falls back to
 * for text-completion prompts when no extra instruct wrapping is applied. When
 * the prompt carries explicit speaker names, those labels are preserved inline
 * so one-on-one chats still disambiguate "I" and "you" in the local artifact.
 */
export function flattenPromptMessagesForInspection(messages: CapturedPromptMessage[]): string {
	return messages.map((message) => formatPromptMessageForInspection(message)).join('\n\n');
}

/** Returns the plain-text inspection view for one captured tracker-generation request. */
export function flattenCapturedTrackerContext(captured: CapturedTrackerContext): string {
	return flattenPromptMessagesForInspection(captured.request.prompt as CapturedPromptMessage[]);
}