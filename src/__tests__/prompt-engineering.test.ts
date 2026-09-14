/**
 * @jest-environment node
 */

// Verifies the JSON-mode-only grammar/schema enforcement override wiring in
// `requestPromptEngineeredResponse` (src/ui/prompt-engineering.ts), independent of the rest of
// tracker-action orchestration.

import { jest } from '@jest/globals';
import { createPromptEngineeringHelpers } from '../ui/prompt-engineering.js';
import { PromptEngineeringMode, type TrackerModuleSettings } from '../config.js';

describe('requestPromptEngineeredResponse grammar/schema enforcement override', () => {
  const schema = { type: 'object', properties: { time: { type: 'string' } }, required: ['time'] };
  const baseSettings = {
    promptJson: 'JSON TEMPLATE {{schema}} {{example_response}}',
    promptXml: 'XML TEMPLATE {{schema}} {{example_response}}',
    promptToon: 'TOON TEMPLATE {{schema}} {{example_response}}',
    grammarEnforcementEnabled: false,
  } as unknown as TrackerModuleSettings;

  test('adds a json_schema override when JSON mode has enforcement enabled', async () => {
    const { requestPromptEngineeredResponse } = createPromptEngineeringHelpers();
    const makeRequest = jest.fn(async () => ({ content: '```json\n{"time":"10:00"}\n```' }));

    await requestPromptEngineeredResponse(
      makeRequest,
      [],
      { ...baseSettings, promptEngineeringMode: PromptEngineeringMode.JSON, grammarEnforcementEnabled: true },
      schema,
    );

    expect(makeRequest).toHaveBeenCalledWith(expect.any(Array), { json_schema: schema });
  });

  test('sends no override when JSON mode has enforcement disabled', async () => {
    const { requestPromptEngineeredResponse } = createPromptEngineeringHelpers();
    const makeRequest = jest.fn(async () => ({ content: '```json\n{"time":"10:00"}\n```' }));

    await requestPromptEngineeredResponse(
      makeRequest,
      [],
      { ...baseSettings, promptEngineeringMode: PromptEngineeringMode.JSON, grammarEnforcementEnabled: false },
      schema,
    );

    expect(makeRequest).toHaveBeenCalledWith(expect.any(Array), undefined);
  });

  test('never sends an override in XML mode, even with enforcement enabled', async () => {
    const { requestPromptEngineeredResponse } = createPromptEngineeringHelpers();
    const makeRequest = jest.fn(async () => ({ content: '<time>10:00</time>' }));

    await requestPromptEngineeredResponse(
      makeRequest,
      [],
      { ...baseSettings, promptEngineeringMode: PromptEngineeringMode.XML, grammarEnforcementEnabled: true },
      schema,
    ).catch(() => undefined);

    expect(makeRequest).toHaveBeenCalledWith(expect.any(Array), undefined);
  });

  test('never sends an override in TOON mode, even with enforcement enabled', async () => {
    const { requestPromptEngineeredResponse } = createPromptEngineeringHelpers();
    const makeRequest = jest.fn(async () => ({ content: 'time\t10:00' }));

    await requestPromptEngineeredResponse(
      makeRequest,
      [],
      { ...baseSettings, promptEngineeringMode: PromptEngineeringMode.TOON, grammarEnforcementEnabled: true },
      schema,
    ).catch(() => undefined);

    expect(makeRequest).toHaveBeenCalledWith(expect.any(Array), undefined);
  });
});
