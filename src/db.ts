import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Episode, EpisodeState, KvRecord, Podcast } from './types';

interface Schema extends DBSchema {
  podcasts: { key: string; value: Podcast };
  episodes: { key: string; value: Episode; indexes: { podcastId: string } };
  notes: { key: string; value: { id: string; html: string } };
  states: { key: string; value: EpisodeState };
  kv: { key: string; value: KvRecord };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;

export function db() {
  dbp ??= openDB<Schema>('podcasty', 1, {
    upgrade(d) {
      d.createObjectStore('podcasts', { keyPath: 'id' });
      d.createObjectStore('episodes', { keyPath: 'id' }).createIndex('podcastId', 'podcastId');
      d.createObjectStore('notes', { keyPath: 'id' });
      d.createObjectStore('states', { keyPath: 'episodeId' });
      d.createObjectStore('kv', { keyPath: 'key' });
    },
  });
  return dbp;
}

export async function loadAll() {
  const d = await db();
  const [podcasts, episodes, states, kv] = await Promise.all([
    d.getAll('podcasts'),
    d.getAll('episodes'),
    d.getAll('states'),
    d.getAll('kv'),
  ]);
  return { podcasts, episodes, states, kv };
}

/** Nahradí epizody podcastu novou sadou (zmizelé z feedu smaže). */
export async function replaceEpisodes(podcastId: string, episodes: Episode[], notes: Map<string, string>) {
  const d = await db();
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
}

export async function deletePodcastData(podcastId: string) {
  const d = await db();
  const tx = d.transaction(['podcasts', 'episodes', 'notes'], 'readwrite');
  const keys = await tx.objectStore('episodes').index('podcastId').getAllKeys(podcastId);
  for (const k of keys) {
    tx.objectStore('episodes').delete(k);
    tx.objectStore('notes').delete(k);
  }
  tx.objectStore('podcasts').delete(podcastId);
  await tx.done;
}

export async function getNotes(episodeId: string): Promise<string | null> {
  return (await (await db()).get('notes', episodeId))?.html ?? null;
}

export async function putPodcast(p: Podcast) {
  await (await db()).put('podcasts', p);
}

export async function putStates(states: EpisodeState[]) {
  const d = await db();
  const tx = d.transaction('states', 'readwrite');
  for (const s of states) tx.store.put(s);
  await tx.done;
}

export async function putKv(rec: KvRecord) {
  await (await db()).put('kv', rec);
}

export async function clearAll() {
  const d = await db();
  await Promise.all((['podcasts', 'episodes', 'notes', 'states', 'kv'] as const).map((s) => d.clear(s)));
}
