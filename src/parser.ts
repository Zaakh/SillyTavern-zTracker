import { XMLParser } from 'fast-xml-parser';

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  textNodeName: '#text',
  trimValues: true,
  allowBooleanAttributes: true,
});

const CODE_BLOCK_REGEX = /```(?:[\w-]+\n|\n)([\s\S]*?)```/;
const FULL_FENCE_REGEX = /^```(?:[\w-]+)?[ \t]*\n([\s\S]*?)\n?```$/;
const INVISIBLE_EDGE_CHARS_REGEX = /^[\uFEFF\u200B\u200C\u200D\u2060]+|[\uFEFF\u200B\u200C\u200D\u2060]+$/g;
const SMART_DOUBLE_QUOTES = new Set(['\u201C', '\u201D', '\u201E', '\u201F']);

type JsonRepairStepName =
  | 'line-ending normalization'
  | 'whitespace normalization'
  | 'fence cleanup'
  | 'json substring extraction'
  | 'smart quote normalization'
  | 'trailing comma removal';

type JsonRepairFailure = SyntaxError & {
  attemptedRepairSteps?: JsonRepairStepName[];
};

export interface ParseResponseOptions {
  schema?: any;
}

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

function extractCodeBlockContent(content: string): string {
  const codeBlockMatch = content.match(CODE_BLOCK_REGEX);
  return codeBlockMatch ? codeBlockMatch[1].trim() : content.trim();
}

function tryParseJsonCandidate(content: string): object {
  return JSON.parse(content) as object;
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

function normalizeJsonWhitespace(content: string): string {
  return content.replace(INVISIBLE_EDGE_CHARS_REGEX, '').trim();
}

function stripRepeatedFenceWrappers(content: string): string {
  let candidate = content;

  while (true) {
    const match = candidate.match(FULL_FENCE_REGEX);
    if (!match) {
      return candidate;
    }

    candidate = match[1].trim();
  }
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

function tryParseJsonWithRepair(content: string): object {
  const initialCandidate = extractCodeBlockContent(content);

  try {
    return tryParseJsonCandidate(initialCandidate);
  } catch (initialError) {
    const appliedSteps: JsonRepairStepName[] = [];
    let candidate = content;
    let lastError = initialError;
    const repairSteps: Array<{
      name: JsonRepairStepName;
      transform: (value: string) => string | undefined;
    }> = [
      { name: 'line-ending normalization', transform: normalizeLineEndings },
      { name: 'whitespace normalization', transform: normalizeJsonWhitespace },
      { name: 'fence cleanup', transform: stripRepeatedFenceWrappers },
      { name: 'json substring extraction', transform: extractBalancedJsonSubstring },
      { name: 'smart quote normalization', transform: normalizeSmartQuotes },
      { name: 'trailing comma removal', transform: removeTrailingCommas },
    ];

    for (const step of repairSteps) {
      const nextCandidate = step.transform(candidate);
      if (nextCandidate === undefined || nextCandidate === candidate) {
        continue;
      }

      appliedSteps.push(step.name);
      candidate = nextCandidate;

      try {
        const parsed = tryParseJsonCandidate(candidate);
        console.info('zTracker: repaired JSON response', {
          appliedSteps: [...appliedSteps],
          originalLength: typeof content === 'string' ? content.length : 0,
          repairedLength: candidate.length,
        });
        return parsed;
      } catch (error) {
        lastError = error;
      }
    }

    const failure = (lastError instanceof SyntaxError ? lastError : new SyntaxError(String(lastError))) as JsonRepairFailure;
    failure.attemptedRepairSteps = [...appliedSteps];
    throw failure;
  }
}

export function parseResponse(content: string, format: 'xml' | 'json', options: ParseResponseOptions = {}): object {
  const cleanedContent = extractCodeBlockContent(content);

  try {
    switch (format) {
      case 'xml':
        let parsedXml = xmlParser.parse(cleanedContent);
        if (parsedXml.root) {
          parsedXml = parsedXml.root;
        }
        if (options.schema) {
          ensureArray(parsedXml, options.schema);
        }
        return parsedXml;

      case 'json':
        const parsedJson = tryParseJsonWithRepair(content);
        return parsedJson;

      default:
        throw new Error(`Unsupported format specified: ${format}`);
    }
  } catch (error: any) {
    if (format === 'json' && Array.isArray(error?.attemptedRepairSteps) && error.attemptedRepairSteps.length > 0) {
      console.info('zTracker: JSON repair failed', {
        attemptedSteps: error.attemptedRepairSteps,
        originalLength: typeof content === 'string' ? content.length : 0,
      });
    }
    console.error(`Error parsing response in format '${format}':`, error);
    console.error('Raw content length:', typeof content === 'string' ? content.length : 0);

    if (format === 'xml' && error.message.includes('Invalid XML')) {
      throw new Error('Model response is not valid XML.');
    } else if (format === 'json' && error instanceof SyntaxError) {
      throw new Error('Model response is not valid JSON.');
    } else {
      throw new Error(`Failed to parse response as ${format}: ${error.message}`);
    }
  }
}
