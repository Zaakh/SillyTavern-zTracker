/**
 * Few-shot examples for LLM schema/prompt generation: the shipped starter Modules, each paired
 * with a short authored brief (the templates carry none). Bundled via static JSON import so no
 * fetch, cache or degraded "no examples" mode is needed.
 */
import plotLog from '../templates/modules/plot-log.json' with { type: 'json' };
import plotSteer from '../templates/modules/plot-steer.json' with { type: 'json' };
import sceneTracker from '../templates/modules/scene-tracker.json' with { type: 'json' };
import type { GenerationExample } from './schema-generation.js';

const STARTERS = [
  { template: sceneTracker, brief: 'Track the current scene: time, location, weather, topic and each present character with their appearance and outfit.' },
  { template: plotLog, brief: 'Keep a running log of the story: current arc, open plot threads, recent events and what is at stake.' },
  { template: plotSteer, brief: 'Suggest the next narrative beat and how fast the story should move.' },
];

export function getStarterGenerationExamples(): GenerationExample[] {
  return STARTERS.map(({ template, brief }) => {
    const module = template.module;
    return {
      brief,
      schema: (module.schema.presets as Record<string, { value: unknown }>)[module.schema.preset].value,
      systemPrompt: module.systemPrompt.content,
      // Plot Log/Steer ship only a "used in Native mode" notice as base prompt: not a usable example.
      prompt: module.prompts.prompt.length > 400 ? module.prompts.prompt : '',
    };
  });
}
