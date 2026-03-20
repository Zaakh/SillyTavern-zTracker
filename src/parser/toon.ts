// TOON-specific parsing and conservative repair helpers for model replies.

import { decode as decodeToon } from '@toon-format/toon';
import {
  normalizeLineEndings,
  normalizeStructuredWhitespace,
  runRepairWorkflow,
  stripRepeatedFenceWrappers,
} from './shared.js';

export type ToonRepairStepName =
  | 'line-ending normalization'
  | 'whitespace normalization'
  | 'fence cleanup'
  | 'tabular delimiter normalization';

function tryParseToonCandidate(content: string): object {
  return decodeToon(content) as object;
}

function normalizeToonTabularDelimiters(content: string): string {
  const normalizeDelimitedSegment = (segment: string): string => {
    const parts = segment.split(/\t+| {2,}/).filter((part) => part.length > 0);
    return parts.length > 1 ? parts.join('\t') : segment;
  };

  const lines = content.split('\n');
  let changed = false;
  let activeTableIndent: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    const normalizedArrayCount = line.replace(/\[(\d+)\s+\]/g, '[$1\t]');
    if (normalizedArrayCount !== line) {
      lines[index] = normalizedArrayCount;
      line = normalizedArrayCount;
      changed = true;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const indent = line.length - line.trimStart().length;
    if (activeTableIndent !== null) {
      if (indent > activeTableIndent) {
        const prefix = line.slice(0, indent);
        const body = line.slice(indent);
        const normalizedBody = normalizeDelimitedSegment(body);
        if (normalizedBody !== body) {
          lines[index] = `${prefix}${normalizedBody}`;
          changed = true;
        }
        continue;
      }

      activeTableIndent = null;
    }

    const headerMatch = line.match(/^(.*\{)([^}]*)(\}:\s*)$/);
    if (!headerMatch) {
      continue;
    }

    const [, prefix, fields, suffix] = headerMatch;
    const normalizedFields = normalizeDelimitedSegment(fields);
    if (normalizedFields !== fields) {
      lines[index] = `${prefix}${normalizedFields}${suffix}`;
      changed = true;
    }
    activeTableIndent = indent;
  }

  return changed ? lines.join('\n') : content;
}

function hasSuspiciousToonKeys(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasSuspiciousToonKeys(item));
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  return Object.entries(value as Record<string, unknown>).some(([key, nestedValue]) => {
    return /\t| {2,}/.test(key) || hasSuspiciousToonKeys(nestedValue);
  });
}

function isAcceptableToonParse(parsed: object): boolean {
  return !hasSuspiciousToonKeys(parsed);
}

export function tryParseToonWithRepair(content: string): object {
  return runRepairWorkflow<ToonRepairStepName>({
    content,
    formatLabel: 'TOON',
    parseCandidate: tryParseToonCandidate,
    repairSteps: [
      { name: 'line-ending normalization', transform: normalizeLineEndings },
      { name: 'whitespace normalization', transform: normalizeStructuredWhitespace },
      { name: 'fence cleanup', transform: stripRepeatedFenceWrappers },
      { name: 'tabular delimiter normalization', transform: normalizeToonTabularDelimiters },
    ],
    workflowOptions: {
      parseAfterEachStep: false,
      acceptParsedResult: (parsed) => isAcceptableToonParse(parsed),
    },
  });
}
