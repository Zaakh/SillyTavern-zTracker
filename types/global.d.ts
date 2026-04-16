// Ensure SillyTavern global typings are available project-wide.
// The sillytavern-utils-lib package declares the global `SillyTavern` in its d.ts; this import makes
// those declarations visible even in files that don’t import the lib directly.
export {};
import 'sillytavern-utils-lib';

declare module '/scripts/power-user.js' {
	export function renderStoryString(
		params: Record<string, unknown>,
		options?: {
			customStoryString?: string | null;
			customInstructSettings?: Record<string, unknown> | null;
			customContextSettings?: Record<string, unknown> | null;
		},
	): string;
}

declare module '/scripts/instruct-mode.js' {
	export function formatInstructModeStoryString(
		storyString: string,
		options?: {
			customContext?: Record<string, unknown> | null;
			customInstruct?: Record<string, unknown> | null;
		},
	): string;

	export function getInstructStoppingSequences(options?: {
		customInstruct?: Record<string, unknown> | null;
		useStopStrings?: boolean;
	}): string[];
}
