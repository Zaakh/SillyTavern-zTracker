/**
 * Shared logic for LLM content buttons (openspec: add-llm-action-dialog): persisted, resettable
 * system-prompt overrides and `runLlmAction` for single-request generators (lorebook title/keys).
 * Import-safe: the model call is injected as `request`, the settings store as `OverrideStore`.
 */
import type { GenerationMessage } from './schema-generation.js';

/** Minimal slice of the settings manager that override helpers need. */
export interface OverrideStore {
  getSettings(): { promptOverrides?: Record<string, string> };
  saveSettings(): void;
}

/** True for the error thrown when a request is cancelled. */
export function isAbortError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'AbortError';
}

/** One single-request generator: its default instruction, request builder and reply parser. */
export interface LlmAction<Input, Result> {
  id: string;
  defaultInstruction: string;
  buildMessages(instruction: string, input: Input): GenerationMessage[];
  parse(reply: string): Result;
}

/** The saved instruction for `id`, or the shipped default. */
export function resolveInstruction(store: OverrideStore, id: string, defaultInstruction: string): string {
  const saved = store.getSettings().promptOverrides?.[id];
  return saved && saved.trim() ? saved : defaultInstruction;
}

/** Stores `text` as the override; a blank text or one equal to the default removes it. Saves only on change. */
export function saveOverride(store: OverrideStore, id: string, defaultInstruction: string, text: string): void {
  const settings = store.getSettings();
  const overrides = (settings.promptOverrides ??= {});
  const next = text.trim() && text !== defaultInstruction ? text : undefined;
  if (overrides[id] === next) return;
  if (next === undefined) delete overrides[id];
  else overrides[id] = next;
  store.saveSettings();
}

/** Sends one request with `instruction` (empty means the default) and parses the reply; throws on failure or abort. */
export async function runLlmAction<Input, Result>(
  action: LlmAction<Input, Result>,
  options: {
    instruction: string;
    input: Input;
    request: (messages: GenerationMessage[], overridePayload?: Record<string, unknown>, signal?: AbortSignal) => Promise<string>;
    signal?: AbortSignal;
  },
): Promise<Result> {
  const { input, request, signal } = options;
  const instruction = options.instruction.trim() ? options.instruction : action.defaultInstruction;
  if (signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError');
  const reply = await request(action.buildMessages(instruction, input), undefined, signal);
  if (signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError');
  return action.parse(reply);
}
