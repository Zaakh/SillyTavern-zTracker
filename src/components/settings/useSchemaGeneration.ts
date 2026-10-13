/**
 * State and actions behind the Schema editor's "Generate schema" / "Generate prompts" buttons
 * (openspec: add-llm-schema-generation 5.1-5.3). A run is bound to the Module and schema preset
 * selected when it started: a selection change aborts it and its result is discarded, and a
 * cancel aborts the whole run (loop included), leaving draft and Module untouched.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PLACEHOLDER_PROMPT, type PromptEngineeringMode, type TrackerModule } from '../../config.js';
import { getStarterGenerationExamples } from '../../generation-examples.js';
import {
  generatePromptsFromBrief,
  generateSchemaFromBrief,
  getGeneratedPresetName,
  type GenerationRequest,
} from '../../schema-generation.js';
import { hasSystemPromptPreset } from '../../system-prompt.js';

export type GenerationKind = 'schema' | 'prompts';

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
}

interface Run {
  kind: GenerationKind;
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

function isAbortError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'AbortError';
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
    async (
      kind: GenerationKind,
      work: (request: GenerationRequest, signal: AbortSignal, isCurrent: () => boolean) => Promise<GenerationStatus>,
    ) => {
      if (runRef.current) return;
      const started: Run = {
        kind,
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

  const generateSchema = useCallback(() => {
    if (!brief.trim()) return;
    void start('schema', async (request, signal, isCurrent) => {
      const result = await generateSchemaFromBrief({
        brief,
        mode: options.promptEngineeringMode,
        grammarEnabled: options.grammarEnforcementEnabled,
        examples,
        request,
        signal,
      });
      if (!result.parsed || !result.schema) {
        return {
          error: `No usable schema was produced after ${result.attempts} attempt(s); a reply may have been cut off by the response length limit. The Schema JSON draft is unchanged.`,
        };
      }
      // Guard before writing: a switch during the last request must not touch the new selection's draft.
      if (!isCurrent()) return {};
      options.setSchemaText(JSON.stringify(result.schema, null, 2));
      const remaining = result.findings.some((finding) => finding.severity !== 'info');
      return {
        error: result.error ? `A repair request failed (${result.error}); the best earlier attempt was kept.` : undefined,
        info: `Schema draft generated in ${result.attempts} attempt(s)${remaining ? '; remaining findings are listed below the Schema JSON.' : '.'} Not saved yet.`,
        showHtmlHint: true,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, examples, start, options.promptEngineeringMode, options.grammarEnforcementEnabled, options.setSchemaText]);

  const generatePrompts = useCallback(() => {
    if (!brief.trim() || !options.schemaDraftIsValid) return;
    const moduleId = module.id;
    void start('prompts', async (request, signal, isCurrent) => {
      const schema = JSON.parse(options.schemaText);
      const result = await generatePromptsFromBrief({ brief, schema, examples, request, signal });
      if (!isCurrent()) return {};
      await options.applyGeneratedPrompts(moduleId, result);
      return { info: 'Prompts generated and applied immediately (system prompt preset saved).' };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, module.id, examples, start, options.schemaDraftIsValid, options.schemaText, options.applyGeneratedPrompts]);

  const replacesPrompts =
    (!!module.prompts.prompt.trim() && module.prompts.prompt !== PLACEHOLDER_PROMPT) ||
    !!module.systemPrompt.content?.trim() ||
    hasSystemPromptPreset(getGeneratedPresetName(module.id));

  return {
    brief,
    isRunning,
    runningKind: isRunning ? run?.kind : undefined,
    status: statuses[module.id] ?? {},
    canGenerateSchema: !!brief.trim() && !run,
    canGeneratePrompts: !!brief.trim() && options.schemaDraftIsValid && !run,
    replacesDraft: options.schemaText.trim().length > 0,
    replacesPrompts,
    generateSchema,
    generatePrompts,
    cancel,
  };
}
