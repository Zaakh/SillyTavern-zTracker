import type { WorldInfoEntry } from './world-info-policy.js';

interface CsrfTokenResponse {
  token?: string;
}

interface WorldInfoBookResponse {
  entries?: Record<string, any>;
}

let csrfTokenPromise: Promise<string> | null = null;

async function getCsrfToken(): Promise<string> {
  if (!csrfTokenPromise) {
    csrfTokenPromise = (async () => {
      const res = await fetch('/csrf-token', { cache: 'no-cache' });
      if (!res.ok) {
        throw new Error(`Failed to fetch CSRF token (${res.status})`);
      }
      const json = (await res.json()) as CsrfTokenResponse;
      const token = String(json?.token ?? '').trim();
      if (!token) {
        throw new Error('CSRF token missing in /csrf-token response');
      }
      return token;
    })();
  }
  return csrfTokenPromise;
}

function toWorldInfoEntry(uidFallback: number, raw: any): WorldInfoEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const uid = Number.isFinite(Number(raw.uid)) ? Number(raw.uid) : uidFallback;
  const key = Array.isArray(raw.key) ? raw.key.map((x: any) => String(x)).filter(Boolean) : [];
  const keysecondary = Array.isArray(raw.keysecondary)
    ? raw.keysecondary.map((x: any) => String(x)).filter(Boolean)
    : undefined;

  // SillyTavern stores `disable` (boolean). Some older formats may store `enabled`.
  const disable = typeof raw.disable === 'boolean' ? raw.disable : raw.enabled === false;

  const content = typeof raw.content === 'string' ? raw.content : '';
  const comment = typeof raw.comment === 'string' ? raw.comment : undefined;

  return {
    uid,
    key,
    keysecondary,
    content,
    comment,
    disable,
  };
}

/**
 * Loads a lorebook by name via SillyTavern's backend API.
 * This is intended for same-origin usage inside the SillyTavern UI.
 */
export async function loadWorldInfoBookByName(
  name: string,
  options?: { debug?: boolean },
): Promise<{ name: string; entries: WorldInfoEntry[] } | null> {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return null;

  try {
    const token = await getCsrfToken();
    const res = await fetch('/api/worldinfo/get', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
      },
      body: JSON.stringify({ name: trimmed }),
      cache: 'no-cache',
    });

    if (!res.ok) {
      if (options?.debug) console.debug('zTracker: loadWorldInfoBookByName failed', trimmed, res.status);
      return null;
    }

    const json = (await res.json()) as WorldInfoBookResponse;
    const entriesRecord = json?.entries;
    if (!entriesRecord || typeof entriesRecord !== 'object' || Array.isArray(entriesRecord)) {
      if (options?.debug) console.debug('zTracker: lorebook response missing entries', trimmed, json);
      return null;
    }

    const entries: WorldInfoEntry[] = [];
    for (const [uidKey, raw] of Object.entries(entriesRecord)) {
      const uidFallback = Number.isFinite(Number(uidKey)) ? Number(uidKey) : -1;
      const mapped = toWorldInfoEntry(uidFallback, raw);
      if (mapped) entries.push(mapped);
    }

    return { name: trimmed, entries };
  } catch (err) {
    if (options?.debug) console.debug('zTracker: loadWorldInfoBookByName threw', trimmed, err);
    return null;
  }
}
