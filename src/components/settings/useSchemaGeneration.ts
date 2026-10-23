/**
 * State and actions behind the Schema editor's "Generate schema" (Quick and Advanced) and "Generate
 * prompts" (Advanced-only) buttons (openspec: add-llm-schema-generation, add-llm-action-dialog). A
 * Quick run is bound to the Module and schema preset selected when it started: a selection change
 * aborts it and its result is discarded, and a cancel aborts the whole run (loop included), leaving
 * draft and Module untouched. Advanced runs live in the modal LLM action dialog and write nothing
 * until Apply.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PLACEHOLDER_PROMPT, type PromptEngineeringMode, type TrackerModule } from '../../config.js';
import { getStarterGenerationExamples } from '../../generation-examples.js';
import { isAbortError, resolveInstruction, type OverrideStore } from '../../llm-actions.js';
import {
  DEFAULT_PROMPTS_INSTRUCTIONS,
  DEFAULT_SCHEMA_INSTRUCTION,
  generatePromptsFromBrief,
  generateSchemaFromBrief,
  getGeneratedPresetName,
  type GenerationRequest,
  type SchemaGenerationResult,
} from '../../schema-generation.js';
import { hasSystemPromptPreset } from '../../system-prompt.js';
import { openLlmActionDialog } from '../../ui/llm-action-dialog.js';

const SCHEMA_OVERRIDE_ID = 'schema';
const PROMPTS_SYSTEM_OVERRIDE_ID = 'prompts-system';
const PROMPTS_BASE_OVERRIDE_ID = 'prompts-base';

export interface GeneratedPrompts {
  systemPrompt: string;
  prompt: string;
}

export interface SchemaGenerationOptions {
  module: TrackerModule;
  schemaPresetKey: string;
  schemaText: string;
  schemaDraftIsValid: boolean;
  promptEngineeringMode: PromptEngineeringMode;
  grammarEnforcementEnabled: boolean;
  setSchemaText: (text: string) => void;
  /** Persists the generated prompts and preset for the captured Module id; rejects without modifying anything on failure. */
  applyGeneratedPrompts: (moduleId: string, result: GeneratedPrompts) => Promise<void>;
  requestWithActiveConnection: (
    messages: Array<{ role: string; content: string }>,
    overridePayload?: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<string>;
  /** Where edited system prompts are kept (the extension settings manager). */
  overrideStore: OverrideStore;
  /** "API · model" of the active connection, shown in the Advanced dialogs. */
  activeConnectionLabel: string;
}

interface Run {
  moduleId: string;
  schemaPresetKey: string;
  runId: number;
  controller: AbortController;
}

export interface GenerationStatus {
  error?: string;
  info?: string;
  /** Set after a schema generation, until the next one: the HTML draft no longer matches the schema. */
  showHtmlHint?: boolean;
}

function noSchemaError(attempts: number): string {
  return `No usable schema was produced after ${attempts} attempt(s); a reply may have been cut off by the response length limit. The Schema JSON draft is unchanged.`;
}

function schemaStatus(result: SchemaGenerationResult): GenerationStatus {
  const remaining = result.findings.some((finding) => finding.severity !== 'info');
  return {
    error: result.error ? `A repair request failed (${result.error}); the best earlier attempt was kept.` : undefined,
    info: `Schema draft generated in ${result.attempts} attempt(s)${remaining ? '; remaining findings are listed below the Schema JSON.' : '.'} Not saved yet.`,
    showHtmlHint: true,
  };
}

