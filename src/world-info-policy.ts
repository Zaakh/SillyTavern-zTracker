import { TrackerWorldInfoPolicyMode } from './config.js';

export interface WorldInfoEntry {
  uid: number;
  key: string[];
  content: string;
  comment?: string;
  disable: boolean;
  keysecondary?: string[];
}

export function shouldIgnoreWorldInfoDuringTrackerBuild(mode: TrackerWorldInfoPolicyMode): boolean {
  return mode !== TrackerWorldInfoPolicyMode.INCLUDE_ALL;
}

export function normalizeWorldInfoName(name: string): string {
  return name.trim().toLowerCase();
}

export function formatAllowlistedWorldInfo(options: {
  allowlistBookNames: string[];
  allowlistEntryIds: number[];
  worldInfos: Record<string, WorldInfoEntry[]>;
}): string {
  const allowBooks = new Set(options.allowlistBookNames.map(normalizeWorldInfoName));
  const allowEntryIds = new Set(options.allowlistEntryIds.map((id) => Math.trunc(id)).filter((id) => id >= 0));

  const bookNames = Object.keys(options.worldInfos).sort((a, b) => a.localeCompare(b));

  const lines: string[] = [];
  for (const bookName of bookNames) {
    const bookAllowed = allowBooks.has(normalizeWorldInfoName(bookName));
    const entries = (options.worldInfos[bookName] ?? []).filter(
      (e) => !e.disable && (bookAllowed || allowEntryIds.has(Math.trunc(e.uid))),
    );
    if (entries.length === 0) continue;

    lines.push(`# ${bookName}`);
    for (const entry of entries) {
      const keys = Array.isArray(entry.key) ? entry.key.filter(Boolean).join(', ') : '';
      const header = keys ? `- (${keys})` : '-';
      const content = (entry.content ?? '').trim();
      if (!content) continue;
      lines.push(`${header} ${content}`);
    }
    lines.push('');
  }

  const body = lines.join('\n').trim();
  if (!body) return '';

  return `World Info (allowlisted)\n\n${body}`;
}
