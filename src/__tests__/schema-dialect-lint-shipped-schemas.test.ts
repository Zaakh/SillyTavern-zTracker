/**
 * @jest-environment node
 */

/**
 * Regression guard (openspec: add-schema-dialect-lint 6.1): every schema the extension ships or
 * installs on the user's behalf must produce zero error-level and zero warning-level dialect
 * findings, in every prompt engineering mode and both states of grammar/schema enforcement, so no
 * shipped starting point ever demonstrates a construct zTracker does not honor.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { DEFAULT_SCHEMA_VALUE, PLACEHOLDER_SCHEMA_VALUE, PromptEngineeringMode } from '../config.js';
import { lintSchemaDialect } from '../schema-dialect-lint.js';

const TEMPLATES_DIR = joinPath(process.cwd(), 'templates', 'modules');
const MODES = [PromptEngineeringMode.NATIVE, PromptEngineeringMode.JSON, PromptEngineeringMode.XML, PromptEngineeringMode.TOON];

function loadShippedTemplateSchemas(): Array<{ label: string; schema: unknown }> {
  return readdirSync(TEMPLATES_DIR)
    .filter((fileName) => fileName.endsWith('.json'))
    .flatMap((fileName) => {
      const parsed = JSON.parse(readFileSync(joinPath(TEMPLATES_DIR, fileName), 'utf8'));
      const presets = parsed?.module?.schema?.presets ?? {};
      return Object.entries(presets).map(([presetKey, preset]: [string, any]) => ({
        label: `templates/modules/${fileName} (preset "${presetKey}")`,
        schema: preset.value,
      }));
    });
}

describe('shipped schemas are dialect-clean (openspec: add-schema-dialect-lint)', () => {
  const shippedSchemas: Array<{ label: string; schema: unknown }> = [
    { label: 'DEFAULT_SCHEMA_VALUE', schema: DEFAULT_SCHEMA_VALUE },
    { label: 'PLACEHOLDER_SCHEMA_VALUE', schema: PLACEHOLDER_SCHEMA_VALUE },
    ...loadShippedTemplateSchemas(),
  ];

  // Sanity check that the dynamic template discovery actually found the shipped files, so a
  // future refactor that breaks the glob/readdir silently produces an empty (vacuously passing)
  // test.each instead of a real regression guard.
  test('discovers at least the three shipped starter templates plus the two built-in defaults', () => {
    expect(shippedSchemas.length).toBeGreaterThanOrEqual(5);
  });

  test.each(shippedSchemas)('$label produces no error or warning findings in any mode/enforcement combination', ({ schema }) => {
    for (const mode of MODES) {
      for (const grammarEnforcementEnabled of [false, true]) {
        const findings = lintSchemaDialect(schema, mode, grammarEnforcementEnabled).filter((finding) => finding.severity !== 'info');
        expect(findings).toEqual([]);
      }
    }
  });
});
