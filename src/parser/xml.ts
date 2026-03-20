// XML-specific parsing and conservative repair helpers for model replies.

import { XMLParser } from 'fast-xml-parser';
import {
  normalizeLineEndings,
  normalizeStructuredWhitespace,
  runRepairWorkflow,
  stripRepeatedFenceWrappers,
} from './shared.js';

export type XmlRepairStepName =
  | 'line-ending normalization'
  | 'whitespace normalization'
  | 'fence cleanup'
  | 'xml substring extraction';

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  textNodeName: '#text',
  trimValues: true,
  allowBooleanAttributes: true,
});

function ensureArray(data: any, schema: any) {
  if (!schema || !data) {
    return;
  }

  for (const key in schema.properties) {
    if (schema.properties[key].type === 'array' && data[key] && !Array.isArray(data[key])) {
      data[key] = [data[key]];
    }
    if (schema.properties[key].type === 'object') {
      ensureArray(data[key], schema.properties[key]);
    }
    if (schema.properties[key].type === 'array' && schema.properties[key].items.type === 'object') {
      if (Array.isArray(data[key])) {
        data[key].forEach((item: any) => ensureArray(item, schema.properties[key].items));
      } else {
        ensureArray(data[key], schema.properties[key].items);
      }
    }
  }
}

function tryParseXmlCandidate(content: string): object {
  let parsedXml = xmlParser.parse(content);
  if (parsedXml.root) {
    parsedXml = parsedXml.root;
  }
  return parsedXml;
}

function isAcceptableXmlParse(parsed: object, candidate: string): boolean {
  return Object.keys(parsed).length > 0;
}

function extractXmlSubstring(content: string): string | undefined {
  const rootMatch = content.match(/<([A-Za-z_][\w:.-]*)(?:\s[^<>]*)?>[\s\S]*<\/\1>/);
  if (rootMatch?.[0]) {
    return rootMatch[0].trim();
  }

  const firstTagIndex = content.indexOf('<');
  const lastTagIndex = content.lastIndexOf('>');
  if (firstTagIndex >= 0 && lastTagIndex > firstTagIndex) {
    return content.slice(firstTagIndex, lastTagIndex + 1).trim();
  }

  return undefined;
}

export function tryParseXmlWithRepair(content: string, schema?: any): object {
  const parsedXml = runRepairWorkflow<XmlRepairStepName>({
    content,
    formatLabel: 'XML',
    parseCandidate: tryParseXmlCandidate,
    repairSteps: [
      { name: 'line-ending normalization', transform: normalizeLineEndings },
      { name: 'whitespace normalization', transform: normalizeStructuredWhitespace },
      { name: 'fence cleanup', transform: stripRepeatedFenceWrappers },
      { name: 'xml substring extraction', transform: extractXmlSubstring },
    ],
    workflowOptions: {
      acceptParsedResult: (parsed, candidate) => isAcceptableXmlParse(parsed, candidate),
    },
  });

  if (schema) {
    ensureArray(parsedXml, schema);
  }

  return parsedXml;
}