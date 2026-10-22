import { CHAT_MESSAGE_MODULES_KEY, CHAT_MESSAGE_SCHEMA_VALUE_KEY } from './tracker.js';
import { EXTENSION_KEY } from './extension-metadata.js';
import { schemaToExample } from './schema-to-example.js';

// Read-only source of the tracker snapshot shown in the Injection preview: stored chat snapshots first,
// then a schema-derived example. Never goes through the legacy migration, so it cannot mutate messages.

export interface PreviewSnapshotEntry {
  index: number;
  speaker: string;
  snippet: string;
  value: unknown;
}

export type PreviewSnapshotSource =
  | { kind: 'stored'; index: number; value: unknown }
  | { kind: 'example'; value: unknown }
  | { kind: 'none' };

const SNIPPET_LENGTH = 40;

/** Lists the chat messages holding a stored snapshot for the Module, oldest first. */
export function listStoredSnapshots(chat: unknown, moduleId: string): PreviewSnapshotEntry[] {
  if (!Array.isArray(chat)) return [];
  const entries: PreviewSnapshotEntry[] = [];
  chat.forEach((message, index) => {
    const value = message?.extra?.[EXTENSION_KEY]?.[CHAT_MESSAGE_MODULES_KEY]?.[moduleId]?.[CHAT_MESSAGE_SCHEMA_VALUE_KEY];
    if (!value || typeof value !== 'object') return;
    const text = typeof message.mes === 'string' ? message.mes.replace(/\s+/g, ' ').trim() : '';
    entries.push({
      index,
      speaker: typeof message.name === 'string' ? message.name : '',
      snippet: text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH)}…` : text,
      value,
    });
  });
  return entries;
}

/** Picks the requested (default: newest) stored snapshot, else an example from the schema, else none. */
export function resolvePreviewSnapshot(
  entries: PreviewSnapshotEntry[],
  pickedIndex: number | undefined,
  schema: object | undefined,
): PreviewSnapshotSource {
  const entry = entries.find((candidate) => candidate.index === pickedIndex) ?? entries[entries.length - 1];
  if (entry) return { kind: 'stored', index: entry.index, value: entry.value };
  try {
    return { kind: 'example', value: JSON.parse(schemaToExample(schema, 'json')) };
  } catch {
    return { kind: 'none' };
  }
}
