/**
 * Import-safe helpers that decide which connection/formatting settings a tracker-generation
 * request uses and how its reply is finished before parsing:
 * - `resolveEffectiveConnectionSettings` picks, per field, the saved profile's value or the live
 *   SillyTavern value (saved profiles fall back to live only for fields they do not record).
 * - `lookupFormattingObjects` turns the effective instruct/context names into preset objects.
 * - `applyPrefill` / `finishTrackerReply` implement Start Reply With and reasoning stripping.
 * Host lookups are passed in so every function here is unit-testable without SillyTavern.
 */

/** Reasoning block delimiters of a SillyTavern reasoning template. */
export type ReasoningTemplate = { name?: string; prefix: string; suffix: string };

type ProfileLike = Record<string, unknown>;

/** The slice of `SillyTavern.getContext()` the resolver reads. */
export type ConnectionSettingsHost = {
  getPresetManager?: (apiId?: string) => {
    getSelectedPresetName?: () => unknown;
    getCompletionPresetByName?: (name?: string) => unknown;
  } | null | undefined;
  getReasoningTemplateByName?: (name: string) => unknown;
  substituteParams?: (value: string) => string;
  powerUserSettings?: {
    instruct?: Record<string, unknown> | null;
    context?: Record<string, unknown> | null;
    custom_stopping_strings?: unknown;
    custom_stopping_strings_macro?: unknown;
    user_prompt_bias?: unknown;
    reasoning?: unknown;
  };
};

/** Fully resolved connection/formatting settings for one tracker request. */
export type EffectiveConnectionSettings = {
  source: 'profile' | 'live';
  /** Profile keys the saved profile did not record, so the live value was used instead. */
  fallbackFields: string[];
  presetName?: string;
  instructName?: string;
  instructEnabled: boolean;
  contextName?: string;
  stopStrings: string[];
  startReplyWith: string;
  reasoningTemplate?: ReasoningTemplate;
};

const asName = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

/** Parses a JSON-encoded string array setting; invalid input yields `[]` plus a warning. */
export function parseStopStrings(raw: unknown, substitute?: (value: string) => string): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    const strings = Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
    return substitute ? strings.map(substitute) : strings;
  } catch {
    console.warn('zTracker: ignoring custom stop strings that are not valid JSON.', raw);
    return [];
  }
}

const toReasoningTemplate = (value: unknown, name?: string): ReasoningTemplate | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const { prefix, suffix } = value as { prefix?: unknown; suffix?: unknown };
  return { ...(name ? { name } : {}), prefix: typeof prefix === 'string' ? prefix : '', suffix: typeof suffix === 'string' ? suffix : '' };
};

/**
 * Resolves the effective settings for one request. A saved profile is the only source for every
 * field it records (an explicitly empty Start Reply With / stop strings counts as recorded);
 * missing or excluded fields fall back to the live value, one field at a time.
 */