export function useSchemaGeneration(options: SchemaGenerationOptions) {
  const { module, schemaPresetKey } = options;
  const [run, setRun] = useState<Run | null>(null);
  const [statuses, setStatuses] = useState<Record<string, GenerationStatus>>({});
  const runRef = useRef<Run | null>(null);
  const nextRunId = useRef(0);
  // Latest props for the async completion handlers, which outlive the render that started them.
  const latest = useRef({ moduleId: module.id, schemaPresetKey });
  latest.current = { moduleId: module.id, schemaPresetKey };

  const examples = useMemo(() => getStarterGenerationExamples(), []);
  const brief = module.designBrief ?? '';
  const isRunning = !!run && run.moduleId === module.id;

  const setStatus = useCallback((moduleId: string, status: GenerationStatus) => {
    setStatuses((current) => ({ ...current, [moduleId]: status }));
  }, []);

  const endRun = useCallback((finished: Run) => {
    if (runRef.current === finished) {
      runRef.current = null;
      setRun(null);
    }
  }, []);

  const cancel = useCallback(() => {
    runRef.current?.controller.abort();
  }, []);

  // A Module or preset switch aborts the run; its result is then discarded by the guard in start().
  useEffect(() => {
    const active = runRef.current;
    if (active && (active.moduleId !== module.id || active.schemaPresetKey !== schemaPresetKey)) {
      active.controller.abort();
    }
  }, [module.id, schemaPresetKey]);

  useEffect(() => () => runRef.current?.controller.abort(), []);

  const start = useCallback(
    async (work: (request: GenerationRequest, signal: AbortSignal, isCurrent: () => boolean) => Promise<GenerationStatus>) => {
      if (runRef.current) return;
      const started: Run = {
        moduleId: module.id,
        schemaPresetKey,
        runId: (nextRunId.current += 1),
        controller: new AbortController(),
      };
      runRef.current = started;
      setRun(started);
      setStatus(started.moduleId, {});

      const { signal } = started.controller;
      const request: GenerationRequest = (messages, overridePayload) =>
        options.requestWithActiveConnection(messages, overridePayload, signal);
      const stillCurrent = () =>
        !signal.aborted &&
        runRef.current === started &&
        latest.current.moduleId === started.moduleId &&
        latest.current.schemaPresetKey === started.schemaPresetKey;

      try {
        const status = await work(request, signal, stillCurrent);
        if (stillCurrent()) setStatus(started.moduleId, status);
      } catch (error) {
        // Cancelled or switched away: leave draft, Module and status untouched.
        if (!isAbortError(error) && !signal.aborted) {
          setStatus(started.moduleId, { error: error instanceof Error ? error.message : String(error) });
        }
      } finally {
        endRun(started);
      }
    },
    // The option callbacks are re-read through `options` on each click; the run itself needs only the captured ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [module.id, schemaPresetKey, options.requestWithActiveConnection, endRun, setStatus],
  );

  /** Quick: one run with the saved instruction that fills the Schema JSON draft. */
  const generateSchema = useCallback(() => {
    if (!brief.trim()) return;
    void start(async (request, signal, isCurrent) => {
      const result = await generateSchemaFromBrief({
        brief,
        mode: options.promptEngineeringMode,
        grammarEnabled: options.grammarEnforcementEnabled,
        examples,
        request,
        signal,
        instruction: resolveInstruction(options.overrideStore, SCHEMA_OVERRIDE_ID, DEFAULT_SCHEMA_INSTRUCTION),
      });
      if (!result.parsed || !result.schema) return { error: noSchemaError(result.attempts) };
      // Guard before writing: a switch during the last request must not touch the new selection's draft.
      if (!isCurrent()) return {};
      options.setSchemaText(JSON.stringify(result.schema, null, 2));
      return schemaStatus(result);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, examples, start, options.promptEngineeringMode, options.grammarEnforcementEnabled, options.setSchemaText, options.overrideStore]);

  /** Advanced: the dialog previews the schema; the draft changes only on Apply. */
  const generateSchemaAdvanced = useCallback(() => {
    if (!brief.trim() || runRef.current) return;
    const moduleId = module.id;
    void openLlmActionDialog(SillyTavern.getContext().callGenericPopup, {
      title: 'Generate schema',
      parts: [{ id: SCHEMA_OVERRIDE_ID, label: 'Schema', defaultInstruction: DEFAULT_SCHEMA_INSTRUCTION }],
      store: options.overrideStore,
      connectionLabel: options.activeConnectionLabel,
      run: async ([instruction], signal) => {
        const result = await generateSchemaFromBrief({
          brief,
          mode: options.promptEngineeringMode,
          grammarEnabled: options.grammarEnforcementEnabled,
          examples,
          request: (messages, overridePayload) => options.requestWithActiveConnection(messages, overridePayload, signal),
          signal,
          instruction,
        });
        if (!result.parsed || !result.schema) throw new Error(noSchemaError(result.attempts));
        return [JSON.stringify(result.schema, null, 2)];
      },
      apply: ([text]) => {
        try {
          JSON.parse(text);
        } catch {
          throw new Error('The previewed schema is not valid JSON.');
        }
        options.setSchemaText(text);
        setStatus(moduleId, { info: 'Schema draft applied. Not saved yet.', showHtmlHint: true });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, examples, module.id, setStatus, options.promptEngineeringMode, options.grammarEnforcementEnabled, options.setSchemaText, options.overrideStore, options.activeConnectionLabel]);

  const replacesPrompts =
    (!!module.prompts.prompt.trim() && module.prompts.prompt !== PLACEHOLDER_PROMPT) ||
    !!module.systemPrompt.content?.trim() ||
    hasSystemPromptPreset(getGeneratedPresetName(module.id));

  /** Advanced-only: two prompts previewed side by side; Module and preset change only on Apply. */
  const generatePromptsAdvanced = useCallback(() => {
    if (!brief.trim() || !options.schemaDraftIsValid || runRef.current) return;
    const moduleId = module.id;
    const schema = JSON.parse(options.schemaText);
    void openLlmActionDialog(SillyTavern.getContext().callGenericPopup, {
      title: 'Generate prompts',
      parts: [
        { id: PROMPTS_SYSTEM_OVERRIDE_ID, label: 'System prompt', defaultInstruction: DEFAULT_PROMPTS_INSTRUCTIONS.system },
        { id: PROMPTS_BASE_OVERRIDE_ID, label: 'Base prompt', defaultInstruction: DEFAULT_PROMPTS_INSTRUCTIONS.base },
      ],
      store: options.overrideStore,
      connectionLabel: options.activeConnectionLabel,
      applyNotice: replacesPrompts
        ? 'Apply overwrites this Module’s prompt text and generated preset immediately.'
        : 'Apply saves the prompts and a system prompt preset immediately.',
      run: async ([system, base], signal, onProgress) => {
        const result = await generatePromptsFromBrief({
          brief,
          schema,
          examples,
          request: (messages, overridePayload) => options.requestWithActiveConnection(messages, overridePayload, signal),
          signal,
          instructions: { system, base },
          onProgress,
        });
        return [result.systemPrompt, result.prompt];
      },
      apply: async ([systemPrompt, prompt]) => {
        await options.applyGeneratedPrompts(moduleId, { systemPrompt, prompt });
        setStatus(moduleId, { info: 'Prompts applied (system prompt preset saved).' });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, module.id, examples, replacesPrompts, setStatus, options.schemaDraftIsValid, options.schemaText, options.applyGeneratedPrompts, options.overrideStore, options.activeConnectionLabel]);

  return {
    brief,
    isRunning,
    status: statuses[module.id] ?? {},
    canGenerateSchema: !!brief.trim() && !run,
    canGeneratePrompts: !!brief.trim() && options.schemaDraftIsValid && !run,
    replacesDraft: options.schemaText.trim().length > 0,
    generateSchema,
    generateSchemaAdvanced,
    generatePromptsAdvanced,
    cancel,
  };
}
