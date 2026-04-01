import Handlebars from 'handlebars';
import type { Message } from 'sillytavern-utils-lib';
import type { ExtractedData } from 'sillytavern-utils-lib/types';
import type { ExtensionSettings } from '../config.js';
import { PromptEngineeringMode } from '../config.js';
import { parseResponse } from '../parser.js';
import { schemaToExample, schemaToPromptSchema } from '../schema-to-example.js';

/** Defines the supported prompt-engineering payload formats for tracker generation. */
export type PromptEngineeredFormat = 'json' | 'xml' | 'toon';

/** Stores the raw prompt-engineered payload beside its parsed object for later rollback diagnostics. */
type PromptEngineeredPayloadRecord = {
  format: PromptEngineeredFormat;
  rawContent: string;
  parsedContent?: object;
};

/** Represents the tracker request callback used by prompt-engineered generation flows. */
type PromptEngineeredRequest = (
  requestMessages: Message[],
  overideParams?: any,
) => Promise<ExtractedData | undefined>;

/**
 * Encapsulates prompt-engineering request assembly and malformed-payload diagnostics.
 * A dedicated helper keeps tracker-actions focused on action orchestration rather than payload bookkeeping.
 */
export function createPromptEngineeringHelpers() {
  const promptEngineeredPayloads = new WeakMap<object, PromptEngineeredPayloadRecord>();

  /** Maps the configured prompt-engineering mode to the corresponding response parser format. */
  function getPromptEngineeredFormat(mode: PromptEngineeringMode): PromptEngineeredFormat | undefined {
    switch (mode) {
      case PromptEngineeringMode.JSON:
        return 'json';
      case PromptEngineeringMode.XML:
        return 'xml';
      case PromptEngineeringMode.TOON:
        return 'toon';
      default:
        return undefined;
    }
  }

  /** Selects the prompt template that matches the currently requested prompt-engineering format. */
  function getPromptEngineeringTemplate(settings: ExtensionSettings, format: PromptEngineeredFormat): string {
    switch (format) {
      case 'xml':
        return settings.promptXml;
      case 'toon':
        return settings.promptToon;
      default:
        return settings.promptJson;
    }
  }

  /** Logs malformed or rollback-bound prompt-engineered payloads so broken model output stays inspectable. */
  function logMalformedPromptEngineeredPayload(details: {
    format: PromptEngineeredFormat;
    reason: 'parse failure' | 'render rollback';
    rawContent: string;
    parsedContent?: object;
    error?: unknown;
  }): void {
    const { format, reason, rawContent, parsedContent, error } = details;
    console.warn('zTracker: malformed prompt-engineered payload', {
      format,
      reason,
      rawContent,
      ...(parsedContent ? { parsedContent } : {}),
      ...(error instanceof Error ? { error: error.message } : error ? { error: String(error) } : {}),
    });
  }

  /** Associates a parsed tracker object with the raw model payload that produced it. */
  function rememberPromptEngineeredPayload(parsedContent: object, payload: PromptEngineeredPayloadRecord): object {
    promptEngineeredPayloads.set(parsedContent, payload);
    return parsedContent;
  }

  /** Logs the raw model payload when a parsed prompt-engineered tracker fails strict rendering later on. */
  function logPromptEngineeredRenderRollback(parsedContent: unknown, error: unknown): void {
    if (!parsedContent || typeof parsedContent !== 'object') {
      return;
    }

    const payload = promptEngineeredPayloads.get(parsedContent as object);
    if (!payload) {
      return;
    }

    logMalformedPromptEngineeredPayload({
      format: payload.format,
      reason: 'render rollback',
      rawContent: payload.rawContent,
      parsedContent: payload.parsedContent,
      error,
    });
  }

  /** Builds a prompt-engineered request, parses the response, and preserves the raw payload for diagnostics. */
  async function requestPromptEngineeredResponse(
    makeRequest: PromptEngineeredRequest,
    requestMessages: Message[],
    settings: ExtensionSettings,
    schema: object,
    suffix = '',
  ): Promise<object> {
    const format = getPromptEngineeredFormat(settings.promptEngineeringMode);
    if (!format) {
      throw new Error(`Unsupported prompt-engineering mode: ${settings.promptEngineeringMode}`);
    }

    const promptTemplate = getPromptEngineeringTemplate(settings, format);
    const exampleResponse = schemaToExample(schema, format);
    const promptSchema = schemaToPromptSchema(schema, format);
    const finalPrompt = Handlebars.compile(promptTemplate, { noEscape: true, strict: true })({
      schema: promptSchema,
      example_response: exampleResponse,
    });

    requestMessages.push({ content: `${finalPrompt}${suffix}`, role: 'user' });

    const response = await makeRequest(requestMessages);
    if (!response?.content) {
      throw new Error('No response content received.');
    }

    try {
      const parsedContent = parseResponse(response.content as string, format, { schema });
      return rememberPromptEngineeredPayload(parsedContent, {
        format,
        rawContent: response.content as string,
        parsedContent,
      });
    } catch (error) {
      logMalformedPromptEngineeredPayload({
        format,
        reason: 'parse failure',
        rawContent: response.content as string,
        error,
      });
      throw error;
    }
  }

  return {
    logPromptEngineeredRenderRollback,
    requestPromptEngineeredResponse,
  };
}