export function resolveEffectiveConnectionSettings(input: {
  connectionSource: 'active' | 'saved';
  profile?: ProfileLike;
  isTextCompletion: boolean;
  host: ConnectionSettingsHost;
}): EffectiveConnectionSettings {
  const { host, profile, isTextCompletion } = input;
  const usesProfile = input.connectionSource === 'saved' && !!profile;
  const power = host.powerUserSettings ?? {};
  const excluded = Array.isArray(profile?.exclude) ? (profile!.exclude as unknown[]) : [];
  const fallbackFields: string[] = [];

  const recorded = (key: string, allowEmpty = false): string | undefined => {
    const value = usesProfile && !excluded.includes(key) ? profile![key] : undefined;
    if (typeof value !== 'string') return undefined;
    return allowEmpty || value.trim() ? value : undefined;
  };
  const pick = <T>(key: string, fromProfile: T | undefined, live: () => T): T => {
    if (fromProfile !== undefined) return fromProfile;
    if (usesProfile) fallbackFields.push(key);
    return live();
  };

  const presetName = pick('preset', asName(recorded('preset')), () => asName(host.getPresetManager?.()?.getSelectedPresetName?.()));

  let instructName: string | undefined;
  let contextName: string | undefined;
  let instructEnabled = false;
  if (isTextCompletion) {
    instructName = pick('instruct', asName(recorded('instruct')), () => asName(power.instruct?.preset));
    contextName = pick('context', asName(recorded('context')), () => asName(power.context?.preset));
    const instructState = recorded('instruct-state');
    // An unset live flag counts as enabled: real hosts always store a boolean, and the wrapped
    // path historically formatted with instruct regardless of the flag.
    instructEnabled = pick('instruct-state', instructState === undefined ? undefined : instructState === 'true', () => power.instruct?.enabled !== false);
  }

  const macro = power.custom_stopping_strings_macro === true ? host.substituteParams : undefined;
  const stopStrings = parseStopStrings(
    pick('stop-strings', recorded('stop-strings', true), () => (typeof power.custom_stopping_strings === 'string' ? power.custom_stopping_strings : '')),
    macro,
  );
  const startReplyWith = pick('start-reply-with', recorded('start-reply-with', true), () => (typeof power.user_prompt_bias === 'string' ? power.user_prompt_bias : ''));

  let reasoningTemplate: ReasoningTemplate | undefined;
  const reasoningName = recorded('reasoning-template');
  if (reasoningName) {
    try {
      reasoningTemplate = toReasoningTemplate(host.getReasoningTemplateByName?.(reasoningName), reasoningName);
    } catch {
      // Unknown template name: handled by the live fallback below.
    }
  }
  if (!reasoningTemplate) {
    if (usesProfile) fallbackFields.push('reasoning-template');
    reasoningTemplate = toReasoningTemplate(power.reasoning, asName((power.reasoning as { name?: unknown } | undefined)?.name));
  }

  return {
    source: usesProfile ? 'profile' : 'live',
    fallbackFields,
    ...(presetName ? { presetName } : {}),
    ...(instructName ? { instructName } : {}),
    instructEnabled,
    ...(contextName ? { contextName } : {}),
    stopStrings,
    startReplyWith,
    ...(reasoningTemplate ? { reasoningTemplate } : {}),
  };
}

/**
 * Returns the instruct and context objects to format a Text Completion prompt with. Profile-sourced
 * names are looked up through the host preset managers; a failed lookup (or a name that already came
 * from the live settings) uses the live object, with a warning for the failed lookup.
 */
export function lookupFormattingObjects(
  effective: EffectiveConnectionSettings,
  host: ConnectionSettingsHost,
): { instruct?: Record<string, unknown>; context?: Record<string, unknown>; fallbackFields: string[] } {
  const fallbackFields: string[] = [];
  const resolve = (kind: 'instruct' | 'context', name: string | undefined, live: Record<string, unknown> | null | undefined) => {
    const fromProfile = effective.source === 'profile' && !!name && !effective.fallbackFields.includes(kind);
    if (!fromProfile) return live ?? undefined;
    const found = host.getPresetManager?.(kind)?.getCompletionPresetByName?.(name);
    if (found && typeof found === 'object') return found as Record<string, unknown>;
    console.warn(`zTracker: ${kind} preset "${name}" from the connection profile was not found; using the live ${kind} settings.`);
    fallbackFields.push(kind);
    return live ?? undefined;
  };

  return {
    instruct: resolve('instruct', effective.instructName, host.powerUserSettings?.instruct),
    context: resolve('context', effective.contextName, host.powerUserSettings?.context),
    fallbackFields,
  };
}

/** True when `prefill` opens a reasoning block (contains the prefix without a later suffix). */
export function leavesReasoningOpen(prefill: string, template?: ReasoningTemplate): boolean {
  if (!template?.prefix || !template.suffix) return false;
  const open = prefill.lastIndexOf(template.prefix);
  return open !== -1 && prefill.indexOf(template.suffix, open + template.prefix.length) === -1;
}

