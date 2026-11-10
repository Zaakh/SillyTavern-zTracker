/**
 * Builds the "World Info used" popup content from a stored `TrackerWorldInfoReport`: the outcome,
 * a one-line activation summary, applied entries grouped by book with their reason, and a collapsed
 * "Not applied" section. Titles and keys are user data, so everything is inserted as text nodes,
 * never as markup. Entries that carry a uid are focusable buttons that call `onOpenEntry`.
 */
import { appliedCount, summarizeAppliedReasons } from '../world-info-policy.js';
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

export type OpenEntryHandler = (target: { book: string; uid: number }) => void;

interface ListItem {
  text: string;
  /** Present when the row can be opened in the lorebook editor. */
  uid?: number;
}

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

function listOf(doc: Document, book: string, items: ListItem[], onOpenEntry?: OpenEntryHandler): HTMLUListElement {
  const list = el(doc, 'ul');
  for (const item of items) {
    const li = el(doc, 'li', item.text);
    const uid = item.uid;
    if (onOpenEntry && uid !== undefined) {
      const open = () => onOpenEntry({ book, uid });
      li.className = 'ztracker-wi-entry';
      li.setAttribute('role', 'button');
      li.tabIndex = 0;
      li.title = 'Open in lorebook';
      li.addEventListener('click', open);
      li.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (!event.repeat) open();
      });
    }
    list.append(li);
  }
  return list;
}

const skippedText = (skipped: WorldInfoSkippedEntry): string =>
  skipped.title !== undefined ? `${skipped.title} (#${skipped.uid}): ${SKIP_CAUSE_TEXT[skipped.cause]}` : SKIP_CAUSE_TEXT[skipped.cause];

function appendBook(doc: Document, root: HTMLElement, book: TrackerWorldInfoReportBook, onOpenEntry?: OpenEntryHandler): void {
  const section = el(doc, 'div', undefined, 'ztracker-wi-report-book');
  section.append(el(doc, 'h4', book.book));

  if (book.applied.length > 0 || book.moreApplied) {
    const items: ListItem[] = book.applied.map((e) => ({ text: `${e.title} (#${e.uid}): ${reasonText(e)}`, uid: e.uid }));
    if (book.moreApplied) items.push({ text: `+${book.moreApplied} more` });
    section.append(listOf(doc, book.book, items, onOpenEntry));
  }

  if (book.skipped.length > 0 || book.moreSkipped) {
    const details = el(doc, 'details', undefined, 'ztracker-wi-report-skipped');
    const count = book.skipped.length + (book.moreSkipped ?? 0);
    details.append(el(doc, 'summary', `Not applied (${count})`));
    const items: ListItem[] = book.skipped.map((s) => ({ text: skippedText(s), uid: s.uid }));
    if (book.moreSkipped) items.push({ text: `+${book.moreSkipped} more` });
    details.append(listOf(doc, book.book, items, onOpenEntry));
    section.append(details);
  }

  root.append(section);
}

/** One line counting applied entries by activation path, empty groups omitted. Capped-off entries have no stored reason, so they are named separately. */
function summaryLine(report: TrackerWorldInfoReport): string {
  const s = summarizeAppliedReasons(report);
  const notListed = report.books.reduce((sum, b) => sum + (b.moreApplied ?? 0), 0);
  return [
    ['Scan', s.scan],
    ['Recursion', s.recursion],
    ['Minimum activations', s.minActivations],
    ['Allowlist', s.allowlist],
    ['Not itemized', notListed],
  ]
    .filter(([, n]) => n)
    .map(([label, n]) => `${label}: ${n}`)
    .join(' | ');
}

/** `report` is undefined for trackers generated before the record existed; nothing is reconstructed. */
export function buildWorldInfoReportElement(
  report: TrackerWorldInfoReport | undefined,
  onOpenEntry?: OpenEntryHandler,
  doc: Document = document,
): HTMLElement {
  const root = el(doc, 'div', undefined, 'ztracker-wi-report');
  root.append(el(doc, 'h3', 'World Info used'));

  if (!report) {
    root.append(el(doc, 'p', 'The World Info used was not recorded for this tracker.'));
    return root;
  }

  root.append(el(doc, 'p', OUTCOME_TEXT[report.outcome] ?? OUTCOME_TEXT['scan-unavailable']));
  const summary = appliedCount(report).count > 0 ? summaryLine(report) : '';
  if (summary) root.append(el(doc, 'p', summary, 'ztracker-wi-report-summary'));
  for (const book of report.books ?? []) appendBook(doc, root, book, onOpenEntry);
  if (report.moreBooks) root.append(el(doc, 'p', `+${report.moreBooks} more books`));
  root.append(el(doc, 'small', FOOTER_TEXT, 'ztracker-wi-report-footer'));
  return root;
}
