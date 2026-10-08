import { api, apiJson, getToken } from './api';
import * as idb from './db';
import { applyKv, clearKv, dirtyKvRecords, getKvRecord, markKvSynced, storeKv } from './kv';
import { dropPodcastEpisodes, refreshPodcast } from './library';
import { readLocal, writeLocal } from './storage';
import { DEFAULT_SETTINGS, set, state } from './store';
import type { EpisodeState, KvRecord, Podcast } from './types';
import { pool } from './util';

const LAST_SYNC_KEY = 'podcasty.lastSync';
const PUSH_DELAY_MS = 20000;

// ---------------------------------------------------------------------------
// Odeslání lokálních změn

let pushTimer: number | undefined;
export function schedulePush(delay = PUSH_DELAY_MS) {
  clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => void push().catch(() => {}), delay);
}

let pushing: Promise<void> | null = null;

/** Odešle všechny neodeslané změny. `keepalive` = požadavek přežije zavření stránky. */
export function push(keepalive = false): Promise<void> {
  if (!getToken()) return Promise.resolve();
  pushing ??= pushAll(keepalive).finally(() => (pushing = null));
  return pushing;
}

async function pushAll(keepalive: boolean) {
  await pushSubscriptions(keepalive);
  await pushEpisodeStates(keepalive);
  await pushKv(keepalive);
}

async function pushSubscriptions(keepalive: boolean) {
  for (const p of [...state.podcasts.values()].filter((p) => p.dirty)) {
    await api('/api/subs', { method: 'PUT', body: JSON.stringify(toSubscriptionDto(p)), keepalive });
    const cur = state.podcasts.get(p.id);
    if (cur && cur.updatedAt === p.updatedAt) {
      const clean = { ...cur, dirty: false };
      state.podcasts.set(p.id, clean);
      await idb.putPodcast(clean);
    }
  }
}

/** Jen synchronizovaná pole odběru (bez lokálních metadat feedu). */
const toSubscriptionDto = (p: Podcast) => ({
  id: p.id,
  feedUrl: p.feedUrl,
  title: p.title,
  author: p.author,
  artworkUrl: p.artworkUrl,
  source: p.source,
  appleId: p.appleId,
  isPrivate: p.isPrivate,
  addedAt: p.addedAt,
  deleted: !!p.deleted,
  updatedAt: p.updatedAt,
});

async function pushEpisodeStates(keepalive: boolean) {
  const dirty = [...state.states.values()].filter((s) => s.dirty);
  if (!dirty.length) return;
  const payload = dirty.map(({ dirty: _dirty, ...s }) => s);
  await api('/api/state', { method: 'POST', body: JSON.stringify(payload), keepalive });
  const cleaned: EpisodeState[] = [];
  for (const sent of dirty) {
    const cur = state.states.get(sent.episodeId);
    if (cur && cur.updatedAt === sent.updatedAt) {
      const clean = { ...cur, dirty: false };
      state.states.set(sent.episodeId, clean);
      cleaned.push(clean);
    }
  }
  await idb.putStates(cleaned);
}

async function pushKv(keepalive: boolean) {
  for (const rec of dirtyKvRecords()) {
    await api(`/api/kv/${rec.key}`, { method: 'PUT', body: JSON.stringify({ value: rec.value, updatedAt: rec.updatedAt }), keepalive });
    await markKvSynced(rec);
  }
}

// ---------------------------------------------------------------------------
// Stažení změn z jiných zařízení

interface SyncResponse {
  now: number;
  subs: (Omit<Podcast, 'dirty'> & { deleted: boolean })[];
  states: EpisodeState[];
  kv: KvRecord[];
}

export async function sync() {
  if (!getToken() || state.syncing) return;
  set({ syncing: true });
  try {
    await push();
    const since = Number(readLocal(LAST_SYNC_KEY) ?? 0);
    const data = await apiJson<SyncResponse>(`/api/sync?since=${since}`);
    const newSubs = await mergeRemoteSubscriptions(data.subs);
    await mergeRemoteStates(data.states);
    await mergeRemoteKv(data.kv);
    writeLocal(LAST_SYNC_KEY, String(data.now));
    set({ lastSyncAt: Date.now() });
    // Nové odběry z jiného zařízení – rovnou stáhnout epizody
    await pool(newSubs, 4, (p) => refreshPodcast(p));
  } finally {
    set({ syncing: false });
  }
}

/** Vrací odběry, které na tomto zařízení dosud nebyly. */
async function mergeRemoteSubscriptions(remote: SyncResponse['subs']): Promise<Podcast[]> {
  const added: Podcast[] = [];
  for (const r of remote) {
    const local = state.podcasts.get(r.id);
    if (local && local.updatedAt > r.updatedAt) continue;
    if (r.deleted) {
      if (local && !local.deleted) await dropPodcastEpisodes(r.id);
      const tombstone: Podcast = { ...(local ?? r), ...r, deleted: true, dirty: false };
      state.podcasts.set(r.id, tombstone);
      await idb.putPodcast(tombstone);
      continue;
    }
    const merged: Podcast = { ...(local ?? {}), ...r, source: r.source === 'apple' ? 'apple' : 'rss', deleted: false, dirty: false };
    state.podcasts.set(r.id, merged);
    await idb.putPodcast(merged);
    if (!local || local.deleted) added.push(merged);
  }
  return added;
}

async function mergeRemoteStates(remote: EpisodeState[]) {
  const changed: EpisodeState[] = [];
  for (const r of remote) {
    const local = state.states.get(r.episodeId);
    if (local && local.updatedAt >= r.updatedAt) continue;
    const s = { ...r, dirty: false };
    state.states.set(r.episodeId, s);
    changed.push(s);
  }
  await idb.putStates(changed);
}

async function mergeRemoteKv(remote: KvRecord[]) {
  for (const r of remote) {
    const local = getKvRecord(r.key);
    if (local && local.updatedAt >= r.updatedAt) continue;
    const rec = { ...r, dirty: false };
    // Právě hrající epizodu nepřebíjet tím, co hraje jiné zařízení
    if (r.key === 'nowPlaying' && state.playing) {
      storeKv(rec);
    } else {
      if (r.key === 'nowPlaying') state.currentId = null;
      applyKv(rec);
    }
    await idb.putKv(rec);
  }
}

/** Odhlášení / změna účtu – smaže lokální data. */
export async function resetLocal() {
  await idb.clearAll();
  writeLocal(LAST_SYNC_KEY, null);
  clearKv();
  set({
    podcasts: new Map(),
    episodes: new Map(),
    byPodcast: new Map(),
    states: new Map(),
    queue: [],
    categories: [],
    podSettings: {},
    settings: { ...DEFAULT_SETTINGS },
    currentId: null,
  });
}
