// Shared helpers for extracting and repairing structured model replies before parsing.

const CODE_BLOCK_REGEX = /```(?:[\w-]+\n|\n)([\s\S]*?)```/;
const FULL_FENCE_REGEX = /^```(?:[\w-]+)?[ \t]*\n([\s\S]*?)\n?```$/;
const INVISIBLE_EDGE_CHARS_REGEX = /^[\uFEFF\u200B\u200C\u200D\u2060]+|[\uFEFF\u200B\u200C\u200D\u2060]+$/g;

export interface RepairStep<TStepName extends string> {
  name: TStepName;
  transform: (value: string) => string | undefined;
}

export interface RepairWorkflowOptions {
  parseAfterEachStep?: boolean;
  acceptParsedResult?: (parsed: object, candidate: string) => boolean;
}

export type StructuredRepairFailure<TStepName extends string = string> = Error & {
  attemptedRepairSteps?: TStepName[];
};

export function extractCodeBlockContent(content: string): string {
  const codeBlockMatch = content.match(CODE_BLOCK_REGEX);
  return codeBlockMatch ? codeBlockMatch[1].trim() : content.trim();
}

export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

export function normalizeStructuredWhitespace(content: string): string {
  return content.replace(INVISIBLE_EDGE_CHARS_REGEX, '').trim();
}

export function stripRepeatedFenceWrappers(content: string): string {
  let candidate = content;

  while (true) {
    const match = candidate.match(FULL_FENCE_REGEX);
    if (!match) {
      return candidate;
    }

    candidate = match[1].trim();
  }
}

function hasNestedFenceWrapper(content: string): boolean {
  return FULL_FENCE_REGEX.test(content);
}

export function runRepairWorkflow<TStepName extends string>(options: {
  content: string;
  formatLabel: string;
  parseCandidate: (value: string) => object;
  repairSteps: Array<RepairStep<TStepName>>;
  workflowOptions?: RepairWorkflowOptions;
}): object {
  const { content, formatLabel, parseCandidate, repairSteps, workflowOptions = {} } = options;
  const initialCandidate = extractCodeBlockContent(content);
  const parseAfterEachStep = workflowOptions.parseAfterEachStep !== false;
  const acceptParsedResult = workflowOptions.acceptParsedResult ?? (() => true);

  const parseValidatedCandidate = (candidate: string): object => {
    const parsed = parseCandidate(candidate);
    if (!acceptParsedResult(parsed, candidate)) {
      throw new Error(`${formatLabel} parse produced suspicious output.`);
    }
    return parsed;
  };

  try {
    if (hasNestedFenceWrapper(initialCandidate)) {
      throw new Error('Nested fence wrapper detected.');
    }
    return parseValidatedCandidate(initialCandidate);
  } catch (initialError) {
    const appliedSteps: TStepName[] = [];
    let candidate = content;
    let lastError = initialError;

    for (const step of repairSteps) {
      const nextCandidate = step.transform(candidate);
      if (nextCandidate === undefined || nextCandidate === candidate) {
        continue;
      }

      appliedSteps.push(step.name);
      candidate = nextCandidate;

      if (!parseAfterEachStep) {
        continue;
      }

      try {
        const parsed = parseValidatedCandidate(candidate);
        console.info(`zTracker: repaired ${formatLabel} response`, {
          appliedSteps: [...appliedSteps],
          originalLength: content.length,
          repairedLength: candidate.length,
        });
        return parsed;
      } catch (error) {
        lastError = error;
      }
    }

    if (!parseAfterEachStep && appliedSteps.length > 0) {
      try {
        const parsed = parseValidatedCandidate(candidate);
        console.info(`zTracker: repaired ${formatLabel} response`, {
          appliedSteps: [...appliedSteps],
          originalLength: content.length,
          repairedLength: candidate.length,
        });
        return parsed;
      } catch (error) {
        lastError = error;
      }
    }

    const failure = (lastError instanceof Error ? lastError : new Error(String(lastError))) as StructuredRepairFailure<TStepName>;
    failure.attemptedRepairSteps = [...appliedSteps];
    throw failure;
  }
}