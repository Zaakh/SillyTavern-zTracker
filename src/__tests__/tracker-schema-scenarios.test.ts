// Scenario-focused schema regression tests that exercise JSON, XML, and TOON across tracker domains beyond chat scenes.

import { describe, expect, it } from '@jest/globals';
import { parseResponse } from '../parser.js';
import { schemaToExample } from '../schema-to-example.js';

// Builds diverse tracker schemas so structured-format helpers are tested against very different domain shapes.
function buildScenarioSchemas(): Array<{ name: string; schema: any }> {
  return [
    {
      name: 'rpg combat tracker',
      schema: {
        type: 'object',
        properties: {
          questName: { type: 'string', description: 'Active quest title' },
          battlefield: { type: 'string', description: 'Current combat location' },
          roundState: {
            type: 'object',
            properties: {
              round: { type: 'number' },
              actingSide: { type: 'string', description: 'Current acting side' },
            },
          },
          partyMembers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Party member name' },
                classRole: { type: 'string', description: 'Combat role' },
                hp: { type: 'number' },
                statusEffects: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    {
      name: 'mystery investigation tracker',
      schema: {
        type: 'object',
        properties: {
          caseId: { type: 'string', description: 'Investigation case identifier' },
          crimeScene: { type: 'string', description: 'Primary crime scene summary' },
          suspects: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Suspect name' },
                motive: { type: 'string', description: 'Primary motive' },
                alibiVerified: { type: 'boolean' },
              },
            },
          },
          evidenceBoard: {
            type: 'object',
            properties: {
              leadSummary: { type: 'string', description: 'Current lead summary' },
              openQuestions: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    {
      name: 'survival base tracker',
      schema: {
        type: 'object',
        properties: {
          biome: { type: 'string', description: 'Current biome or region' },
          weatherWindow: { type: 'string', description: 'Short-term weather outlook' },
          resources: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', description: 'Resource type' },
                quantity: { type: 'number' },
                spoilageRisk: { type: 'string', description: 'Spoilage or loss risk' },
              },
            },
          },
          shelter: {
            type: 'object',
            properties: {
              integrity: { type: 'number' },
              hazards: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  ];
}

// Verifies that format-specific examples round-trip back into the same structured data for a given scenario schema.
function expectScenarioRoundTrip(schema: any): void {
  const expected = JSON.parse(schemaToExample(schema, 'json'));
  const xmlExample = `\`\`\`xml\n<root>\n${schemaToExample(schema, 'xml')}\n</root>\n\`\`\``;
  const toonExample = `\`\`\`toon\n${schemaToExample(schema, 'toon')}\n\`\`\``;

  expect(parseResponse(JSON.stringify(expected), 'json')).toEqual(expected);
  expect(parseResponse(xmlExample, 'xml', { schema })).toEqual(expected);
  expect(parseResponse(toonExample, 'toon', { schema })).toEqual(expected);
}

describe('tracker schema scenarios', () => {
  it.each(buildScenarioSchemas())('round-trips %s across JSON, XML, and TOON helpers', ({ schema }) => {
    expectScenarioRoundTrip(schema);
  });
});