import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Episode, EpisodeState, KvRecord, Podcast } from './types';

interface Schema extends DBSchema {
  podcasts: { key: string; value: Podcast };
  episodes: { key: string; value: Episode; indexes: { podcastId: string } };
  notes: { key: string; value: { id: string; html: string } };
  states: { key: string; value: EpisodeState };
  kv: { key: string; value: KvRecord };
}

type DB = IDBPDatabase<Schema>;
let dbp: Promise<DB> | null = null;

function open(): Promise<DB> {
  const p = openDB<Schema>('podcasty', 1, {
    upgrade(d) {
      d.createObjectStore('podcasts', { keyPath: 'id' });
      d.createObjectStore('episodes', { keyPath: 'id' }).createIndex('podcastId', 'podcastId');
      d.createObjectStore('notes', { keyPath: 'id' });
      d.createObjectStore('states', { keyPath: 'episodeId' });
      d.createObjectStore('kv', { keyPath: 'key' });
    },
    // iOS Safari umí spojení zavřít (appka na pozadí, úklid úložiště) – příště otevřít znovu
    terminated() {
      if (dbp === p) dbp = null;
    },
    blocking() {
      void p.then((d) => d.close());
      if (dbp === p) dbp = null;
    },
  });
  p.then((d) => d.addEventListener('close', () => dbp === p && (dbp = null))).catch(() => (dbp = null));
  return p;
}

const isClosedError = (e: unknown) =>
  e instanceof DOMException && (e.name === 'InvalidStateError' || /clos/i.test(e.message));

/** Provede operaci nad DB; pokud bylo spojení mezitím zavřené, otevře nové a zkusí to znovu. */
async function withDb<T>(fn: (d: DB) => Promise<T>): Promise<T> {
  dbp ??= open();
  try {
    return await fn(await dbp);
  } catch (e) {
    if (!isClosedError(e)) throw e;
    dbp = open();
    return fn(await dbp);
  }
}

export async function loadAll() {
  return withDb(async (d) => {
    const [podcasts, episodes, states, kv] = await Promise.all([
      d.getAll('podcasts'),
      d.getAll('episodes'),
      d.getAll('states'),
      d.getAll('kv'),
    ]);
    return { podcasts, episodes, states, kv };
  });
}

/** Nahradí epizody podcastu novou sadou (zmizelé z feedu smaže). */
export async function replaceEpisodes(podcastId: string, episodes: Episode[], notes: Map<string, string>) {
  return withDb(async (d) => {
    const tx = d.transaction(['episodes', 'notes'], 'readwrite');
    const eps = tx.objectStore('episodes');
    const nts = tx.objectStore('notes');
    const keep = new Set(episodes.map((e) => e.id));
    const existing = await eps.index('podcastId').getAllKeys(podcastId);
    for (const key of existing) {
      if (!keep.has(key)) {
        eps.delete(key);
        nts.delete(key);
      }
    }
    for (const e of episodes) eps.put(e);
    for (const [id, html] of notes) nts.put({ id, html });
    await tx.done;
  });
}

export async function deletePodcastData(podcastId: string) {
  return withDb(async (d) => {
    const tx = d.transaction(['podcasts', 'episodes', 'notes'], 'readwrite');
    const keys = await tx.objectStore('episodes').index('podcastId').getAllKeys(podcastId);
    for (const k of keys) {
      tx.objectStore('episodes').delete(k);
      tx.objectStore('notes').delete(k);
    }
    tx.objectStore('podcasts').delete(podcastId);
    await tx.done;
  });
}

export async function getNotes(episodeId: string): Promise<string | null> {
  return withDb(async (d) => (await d.get('notes', episodeId))?.html ?? null);
}

export async function putPodcast(p: Podcast) {
  await withDb((d) => d.put('podcasts', p));
}

export async function putStates(states: EpisodeState[]) {
  return withDb(async (d) => {
    const tx = d.transaction('states', 'readwrite');
    for (const s of states) tx.store.put(s);
    await tx.done;
  });
}

export async function putKv(rec: KvRecord) {
  await withDb((d) => d.put('kv', rec));
}

export async function clearAll() {
  return withDb(async (d) => {
    await Promise.all((['podcasts', 'episodes', 'notes', 'states', 'kv'] as const).map((s) => d.clear(s)));
  });
}
