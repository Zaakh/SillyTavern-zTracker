/**
 * Builds the "World Info used" popup content from a stored `TrackerWorldInfoReport`: the outcome,
 * applied entries grouped by book with their reason, and a collapsed "Not applied" section. Titles
 * and keys are user data, so everything is inserted as text nodes, never as markup.
 */
import type {
  TrackerWorldInfoOutcome,
  TrackerWorldInfoReport,
  TrackerWorldInfoReportBook,
  WorldInfoReportEntry,
  WorldInfoSkipCause,
  WorldInfoSkippedEntry,
} from '../world-info-policy.js';

const OUTCOME_TEXT: Record<TrackerWorldInfoOutcome, string> = {
  applied: 'World Info was added to the prompt.',
  'none-matched': 'No World Info entry matched, so none was added.',
  excluded: 'World Info is excluded for this tracker, so none was added.',
  'scan-unavailable': 'The World Info scan could not report its entries; the entries below are only those that do not depend on it.',
};

const SKIP_CAUSE_TEXT: Record<WorldInfoSkipCause, string> = {
  scope: 'scope not satisfied',
  'book-missing': 'book not found or has no entries',
  disabled: 'entry disabled',
  'not-in-subset': 'not in the allowed entries',
  empty: 'empty content',
};

const FOOTER_TEXT =
  'From the last generation of this tracker (a part, item or field regeneration replaces it too). Keyword reasons are inferred by zTracker from the scanned messages and may differ from SillyTavern, which scans only its World Info depth setting (and per-entry overrides); other reasons come from SillyTavern.';

function reasonText(entry: WorldInfoReportEntry): string {
  if (entry.via === 'allowlist') return 'added by the allowlist';
  switch (entry.reason) {
    case 'constant':
      return 'constant';
    case 'keyword':
      return `keyword (inferred): ${(entry.matchedKeys ?? []).join(', ')}`;
    case 'recursion':
      return 'activated by recursion';
    case 'min-activations':
      return 'activated to reach the minimum activations';
    default:
      return 'other (card field, macro or entry settings)';
  }
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function listOf(doc: Document, items: string[]): HTMLUListElement {
  const list = el(doc, 'ul');
  for (const item of items) list.append(el(doc, 'li', item));
  return list;
}

const skippedText = (skipped: WorldInfoSkippedEntry) =>
  skipped.title !== undefined ? `${skipped.title} (#${skipped.uid}): ${SKIP_CAUSE_TEXT[skipped.cause]}` : SKIP_CAUSE_TEXT[skipped.cause];

function appendBook(doc: Document, root: HTMLElement, book: TrackerWorldInfoReportBook): void {
  const section = el(doc, 'div', undefined, 'ztracker-wi-report-book');
  section.append(el(doc, 'h4', book.book));

  if (book.applied.length > 0 || book.moreApplied) {
    const items = book.applied.map((e) => `${e.title} (#${e.uid}): ${reasonText(e)}`);
    if (book.moreApplied) items.push(`+${book.moreApplied} more`);
    section.append(listOf(doc, items));
  }

  if (book.skipped.length > 0 || book.moreSkipped) {
    const details = el(doc, 'details', undefined, 'ztracker-wi-report-skipped');
    const count = book.skipped.length + (book.moreSkipped ?? 0);
    details.append(el(doc, 'summary', `Not applied (${count})`));
    const items = book.skipped.map(skippedText);
    if (book.moreSkipped) items.push(`+${book.moreSkipped} more`);
    details.append(listOf(doc, items));
    section.append(details);
  }

  root.append(section);
}

/** `report` is undefined for trackers generated before the record existed; nothing is reconstructed. */
export function buildWorldInfoReportElement(report: TrackerWorldInfoReport | undefined, doc: Document = document): HTMLElement {
  const root = el(doc, 'div', undefined, 'ztracker-wi-report');
  root.append(el(doc, 'h3', 'World Info used'));

  if (!report) {
    root.append(el(doc, 'p', 'The World Info used was not recorded for this tracker.'));
    return root;
  }

  root.append(el(doc, 'p', OUTCOME_TEXT[report.outcome] ?? OUTCOME_TEXT['scan-unavailable']));
  for (const book of report.books ?? []) appendBook(doc, root, book);
  if (report.moreBooks) root.append(el(doc, 'p', `+${report.moreBooks} more books`));
  root.append(el(doc, 'small', FOOTER_TEXT, 'ztracker-wi-report-footer'));
  return root;
}
