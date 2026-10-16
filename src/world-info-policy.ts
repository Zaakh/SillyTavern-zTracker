export interface WorldInfoEntry {
  uid: number;
  key: string[];
  content: string;
  comment?: string;
  disable: boolean;
  keysecondary?: string[];
}

export function normalizeWorldInfoName(name: string): string {
  return name.trim().toLowerCase();
}

export function formatAllowlistedWorldInfo(
  books: Array<{ name: string; entries: WorldInfoEntry[]; entryIds: number[] }>,
): string {
  const lines: string[] = [];
  for (const book of [...books].sort((a, b) => a.name.localeCompare(b.name))) {
    const onlyIds = new Set(book.entryIds.map((id) => Math.trunc(id)));
    const entries = book.entries.filter((e) => !e.disable && (onlyIds.size === 0 || onlyIds.has(Math.trunc(e.uid))));
    if (entries.length === 0) continue;

    for (const entry of entries) {
      const content = (entry.content ?? '').trim();
      if (!content) continue;
      lines.push(content);
    }
    lines.push('');
  }

  // Keep prompt injection minimal: only entry content.
  return lines.join('\n').trim();
}
