import * as idb from './db';
import { DEFAULT_SETTINGS, state } from './store';
import { schedulePush } from './sync';
import type { Category, KvRecord, PodcastSettings, Settings } from './types';

/**
 * Synchronizovaná úložiště klíč → JSON (fronta, kategorie, nastavení, statistiky, záložky).
 * Každý záznam nese čas změny; při synchronizaci vyhrává novější (last-write-wins).
 */
const records = new Map<string, KvRecord>();

/** Promítne záznam do stavu appky (fronta, kategorie, nastavení…). */
export function applyKv(rec: KvRecord) {
  records.set(rec.key, rec);
  if (rec.key === 'queue' && Array.isArray(rec.value)) state.queue = rec.value as string[];
  if (rec.key === 'categories' && Array.isArray(rec.value)) state.categories = rec.value as Category[];
  if (rec.key === 'podcastSettings' && rec.value && typeof rec.value === 'object') state.podSettings = rec.value as Record<string, PodcastSettings>;
  if (rec.key === 'settings' && rec.value) state.settings = { ...DEFAULT_SETTINGS, ...(rec.value as Settings) };
  if (rec.key === 'nowPlaying' && typeof rec.value === 'string' && !state.currentId) state.currentId = rec.value;
}

/** Uloží záznam bez promítnutí do stavu appky. */
export function storeKv(rec: KvRecord) {
  records.set(rec.key, rec);
}

export async function writeKv(key: string, value: unknown) {
  const rec: KvRecord = { key, value, updatedAt: Date.now(), dirty: true };
  records.set(key, rec);
  await idb.putKv(rec);
  schedulePush();
}

export const readKv = <T>(key: string) => records.get(key)?.value as T | undefined;

export const getKvRecord = (key: string) => records.get(key);

/** Záznamy podle prefixu (např. statistiky ze všech zařízení). */
export const kvEntries = (prefix: string) => [...records.values()].filter((r) => r.key.startsWith(prefix));

export const dirtyKvRecords = () => [...records.values()].filter((r) => r.dirty);

/** Po odeslání na server: označit jako synchronizované, pokud se mezitím nezměnilo. */
export async function markKvSynced(sent: KvRecord) {
  const cur = records.get(sent.key);
  if (!cur || cur.updatedAt !== sent.updatedAt) return;
  const clean = { ...cur, dirty: false };
  records.set(sent.key, clean);
  await idb.putKv(clean);
}

export const clearKv = () => records.clear();
