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
  | 'xml opening bracket repair'
  | 'xml substring extraction';

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  textNodeName: '#text',
  trimValues: true,
  allowBooleanAttributes: true,
});

function tryParseXmlCandidate(content: string): object {
  let parsedXml = xmlParser.parse(content);
  if (parsedXml.root) {
    parsedXml = parsedXml.root;
  }
  return parsedXml;
}

function isAcceptableXmlParse(parsed: object): boolean {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return false;
  }

  const keys = Object.keys(parsed);
  return keys.length > 0 && !(keys.length === 1 && keys[0] === '#text');
}

// Repairs the specific case where the first opening tag in an XML line loses its leading '<'.
function repairXmlMissingOpeningBracket(content: string): string {
  const lines = content.split('\n');
  let changed = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^(\s*)([A-Za-z_][\w:.-]*>.*<\/[A-Za-z_][\w:.-]*>\s*)$/);
    if (!match || line.trimStart().startsWith('<')) {
      continue;
    }

    lines[index] = `${match[1]}<${match[2]}`;
    changed = true;
  }

  return changed ? lines.join('\n') : content;
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

export function tryParseXmlWithRepair(content: string): object {
  return runRepairWorkflow<XmlRepairStepName>({
    content,
    formatLabel: 'XML',
    parseCandidate: tryParseXmlCandidate,
    repairSteps: [
      { name: 'line-ending normalization', transform: normalizeLineEndings },
      { name: 'whitespace normalization', transform: normalizeStructuredWhitespace },
      { name: 'fence cleanup', transform: stripRepeatedFenceWrappers },
      { name: 'xml opening bracket repair', transform: repairXmlMissingOpeningBracket },
      { name: 'xml substring extraction', transform: extractXmlSubstring },
    ],
    workflowOptions: {
      acceptParsedResult: (parsed, _candidate) => isAcceptableXmlParse(parsed),
    },
  });
}
