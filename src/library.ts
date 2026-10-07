import { appleLookupUrl, appleSearchUrl, appleTopUrl, parseLookup, parseSearch, parseTop } from '../shared/apple';
import { api, apiJson, getToken } from './api';
import * as idb from './db';
import { parseFeed, type ParsedFeed } from './feed';
import { DEFAULT_SETTINGS, emit, indexEpisodes, rebuildIndex, set, state, toast } from './store';
import type { ApplePodcast, Episode, EpisodeState, KvRecord, Podcast, Settings } from './types';
import { looksPrivate, podcastIdFor, pool } from './util';

const kvMeta = new Map<string, KvRecord>();
const LAST_SYNC_KEY = 'podcasty.lastSync';

/** Podcasty otevřené jen na prohlédnutí (bez odběru). */
const previews = new Map<string, Podcast>();

export const getPodcast = (id: string) => state.podcasts.get(id) ?? previews.get(id) ?? null;
export const activePodcasts = () => [...state.podcasts.values()].filter((p) => !p.deleted);
export const isSubscribed = (id: string) => !!state.podcasts.get(id) && !state.podcasts.get(id)!.deleted;

// ---------------------------------------------------------------------------
// Start

export async function init() {
  const data = await idb.loadAll();
  state.podcasts = new Map(data.podcasts.map((p) => [p.id, p]));
  state.episodes = new Map(data.episodes.map((e) => [e.id, e]));
  state.states = new Map(data.states.map((s) => [s.episodeId, s]));
  for (const rec of data.kv) applyKv(rec);
  rebuildIndex();
  set({ ready: true, authed: !!getToken() });
}

function applyKv(rec: KvRecord) {
  kvMeta.set(rec.key, rec);
  if (rec.key === 'queue' && Array.isArray(rec.value)) state.queue = rec.value as string[];
  if (rec.key === 'settings' && rec.value) state.settings = { ...DEFAULT_SETTINGS, ...(rec.value as Settings) };
  if (rec.key === 'nowPlaying' && typeof rec.value === 'string' && !state.currentId) state.currentId = rec.value;
}

async function writeKv(key: string, value: unknown) {
  const rec: KvRecord = { key, value, updatedAt: Date.now(), dirty: true };
  kvMeta.set(key, rec);
  await idb.putKv(rec);
  schedulePush();
}

// ---------------------------------------------------------------------------
// Feedy

interface FetchResult {
  notModified: boolean;
  parsed?: ParsedFeed;
  etag: string | null;
  lastModified: string | null;
}

async function fetchFeed(feedUrl: string, podcastId: string, cond?: Podcast): Promise<FetchResult> {
  const headers: Record<string, string> = {};
  if (cond?.etag) headers['if-none-match'] = cond.etag;
  if (cond?.lastModified) headers['if-modified-since'] = cond.lastModified;
  const res = await api(`/api/feed?url=${encodeURIComponent(feedUrl)}`, { headers });
  const etag = res.headers.get('etag');
  const lastModified = res.headers.get('last-modified');
  if (res.status === 304) return { notModified: true, etag, lastModified };
  const parsed = parseFeed(await res.text(), podcastId);
  return { notModified: false, parsed, etag, lastModified };
}

function storeEpisodes(podcastId: string, episodes: Episode[]) {
  for (const [id, e] of state.episodes) if (e.podcastId === podcastId) state.episodes.delete(id);
  for (const e of episodes) state.episodes.set(e.id, e);
  indexEpisodes(podcastId);
}

export async function refreshPodcast(p: Podcast, force = false) {
  try {
    // Bez uložených epizod nemá smysl podmíněný dotaz (304 by nic nepřinesl)
    const hasEpisodes = (state.byPodcast.get(p.id)?.length ?? 0) > 0;
    const r = await fetchFeed(p.feedUrl, p.id, force || !hasEpisodes ? undefined : p);
    const next: Podcast = { ...state.podcasts.get(p.id)!, lastFetchedAt: Date.now(), fetchError: null, etag: r.etag, lastModified: r.lastModified };
    if (r.parsed) {
      next.description = r.parsed.description;
      next.link = r.parsed.link ?? undefined;
      // Obal a název z feedu mají přednost (mohou se změnit)
      next.title = r.parsed.title || next.title;
      next.author = r.parsed.author ?? next.author;
      next.artworkUrl = r.parsed.artworkUrl ?? next.artworkUrl;
      storeEpisodes(p.id, r.parsed.episodes);
      await idb.replaceEpisodes(p.id, r.parsed.episodes, r.parsed.notes);
    }
    state.podcasts.set(p.id, next);
    await idb.putPodcast(next);
  } catch (e) {
    const next = { ...state.podcasts.get(p.id)!, fetchError: e instanceof Error ? e.message : String(e) };
    state.podcasts.set(p.id, next);
    await idb.putPodcast(next);
  }
  emit();
}

