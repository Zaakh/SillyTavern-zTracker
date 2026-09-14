/**
 * @jest-environment node
 */

/**
 * Covers `generateHtmlFromSchema()` (src/components/settings/generate-schema-html.ts): the
 * mechanical JSON-Schema-to-Handlebars-HTML derivation backing the "Generate HTML from schema"
 * Settings UI action. See openspec/changes/generate-html-from-schema/design.md for the
 * render-safety rules being tested (required/optional guarding, array handling, unsupported
 * construct placeholders, bracket path syntax).
 */
import { readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import Handlebars from 'handlebars';
import { generateHtmlFromSchema } from '../components/settings/generate-schema-html.js';
import { validateSchemaPresetDraftPair } from '../components/settings/schema-editor-state.js';

// validateSchemaPresetDraftPair compiles templates with the real `handlebars` package, which has no
// `join` helper registered on its own outside of src/index.tsx (not imported in tests); register it
// here too, matching the convention in premade-module-templates.test.ts.
if (!Handlebars.helpers['join']) {
  Handlebars.registerHelper('join', function (array: unknown, separator: unknown) {
    return Array.isArray(array) ? array.join(typeof separator === 'string' ? separator : ', ') : '';
  });
}

const TEMPLATES_DIR = joinPath(process.cwd(), 'templates', 'modules');

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe('generateHtmlFromSchema', () => {
  test('renders a required leaf field unconditionally', () => {
    const html = generateHtmlFromSchema({
      type: 'object',
      properties: { time: { type: 'string' } },
      required: ['time'],
    });

    expect(html).toContain('{{data.time}}');
    expect(html).not.toContain('{{#if data.time}}');
  });

  test('wraps an optional leaf field in a conditional block', () => {
    const html = generateHtmlFromSchema({
      type: 'object',
      properties: { weather: { type: 'string' } },
    });

    expect(html).toContain('{{#if data.weather}}');
    expect(html).toContain('{{data.weather}}');
    expect(html).toContain('{{/if}}');
  });

  test('flattens a required nested object inline without wrapping it in a conditional', () => {
    const html = generateHtmlFromSchema({
      type: 'object',
      properties: {
        topics: {
          type: 'object',
          properties: { primaryTopic: { type: 'string' } },
          required: ['primaryTopic'],
        },
      },
      required: ['topics'],
    });

    expect(html).toContain('{{data.topics.primaryTopic}}');
    expect(html).not.toContain('{{#if data.topics}}');
    expect(countOccurrences(html, '<details>')).toBe(1);
  });

  test('guards an optional nested object with required fields inside it', () => {
    const schema = {
      type: 'object',
      properties: {
        topics: {
          type: 'object',
          properties: {
            primaryTopic: { type: 'string' },
            emotionalTone: { type: 'string' },
          },
          required: ['primaryTopic', 'emotionalTone'],
        },
      },
      // 'topics' is NOT required by the root - its required children must still be guarded
      // as a whole, since Handlebars strict mode throws on an undefined intermediate segment
      // even inside a leaf-level {{#if}}.
      required: [],
    };

    const html = generateHtmlFromSchema(schema);
    expect(html).toContain('{{#if data.topics}}');
    expect(html).toContain('{{data.topics.primaryTopic}}');
    expect(html).toContain('{{data.topics.emotionalTone}}');

    const validation = validateSchemaPresetDraftPair({
      schemaText: JSON.stringify(schema),
      schemaHtmlText: html,
    });
    expect(validation).toEqual({ isValid: true });
  });

  test('renders arrays of primitive items via the join helper', () => {
    const html = generateHtmlFromSchema({
      type: 'object',
      properties: { charactersPresent: { type: 'array', items: { type: 'string' } } },
      required: ['charactersPresent'],
    });

    expect(html).toContain("{{join data.charactersPresent ', '}}");
  });

  test('iterates arrays of objects with a mix of required and optional item fields', () => {
    const schema = {
      type: 'object',
      properties: {
        characters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              hair: { type: 'string' },
            },
            required: ['name'],
          },
        },
      },
      required: ['characters'],
    };

    const html = generateHtmlFromSchema(schema);
    expect(html).toContain('{{#each data.characters as |item|}}');
    expect(html).toContain('{{item.name}}');
    expect(html).toContain('{{#if item.hair}}');
    expect(html).toContain('{{/each}}');
  });

  test('renders bracket segment-literal paths for keys that are not plain identifiers, at any depth', () => {
    const html = generateHtmlFromSchema({
      type: 'object',
      properties: {
        'weird key': { type: 'string' },
        nested: {
          type: 'object',
          properties: { 'weird-nested': { type: 'string' } },
          required: ['weird-nested'],
        },
      },
      required: ['nested'],
    });

    expect(html).toContain('{{#if data.[weird key]}}');
    expect(html).toContain('{{data.nested.[weird-nested]}}');
  });

  test('skips unsupported schema constructs with a named placeholder and no field reference', () => {
    const html = generateHtmlFromSchema({
      type: 'object',
      properties: {
        extra: { oneOf: [{ type: 'string' }, { type: 'number' }] },
      },
    });

    expect(html).toContain('Skipped "extra": unsupported schema shape');
    expect(html).not.toContain('{{data.extra}}');
    expect(html).not.toContain('{{#if data.extra}}');
  });

  test('skips an array whose items use an unsupported shape', () => {
    const html = generateHtmlFromSchema({
      type: 'object',
      properties: {
        items: { type: 'array', items: { $ref: '#/$defs/thing' } },
      },
    });

    expect(html).toContain('Skipped "items": unsupported schema shape');
    expect(html).not.toContain('{{join');
    expect(html).not.toContain('{{#each');
  });

  test('prefers a property title over a humanized key, and falls back to humanizing', () => {
    const html = generateHtmlFromSchema({
      type: 'object',
      properties: {
        stateOfDress: { type: 'string' },
        withTitle: { type: 'string', title: 'Custom Label' },
      },
    });

    expect(html).toContain('State Of Dress');
    expect(html).toContain('Custom Label');
    expect(html).not.toContain('With Title');
  });

  test('attaches a present description as a tooltip attribute', () => {
    const html = generateHtmlFromSchema({
      type: 'object',
      properties: { time: { type: 'string', description: 'Scene time' } },
      required: ['time'],
    });

    expect(html).toContain('title="Scene time"');
  });

  test('omits a tooltip attribute when no description is present', () => {
    const html = generateHtmlFromSchema({
      type: 'object',
      properties: { time: { type: 'string' } },
      required: ['time'],
    });

    expect(html).not.toContain('title=');
  });

  test('uses the schema root title for the summary, falling back to "Tracker Details"', () => {
    const withTitle = generateHtmlFromSchema({ type: 'object', title: 'SceneTracker', properties: {} });
    expect(withTitle).toContain('<summary>SceneTracker</summary>');

    const withoutTitle = generateHtmlFromSchema({ type: 'object', properties: {} });
    expect(withoutTitle).toContain('<summary>Tracker Details</summary>');
  });

  test('wraps every generated row in exactly one details element', () => {
    const html = generateHtmlFromSchema({
      type: 'object',
      properties: {
        topics: { type: 'object', properties: { mood: { type: 'string' } }, required: ['mood'] },
        characters: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
      },
      required: ['topics', 'characters'],
    });

    expect(countOccurrences(html, '<details>')).toBe(1);
    expect(countOccurrences(html, '</details>')).toBe(1);
  });

  test('produces a valid single details block noting no renderable fields for an empty schema', () => {
    const html = generateHtmlFromSchema({ type: 'object', properties: {} });

    expect(countOccurrences(html, '<details>')).toBe(1);
    expect(html).toContain('No renderable fields found in schema');
  });

  test('wraps output in the styling hook shared with the hand-written default template', () => {
    const html = generateHtmlFromSchema({ type: 'object', properties: { time: { type: 'string' } }, required: ['time'] });

    expect(html).toContain('<div class="ztracker_default_mes_template">');
    expect(html).toContain('</div>');
  });

  test('escapes a key that would otherwise break out of the skip-placeholder HTML comment', () => {
    const html = generateHtmlFromSchema({
      type: 'object',
      properties: { 'weird--> <script>key': { oneOf: [{ type: 'string' }, { type: 'number' }] } },
    });

    expect(html).not.toContain('--> <script>');
    expect(html).toContain('Skipped');
  });

  test('skips a key containing "]" instead of emitting a broken bracket path', () => {
    const html = generateHtmlFromSchema({
      type: 'object',
      properties: { 'weird]key': { type: 'string' } },
      required: ['weird]key'],
    });

    expect(html).toContain('Skipped "weird]key"');
    expect(html).not.toContain('{{data.[weird]key]}}');
    expect(html).not.toContain('{{data.weird]key}}');
  });

  test('treats an enum-only (typeless) leaf schema as supported', () => {
    const html = generateHtmlFromSchema({
      type: 'object',
      properties: { pacing: { enum: ['escalate', 'resolve', 'hold', 'twist'] } },
      required: ['pacing'],
    });

    expect(html).toContain('{{data.pacing}}');
    expect(html).not.toContain('Skipped');
  });

  test('treats a const-only (typeless) leaf schema as supported', () => {
    const html = generateHtmlFromSchema({
      type: 'object',
      properties: { kind: { const: 'fixed-value' } },
    });

    expect(html).toContain('{{#if data.kind}}');
    expect(html).not.toContain('Skipped');
  });

  test('recognizes a nullable object via a JSON-Schema union type array', () => {
    const html = generateHtmlFromSchema({
      type: 'object',
      properties: {
        topics: { type: ['object', 'null'], properties: { mood: { type: 'string' } }, required: ['mood'] },
      },
    });

    expect(html).toContain('{{#if data.topics}}');
    expect(html).toContain('{{data.topics.mood}}');
  });

  test('recognizes a nullable array via a JSON-Schema union type array', () => {
    const html = generateHtmlFromSchema({
      type: 'object',
      properties: { tags: { type: ['array', 'null'], items: { type: 'string' } } },
      required: ['tags'],
    });

    expect(html).toContain("{{join data.tags ', '}}");
  });

  test('names the specific unsupported construct when the schema root itself cannot be flattened', () => {
    const html = generateHtmlFromSchema({ oneOf: [{ type: 'object' }, { type: 'string' }] });

    expect(html).toContain('Schema root uses an unsupported construct');
    expect(countOccurrences(html, '<details>')).toBe(1);
  });

  test('handles two levels of nested array-of-objects without block-param name collisions', () => {
    const schema = {
      type: 'object',
      properties: {
        characters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              pets: {
                type: 'array',
                items: { type: 'object', properties: { petName: { type: 'string' } }, required: ['petName'] },
              },
            },
            required: ['name'],
          },
        },
      },
      required: ['characters'],
    };

    const html = generateHtmlFromSchema(schema);
    expect(html).toContain('{{#each data.characters as |item|}}');
    expect(html).toContain('{{#each item.pets as |item|}}');
    expect(html).toContain('{{item.petName}}');

    const validation = validateSchemaPresetDraftPair({ schemaText: JSON.stringify(schema), schemaHtmlText: html });
    expect(validation).toEqual({ isValid: true });
  });

  test('never uses raw/unescaped triple-stash interpolation', () => {
    const html = generateHtmlFromSchema({
      type: 'object',
      properties: {
        characters: {
          type: 'array',
          items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        },
      },
    });

    expect(html).not.toContain('{{{');
  });

  test.each(['scene-tracker.json', 'plot-log.json', 'plot-steer.json'])(
    'generated HTML for %s survives the real maximal+minimal strict-mode render check',
    (fileName) => {
      const parsed = JSON.parse(readFileSync(joinPath(TEMPLATES_DIR, fileName), 'utf8'));
      const schema = parsed.module.schema.presets[parsed.module.schema.preset].value;

      const html = generateHtmlFromSchema(schema);
      const validation = validateSchemaPresetDraftPair({ schemaText: JSON.stringify(schema), schemaHtmlText: html });

      expect(validation).toEqual({ isValid: true });
    },
  );
});
