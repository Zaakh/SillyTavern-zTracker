// JSON-specific parsing and repair helpers for model replies.

import {
  normalizeLineEndings,
  normalizeStructuredWhitespace,
  runRepairWorkflow,
  stripRepeatedFenceWrappers,
} from './shared.js';

export type JsonRepairStepName =
  | 'line-ending normalization'
  | 'whitespace normalization'
  | 'fence cleanup'
  | 'json substring extraction'
  | 'smart quote normalization'
  | 'trailing comma removal';

const SMART_DOUBLE_QUOTES = new Set(['\u201C', '\u201D', '\u201E', '\u201F']);

function tryParseJsonCandidate(content: string): object {
  return JSON.parse(content) as object;
}

function findBalancedJsonEnd(content: string, start: number): number | undefined {
  const stack: string[] = [content[start] === '{' ? '}' : ']'];
  let inString = false;
  let isEscaped = false;

  for (let index = start + 1; index < content.length; index += 1) {
    const char = content[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (char === '\\') {
        isEscaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      stack.push('}');
      continue;
    }

    if (char === '[') {
      stack.push(']');
      continue;
    }

    if (char === '}' || char === ']') {
      const expected = stack.pop();
      if (char !== expected) {
        return undefined;
      }
      if (stack.length === 0) {
        return index;
      }
    }
  }

  return undefined;
}

function extractBalancedJsonSubstring(content: string): string | undefined {
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char !== '{' && char !== '[') {
      continue;
    }

    const end = findBalancedJsonEnd(content, index);
    if (end !== undefined) {
      return content.slice(index, end + 1);
    }
  }

  return undefined;
}

function normalizeSmartQuotes(content: string): string {
  let normalized = '';
  let inAsciiString = false;
  let isEscaped = false;

  for (const char of content) {
    if (inAsciiString) {
      normalized += char;
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (char === '\\') {
        isEscaped = true;
        continue;
      }
      if (char === '"') {
        inAsciiString = false;
      }
      continue;
    }

    if (char === '"') {
      inAsciiString = true;
      normalized += char;
      continue;
    }

    normalized += SMART_DOUBLE_QUOTES.has(char) ? '"' : char;
  }

  return normalized;
}

function removeTrailingCommas(content: string): string {
  let normalized = '';
  let inString = false;
  let isEscaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (inString) {
      normalized += char;
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (char === '\\') {
        isEscaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      normalized += char;
      continue;
    }

    if (char === ',') {
      let lookahead = index + 1;
      while (lookahead < content.length && /\s/.test(content[lookahead])) {
        lookahead += 1;
      }
      if (content[lookahead] === '}' || content[lookahead] === ']') {
        continue;
      }
    }

    normalized += char;
  }

  return normalized;
}

export function tryParseJsonWithRepair(content: string): object {
  return runRepairWorkflow<JsonRepairStepName>({
    content,
    formatLabel: 'JSON',
    parseCandidate: tryParseJsonCandidate,
    repairSteps: [
      { name: 'line-ending normalization', transform: normalizeLineEndings },
      { name: 'whitespace normalization', transform: normalizeStructuredWhitespace },
      { name: 'fence cleanup', transform: stripRepeatedFenceWrappers },
      { name: 'json substring extraction', transform: extractBalancedJsonSubstring },
      { name: 'smart quote normalization', transform: normalizeSmartQuotes },
      { name: 'trailing comma removal', transform: removeTrailingCommas },
    ],
  });
}