export async function refreshAll(force = false) {
  if (state.refreshing) return;
  set({ refreshing: true });
  try {
    // Nejdřív synchronizace (může přinést nové odběry z jiného zařízení)
    await sync().catch(() => {});
    await pool(activePodcasts(), 4, (p) => refreshPodcast(p, force));
  } finally {
    set({ refreshing: false });
  }
}

/** Načte feed bez odběru – pro náhled podcastu z vyhledávání. */
export async function previewFeed(feedUrl: string, hint?: Partial<Podcast>): Promise<Podcast> {
  const id = podcastIdFor(feedUrl);
  if (isSubscribed(id)) return state.podcasts.get(id)!;
  const r = await fetchFeed(feedUrl, id);
  const parsed = r.parsed!;
  const p: Podcast = {
    id,
    feedUrl,
    title: parsed.title || hint?.title || feedUrl,
    author: parsed.author ?? hint?.author ?? null,
    artworkUrl: parsed.artworkUrl ?? hint?.artworkUrl ?? null,
    source: hint?.source ?? 'rss',
    appleId: hint?.appleId ?? null,
    isPrivate: hint?.source === 'apple' ? false : looksPrivate(feedUrl),
    addedAt: 0,
    updatedAt: 0,
    description: parsed.description,
    link: parsed.link ?? undefined,
    etag: r.etag,
    lastModified: r.lastModified,
  };
  previews.set(id, p);
  previewNotes.set(id, parsed.notes);
  storeEpisodes(id, parsed.episodes);
  emit();
  return p;
}
const previewNotes = new Map<string, Map<string, string>>();

export async function getEpisodeNotes(episodeId: string): Promise<string | null> {
  const ep = state.episodes.get(episodeId);
  if (ep && previewNotes.has(ep.podcastId)) return previewNotes.get(ep.podcastId)!.get(episodeId) ?? null;
  return idb.getNotes(episodeId);
}

export async function subscribe(feedUrl: string, hint?: Partial<Podcast>): Promise<string> {
  feedUrl = feedUrl.trim();
  const id = podcastIdFor(feedUrl);
  if (isSubscribed(id)) return id;
  let preview = previews.get(id);
  if (!preview) preview = await previewFeed(feedUrl, hint);
  const now = Date.now();
  const p: Podcast = { ...preview, addedAt: now, updatedAt: now, deleted: false, dirty: true };
  previews.delete(id);
  state.podcasts.set(id, p);
  await idb.putPodcast(p);
  const eps = state.byPodcast.get(id) ?? [];
  await idb.replaceEpisodes(id, eps, previewNotes.get(id) ?? new Map());
  previewNotes.delete(id);
  emit();
  schedulePush(0);
  return id;
}

export async function subscribeApple(a: ApplePodcast): Promise<string> {
  const info = a.feedUrl ? a : await appleLookup(a.appleId);
  if (!info?.feedUrl) throw new Error('Tento podcast je na Apple Podcasts jen v placeném předplatném a nemá veřejné RSS.');
  return subscribe(info.feedUrl, { source: 'apple', appleId: a.appleId, title: a.title, author: a.author, artworkUrl: a.artworkUrl });
}

export async function unsubscribe(id: string) {
  const p = state.podcasts.get(id);
  if (!p) return;
  const tomb: Podcast = { ...p, deleted: true, dirty: true, updatedAt: Date.now() };
  state.podcasts.set(id, tomb);
  for (const [eid, e] of state.episodes) if (e.podcastId === id) state.episodes.delete(eid);
  state.byPodcast.delete(id);
  await idb.deletePodcastData(id);
  await idb.putPodcast(tomb);
  const queue = state.queue.filter((eid) => state.episodes.has(eid));
  if (queue.length !== state.queue.length) await setQueue(queue);
  emit();
  schedulePush(0);
}

export async function setPodcastPrivate(id: string, isPrivate: boolean) {
  const p = state.podcasts.get(id);
  if (!p) return;
  const next = { ...p, isPrivate, dirty: true, updatedAt: Date.now() };
  state.podcasts.set(id, next);
  await idb.putPodcast(next);
  emit();
  schedulePush();
}

