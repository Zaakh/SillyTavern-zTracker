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

function tryParseXmlCandidate(content: string): object {
  let parsedXml = xmlParser.parse(content);
  if (parsedXml.root) {
    parsedXml = parsedXml.root;
  }
  return parsedXml;
}

function isAcceptableXmlParse(parsed: object): boolean {
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

export function tryParseXmlWithRepair(content: string): object {
  return runRepairWorkflow<XmlRepairStepName>({
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
      acceptParsedResult: (parsed, _candidate) => isAcceptableXmlParse(parsed),
    },
  });
}
