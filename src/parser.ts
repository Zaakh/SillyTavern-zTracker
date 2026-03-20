import { tryParseJsonWithRepair } from './parser/json.js';
import { tryParseToonWithRepair } from './parser/toon.js';
import { tryParseXmlWithRepair } from './parser/xml.js';

// Entry point for parsing model replies across JSON, XML, and TOON formats.

export interface ParseResponseOptions {
  schema?: any;
}

export type ParseResponseFormat = 'xml' | 'json' | 'toon';

export function parseResponse(content: string, format: ParseResponseFormat, options: ParseResponseOptions = {}): object {
  try {
    switch (format) {
      case 'xml':
        return tryParseXmlWithRepair(content, options.schema);

      case 'json':
        return tryParseJsonWithRepair(content);

      case 'toon':
        return tryParseToonWithRepair(content);

      default:
        throw new Error(`Unsupported format specified: ${format}`);
    }
  } catch (error: any) {
    if ((format === 'json' || format === 'toon' || format === 'xml') && Array.isArray(error?.attemptedRepairSteps) && error.attemptedRepairSteps.length > 0) {
      console.info(`zTracker: ${format.toUpperCase()} repair failed`, {
        attemptedSteps: error.attemptedRepairSteps,
        originalLength: content.length,
      });
    }
    console.error(`Error parsing response in format '${format}':`, error);
    console.error('Raw content length:', content.length);

    if (format === 'xml') {
      throw new Error('Model response is not valid XML.');
    } else if (format === 'json' && error instanceof SyntaxError) {
      throw new Error('Model response is not valid JSON.');
    } else if (format === 'toon') {
      throw new Error('Model response is not valid TOON.');
    } else {
      throw new Error(`Failed to parse response as ${format}: ${error.message}`);
    }
  }
}