// ---------------------------------------------------------------------------
// Apple

/** Apple API voláme přímo z prohlížeče (podporuje CORS); při chybě přes náš Worker. */
async function appleDirect<T>(url: string, parse: (d: unknown) => T, fallback: string): Promise<T> {
  try {
    const res = await fetch(url);
    if (res.ok) return parse(await res.json());
  } catch {
    /* blokováno / offline – zkusit server */
  }
  return apiJson<T>(fallback);
}

export const appleSearch = (q: string) => appleDirect(appleSearchUrl(q), parseSearch, `/api/apple/search?q=${encodeURIComponent(q)}`);
export const appleTop = () => appleDirect(appleTopUrl(), parseTop, '/api/apple/top?country=cz');
export const appleLookup = (id: string) => appleDirect(appleLookupUrl(id), parseLookup, `/api/apple/lookup?id=${id}`);

// ---------------------------------------------------------------------------
// Stav poslechu, fronta, nastavení

export function getState(episodeId: string): EpisodeState | undefined {
  return state.states.get(episodeId);
}

let stateWriteTimer: number | undefined;
const pendingStateWrites = new Map<string, EpisodeState>();

export function updateEpisodeState(episodeId: string, patch: Partial<Pick<EpisodeState, 'position' | 'duration' | 'played'>>, persistNow = false) {
  const ep = state.episodes.get(episodeId);
  const prev = state.states.get(episodeId);
  const next: EpisodeState = {
    episodeId,
    podcastId: ep?.podcastId ?? prev?.podcastId ?? '',
    position: prev?.position ?? 0,
    duration: prev?.duration ?? ep?.duration ?? null,
    played: prev?.played ?? false,
    ...patch,
    updatedAt: Date.now(),
    dirty: true,
  };
  state.states.set(episodeId, next);
  pendingStateWrites.set(episodeId, next);
  emit();
  clearTimeout(stateWriteTimer);
  const flush = () => {
    const items = [...pendingStateWrites.values()];
    pendingStateWrites.clear();
    void idb.putStates(items);
  };
  if (persistNow) flush();
  else stateWriteTimer = window.setTimeout(flush, 1000);
  schedulePush();
}

export function markPlayed(episodeId: string, played: boolean) {
  updateEpisodeState(episodeId, { played, position: 0 }, true);
}

export async function setQueue(ids: string[]) {
  state.queue = [...new Set(ids)];
  emit();
  await writeKv('queue', state.queue);
}

export const playNext = (id: string) => setQueue([id, ...state.queue.filter((x) => x !== id)]);
export const playLast = (id: string) => setQueue([...state.queue.filter((x) => x !== id), id]);
export const removeFromQueue = (id: string) => setQueue(state.queue.filter((x) => x !== id));

export async function updateSettings(patch: Partial<Settings>) {
  state.settings = { ...state.settings, ...patch };
  emit();
  await writeKv('settings', state.settings);
}

export function rememberNowPlaying(id: string) {
  void writeKv('nowPlaying', id);
}

// ---------------------------------------------------------------------------
// Synchronizace se serverem

let pushTimer: number | undefined;
export function schedulePush(delay = 20000) {
  clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => void push().catch(() => {}), delay);
}

let pushing: Promise<void> | null = null;

export function push(keepalive = false): Promise<void> {
  if (!getToken()) return Promise.resolve();
  pushing ??= doPush(keepalive).finally(() => (pushing = null));
  return pushing;
}

