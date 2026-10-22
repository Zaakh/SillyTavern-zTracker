/**
 * @jest-environment jsdom
 */

import { buildWorldInfoReportElement } from '../ui/world-info-report-popup.js';
import type { TrackerWorldInfoReport } from '../world-info-policy.js';

describe('buildWorldInfoReportElement', () => {
  const report: TrackerWorldInfoReport = {
    outcome: 'applied',
    books: [
      {
        book: 'Lore',
        applied: [
          { uid: 1, title: 'Dragon', via: 'scan', reason: 'keyword', matchedKeys: ['dragon', 'wyrm'] },
          { uid: 2, title: 'Realm', via: 'scan', reason: 'constant' },
          { uid: 3, title: 'Cave', via: 'scan', reason: 'recursion' },
          { uid: 4, title: 'Sky', via: 'scan', reason: 'other' },
        ],
        skipped: [],
        moreApplied: 7,
      },
      {
        book: 'Always Book',
        applied: [{ uid: 9, title: 'Always', via: 'allowlist' }],
        skipped: [
          { uid: 10, title: 'Off', cause: 'disabled' },
          { cause: 'scope' },
        ],
        moreSkipped: 3,
      },
    ],
  };

  test('shows the outcome, applied entries grouped by book with their reasons, and a collapsed not-applied section', () => {
    const root = buildWorldInfoReportElement(report);
    const text = root.textContent ?? '';

    expect(text).toContain('World Info was added to the prompt.');
    expect(root.querySelectorAll('h4')).toHaveLength(2);
    expect(text).toContain('Dragon (#1): keyword (inferred): dragon, wyrm');
    expect(text).toContain('Realm (#2): constant');
    expect(text).toContain('Cave (#3): activated by recursion');
    expect(text).toContain('Sky (#4): other');
    expect(text).toContain('Always (#9): added by the allowlist');

    const details = root.querySelector('details');
    expect(details).not.toBeNull();
    expect(details!.hasAttribute('open')).toBe(false);
    expect(details!.textContent).toContain('Not applied (5)');
    expect(details!.textContent).toContain('Off (#10): entry disabled');
    expect(details!.textContent).toContain('scope not satisfied');
  });

  test('shows "+N more" for capped lists', () => {
    const text = buildWorldInfoReportElement(report).textContent ?? '';
    expect(text).toContain('+7 more');
    expect(text).toContain('+3 more');
  });

  test('shows how many books were left out', () => {
    expect(buildWorldInfoReportElement({ outcome: 'applied', books: [], moreBooks: 6 }).textContent).toContain('+6 more books');
  });

  test('footer states it is from the last generation and that keyword reasons are inferred', () => {
    const footer = buildWorldInfoReportElement(report).querySelector('.ztracker-wi-report-footer')?.textContent ?? '';
    expect(footer).toContain('last generation of this tracker');
    expect(footer).toContain('inferred');
  });

  test('a missing record says it was not recorded and reconstructs nothing', () => {
    const root = buildWorldInfoReportElement(undefined);
    expect(root.textContent).toContain('not recorded');
    expect(root.querySelector('h4')).toBeNull();
    expect(root.querySelector('details')).toBeNull();
  });

  test.each([
    ['none-matched', 'No World Info entry matched'],
    ['excluded', 'excluded for this tracker'],
    ['scan-unavailable', 'could not report its entries'],
  ] as const)('outcome %s has its own message', (outcome, expected) => {
    expect(buildWorldInfoReportElement({ outcome, books: [] }).textContent).toContain(expected);
  });

  test('titles, books and keys containing HTML are shown as text, never interpreted', () => {
    const root = buildWorldInfoReportElement({
      outcome: 'applied',
      books: [
        {
          book: '<img src=x onerror=alert(1)>',
          applied: [{ uid: 1, title: '<b>bold</b><script>alert(2)</script>', via: 'scan', reason: 'keyword', matchedKeys: ['<i>key</i>'] }],
          skipped: [{ uid: 2, title: '<u>skipped</u>', cause: 'disabled' }],
        },
      ],
    });

    expect(root.querySelector('img, b, i, u, script')).toBeNull();
    expect(root.textContent).toContain('<b>bold</b><script>alert(2)</script>');
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(root.textContent).toContain('<i>key</i>');
  });
});