/**
 * Appends the Start Reply With text as a trailing assistant message. The prefill is omitted when a
 * structured-output schema is sent and the prefill would leave a reasoning block open, because
 * grammar-constrained output can never close it.
 */
export function applyPrefill<T extends { role: string; content: string }>(
  messages: T[],
  options: { prefill: string; jsonSchemaSent: boolean; reasoningTemplate?: ReasoningTemplate },
): { messages: T[]; prefill: string; omitted: boolean } {
  const { prefill } = options;
  if (!prefill) return { messages, prefill: '', omitted: false };
  if (options.jsonSchemaSent && leavesReasoningOpen(prefill, options.reasoningTemplate)) {
    return { messages, prefill: '', omitted: true };
  }
  return { messages: [...messages, { role: 'assistant', content: prefill } as T], prefill, omitted: false };
}

type ReasoningParser = (text: string, options: { strict: boolean }, template: ReasoningTemplate) => { reasoning: string; content: string } | null;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Local equivalent of the host's strict `parseReasoningFromString`, used when the host lacks it. */
const parseReasoningLocally: ReasoningParser = (text, _options, template) => {
  const match = new RegExp(`^\\s*?${escapeRegex(template.prefix)}(.*?)${escapeRegex(template.suffix)}`, 's').exec(text);
  return match ? { reasoning: match[1].trim(), content: text.slice(match[0].length).trim() } : { reasoning: '', content: text };
};

/** Replies flagged by `finishTrackerReply` as starting with a reasoning block that never closed. */
const unclosedReasoningReplies = new WeakSet<object>();

export const UNCLOSED_REASONING_ERROR =
  "Tracker reply contains an unclosed reasoning block. Increase the Module's max response tokens or use a non-reasoning profile.";

export function markUnclosedReasoningReply(reply: object): void {
  unclosedReasoningReplies.add(reply);
}

export function isUnclosedReasoningReply(reply: unknown): boolean {
  return typeof reply === 'object' && reply !== null && unclosedReasoningReplies.has(reply);
}

/**
 * Turns a raw model reply into parser input: puts the sent prefill back (only when the backend did
 * not already include it, did not split out the reasoning an opening prefill started, and no schema
 * constrained the output),
 * then strips a leading reasoning block. A reply that opens a reasoning block without closing it is
 * returned without the opening prefix and flagged, so the parser decides whether it is still usable.
 */
export function finishTrackerReply(
  reply: { content: string; reasoning?: unknown },
  options: { prefill: string; jsonSchemaSent: boolean; reasoningTemplate?: ReasoningTemplate; parseReasoning?: ReasoningParser },
): { content: string; unclosedReasoning: boolean } {
  let text = reply.content;
  const { prefill, reasoningTemplate } = options;

  // Only an opening reasoning prefill is moot when the backend split reasoning out; a plain prefill like `{` is still the start of the content.
  const reasoningSplitOut = typeof reply.reasoning === 'string' && reply.reasoning.trim().length > 0 && leavesReasoningOpen(prefill, reasoningTemplate);
  if (prefill && !options.jsonSchemaSent && !reasoningSplitOut && !text.trimStart().startsWith(prefill.trim())) {
    text = prefill + text;
  }

  if (!reasoningTemplate?.prefix || !reasoningTemplate.suffix) return { content: text, unclosedReasoning: false };

  const parsed = (options.parseReasoning ?? parseReasoningLocally)(text, { strict: true }, reasoningTemplate);
  if (parsed && parsed.content !== text) return { content: parsed.content, unclosedReasoning: false };

  const leading = text.trimStart();
  const prefix = reasoningTemplate.prefix.trimStart();
  if (leading.startsWith(prefix)) return { content: leading.slice(prefix.length), unclosedReasoning: true };
  return { content: text, unclosedReasoning: false };
}