async function doPush(keepalive: boolean) {
  const subs = [...state.podcasts.values()].filter((p) => p.dirty);
  for (const p of subs) {
    const body = {
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
    };
    await api('/api/subs', { method: 'PUT', body: JSON.stringify(body), keepalive });
    const cur = state.podcasts.get(p.id);
    if (cur && cur.updatedAt === p.updatedAt) {
      const clean = { ...cur, dirty: false };
      state.podcasts.set(p.id, clean);
      await idb.putPodcast(clean);
    }
  }

  const dirtyStates = [...state.states.values()].filter((s) => s.dirty);
  if (dirtyStates.length) {
    const payload = dirtyStates.map(({ dirty: _d, ...s }) => s);
    await api('/api/state', { method: 'POST', body: JSON.stringify(payload), keepalive });
    const cleaned: EpisodeState[] = [];
    for (const s of dirtyStates) {
      const cur = state.states.get(s.episodeId);
      if (cur && cur.updatedAt === s.updatedAt) {
        const c = { ...cur, dirty: false };
        state.states.set(s.episodeId, c);
        cleaned.push(c);
      }
    }
    await idb.putStates(cleaned);
  }

  for (const rec of [...kvMeta.values()].filter((r) => r.dirty)) {
    await api(`/api/kv/${rec.key}`, { method: 'PUT', body: JSON.stringify({ value: rec.value, updatedAt: rec.updatedAt }), keepalive });
    const cur = kvMeta.get(rec.key);
    if (cur && cur.updatedAt === rec.updatedAt) {
      const c = { ...cur, dirty: false };
      kvMeta.set(rec.key, c);
      await idb.putKv(c);
    }
  }
}

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
    let since = 0;
    try {
      since = Number(localStorage.getItem(LAST_SYNC_KEY) ?? 0);
    } catch {
      /* ignore */
    }
    const data = await apiJson<SyncResponse>(`/api/sync?since=${since}`);
    const newSubs: Podcast[] = [];

    for (const r of data.subs) {
      const local = state.podcasts.get(r.id);
      if (local && local.updatedAt > r.updatedAt) continue;
      if (r.deleted) {
        if (local && !local.deleted) {
          for (const [eid, e] of state.episodes) if (e.podcastId === r.id) state.episodes.delete(eid);
          state.byPodcast.delete(r.id);
          await idb.deletePodcastData(r.id);
        }
        const tomb: Podcast = { ...(local ?? r), ...r, deleted: true, dirty: false };
        state.podcasts.set(r.id, tomb);
        await idb.putPodcast(tomb);
        continue;
      }
      const merged: Podcast = { ...(local ?? {}), ...r, source: r.source === 'apple' ? 'apple' : 'rss', deleted: false, dirty: false };
      state.podcasts.set(r.id, merged);
      await idb.putPodcast(merged);
      if (!local || local.deleted) newSubs.push(merged);
    }

    const changedStates: EpisodeState[] = [];
    for (const r of data.states) {
      const local = state.states.get(r.episodeId);
      if (local && local.updatedAt >= r.updatedAt) continue;
      const s = { ...r, dirty: false };
      state.states.set(r.episodeId, s);
      changedStates.push(s);
    }
    await idb.putStates(changedStates);

    for (const r of data.kv) {
      const local = kvMeta.get(r.key);
      if (local && local.updatedAt >= r.updatedAt) continue;
      const rec = { ...r, dirty: false };
      if (r.key === 'nowPlaying' && state.playing) {
        kvMeta.set(r.key, rec);
      } else {
        if (r.key === 'nowPlaying') state.currentId = null;
        applyKv(rec);
      }
      await idb.putKv(rec);
    }

    try {
      localStorage.setItem(LAST_SYNC_KEY, String(data.now));
    } catch {
      /* ignore */
    }
    set({ lastSyncAt: Date.now() });
    // Nové odběry z jiného zařízení – rovnou stáhnout epizody
    await pool(newSubs, 4, (p) => refreshPodcast(p));
  } finally {
    set({ syncing: false });
  }
}

/** Odhlášení / změna účtu – smaže lokální data. */
export async function resetLocal() {
  await idb.clearAll();
  try {
    localStorage.removeItem(LAST_SYNC_KEY);
  } catch {
    /* ignore */
  }
  kvMeta.clear();
  set({
    podcasts: new Map(),
    episodes: new Map(),
    byPodcast: new Map(),
    states: new Map(),
    queue: [],
    settings: { ...DEFAULT_SETTINGS },
    currentId: null,
  });
}

// ---------------------------------------------------------------------------
// OPML

export function exportOpml(): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const lines = activePodcasts().map((p) => `    <outline type="rss" text="${esc(p.title)}" title="${esc(p.title)}" xmlUrl="${esc(p.feedUrl)}" />`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>Podcasty</title></head>\n  <body>\n${lines.join('\n')}\n  </body>\n</opml>\n`;
}

export async function importOpml(xml: string): Promise<{ added: number; failed: number }> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const urls = [...doc.querySelectorAll('outline[xmlUrl]')].map((o) => o.getAttribute('xmlUrl')!).filter(Boolean);
  let added = 0;
  let failed = 0;
  await pool(urls, 3, async (u) => {
    try {
      await subscribe(u);
      added++;
    } catch {
      failed++;
    }
  });
  toast(`Importováno ${added} podcastů${failed ? `, ${failed} se nepodařilo` : ''}`);
  return { added, failed };
}
