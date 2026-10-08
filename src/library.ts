import { appleLookupUrl, appleSearchUrl, appleTopUrl, parseLookup, parseSearch, parseTop } from '../shared/apple';
import { api, apiJson, getToken } from './api';
import * as idb from './db';
import { parseFeed, type ParsedFeed } from './feed';
import { applyKv, writeKv } from './kv';
import { emit, indexEpisodes, rebuildIndex, set, state } from './store';
import { schedulePush, sync } from './sync';
import type { ApplePodcast, Category, Episode, EpisodeState, Podcast, PodcastSettings, Settings } from './types';
import { errorMessage, hashId, looksPrivate, podcastIdFor, pool, randomId } from './util';

/** Podcasty otevřené jen na prohlédnutí (bez odběru) a jejich poznámky k epizodám. */
const previews = new Map<string, Podcast>();
const previewNotes = new Map<string, Map<string, string>>();

export const getPodcast = (id: string) => state.podcasts.get(id) ?? previews.get(id) ?? null;
export const activePodcasts = () => [...state.podcasts.values()].filter((p) => !p.deleted);
export const isSubscribed = (id: string) => !!state.podcasts.get(id) && !state.podcasts.get(id)!.deleted;

/** Obal epizody, jinak obal podcastu. */
export const episodeArtwork = (ep: Episode | null | undefined) => ep?.artworkUrl || (ep && getPodcast(ep.podcastId)?.artworkUrl) || null;

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

// ---------------------------------------------------------------------------
// Feedy

interface FetchResult {
  parsed?: ParsedFeed;
  etag: string | null;
  lastModified: string | null;
  contentHash?: string;
}

/** Zvýšit při změně parseru – vynutí nové zpracování všech feedů. */
const PARSER_VERSION = 2;
const AUTO_QUEUE_MAX_AGE_MS = 7 * 86400000;

/** Pustí prohlížeč ke slovu (vykreslení, dotyk) před náročnou prací. */
const yieldToMain = () => new Promise<void>((r) => setTimeout(r, 0));

/** Stáhne feed; `cached` = dřívější stav pro podmíněný dotaz. Beze změny vrátí výsledek bez `parsed`. */
async function fetchFeed(feedUrl: string, podcastId: string, cached?: Podcast): Promise<FetchResult> {
  const headers: Record<string, string> = {};
  if (cached?.etag) headers['if-none-match'] = cached.etag;
  if (cached?.lastModified) headers['if-modified-since'] = cached.lastModified;
  const res = await api(`/api/feed?url=${encodeURIComponent(feedUrl)}`, { headers });
  const etag = res.headers.get('etag');
  const lastModified = res.headers.get('last-modified');
  if (res.status === 304) return { etag, lastModified, contentHash: cached?.contentHash };
  const text = await res.text();
  // Mnoho serverů ETag nepodporuje – feed beze změny poznáme podle otisku a nemusíme ho parsovat
  const contentHash = `${PARSER_VERSION}:${text.length}:${hashId(text)}`;
  if (cached?.contentHash === contentHash) return { etag, lastModified, contentHash };
  await yieldToMain();
  return { parsed: parseFeed(text, podcastId), etag, lastModified, contentHash };
}

function storeEpisodes(podcastId: string, episodes: Episode[]) {
  for (const e of state.byPodcast.get(podcastId) ?? []) state.episodes.delete(e.id);
  for (const e of episodes) state.episodes.set(e.id, e);
  indexEpisodes(podcastId);
}

/** Odstraní epizody podcastu z paměti i z lokální databáze. */
export async function dropPodcastEpisodes(podcastId: string) {
  for (const [id, e] of state.episodes) if (e.podcastId === podcastId) state.episodes.delete(id);
  state.byPodcast.delete(podcastId);
  await idb.deletePodcastData(podcastId);
}

/** `ignoreCache` = stáhnout a zpracovat feed, i když se podle serveru nezměnil. */
export async function refreshPodcast(p: Podcast, { ignoreCache = false } = {}) {
  try {
    // Bez uložených epizod nemá smysl podmíněný dotaz (304 by nic nepřinesl)
    const hasEpisodes = (state.byPodcast.get(p.id)?.length ?? 0) > 0;
    const result = await fetchFeed(p.feedUrl, p.id, ignoreCache || !hasEpisodes ? undefined : p);
    const prev = state.podcasts.get(p.id)!;
    let next: Podcast = { ...prev, lastFetchedAt: Date.now(), fetchError: null, etag: result.etag, lastModified: result.lastModified, contentHash: result.contentHash };
    if (result.parsed) next = await applyParsedFeed(next, result.parsed);
    await savePodcast(next);
    // Beze změny není co překreslovat
    if (!result.parsed && !prev.fetchError) return;
  } catch (e) {
    await savePodcast({ ...state.podcasts.get(p.id)!, fetchError: errorMessage(e) });
  }
  emit();
}

async function applyParsedFeed(p: Podcast, feed: ParsedFeed): Promise<Podcast> {
  const previousIds = new Set((state.byPodcast.get(p.id) ?? []).map((e) => e.id));
  storeEpisodes(p.id, feed.episodes);
  await idb.replaceEpisodes(p.id, feed.episodes, feed.notes);
  // Při úplně prvním stažení jsou „nové“ všechny díly – do fronty jen to, co přibylo
  if (previousIds.size) await autoQueueNewEpisodes(p.id, feed.episodes.filter((e) => !previousIds.has(e.id)));
  return {
    ...p,
    description: feed.description,
    link: feed.link ?? undefined,
    // Obal a název z feedu mají přednost (mohou se změnit)
    title: feed.title || p.title,
    author: feed.author ?? p.author,
    artworkUrl: feed.artworkUrl ?? p.artworkUrl,
  };
}

async function autoQueueNewEpisodes(podcastId: string, added: Episode[]) {
  if (!state.podSettings[podcastId]?.autoQueue) return;
  const minDate = Date.now() - AUTO_QUEUE_MAX_AGE_MS;
  const fresh = added.filter((e) => e.pubDate > minDate && !state.queue.includes(e.id));
  // Epizody jsou od nejnovější – do fronty od nejstarší
  if (fresh.length) await setQueue([...state.queue, ...fresh.reverse().map((e) => e.id)]);
}

async function savePodcast(p: Podcast) {
  state.podcasts.set(p.id, p);
  await idb.putPodcast(p);
}

export async function refreshAll() {
  if (state.refreshing) return;
  set({ refreshing: true });
  try {
    // Nejdřív synchronizace (může přinést nové odběry z jiného zařízení)
    await sync().catch(() => {});
    await pool(activePodcasts(), 4, (p) => refreshPodcast(p));
  } finally {
    set({ refreshing: false });
  }
}

/** Načte feed bez odběru – pro náhled podcastu z vyhledávání. */
export async function previewFeed(feedUrl: string, hint?: Partial<Podcast>): Promise<Podcast> {
  const id = podcastIdFor(feedUrl);
  if (isSubscribed(id)) return state.podcasts.get(id)!;
  const result = await fetchFeed(feedUrl, id);
  const feed = result.parsed!;
  const p: Podcast = {
    id,
    feedUrl,
    title: feed.title || hint?.title || feedUrl,
    author: feed.author ?? hint?.author ?? null,
    artworkUrl: feed.artworkUrl ?? hint?.artworkUrl ?? null,
    source: hint?.source ?? 'rss',
    appleId: hint?.appleId ?? null,
    isPrivate: hint?.source === 'apple' ? false : looksPrivate(feedUrl),
    addedAt: 0,
    updatedAt: 0,
    description: feed.description,
    link: feed.link ?? undefined,
    etag: result.etag,
    lastModified: result.lastModified,
    contentHash: result.contentHash,
  };
  previews.set(id, p);
  previewNotes.set(id, feed.notes);
  storeEpisodes(id, feed.episodes);
  emit();
  return p;
}

export async function getEpisodeNotes(episodeId: string): Promise<string | null> {
  const ep = state.episodes.get(episodeId);
  const notes = ep && previewNotes.get(ep.podcastId);
  if (notes) return notes.get(episodeId) ?? null;
  return idb.getNotes(episodeId);
}

export async function subscribe(feedUrl: string, hint?: Partial<Podcast>): Promise<string> {
  feedUrl = feedUrl.trim();
  const id = podcastIdFor(feedUrl);
  if (isSubscribed(id)) return id;
  const preview = previews.get(id) ?? (await previewFeed(feedUrl, hint));
  const now = Date.now();
  previews.delete(id);
  await savePodcast({ ...preview, addedAt: now, updatedAt: now, deleted: false, dirty: true });
  await idb.replaceEpisodes(id, state.byPodcast.get(id) ?? [], previewNotes.get(id) ?? new Map());
  previewNotes.delete(id);
  emit();
  schedulePush(0);
  return id;
}

export async function unsubscribe(id: string) {
  const p = state.podcasts.get(id);
  if (!p) return;
  const tombstone: Podcast = { ...p, deleted: true, dirty: true, updatedAt: Date.now() };
  state.podcasts.set(id, tombstone);
  await dropPodcastEpisodes(id);
  await idb.putPodcast(tombstone);
  const queue = state.queue.filter((eid) => state.episodes.has(eid));
  if (queue.length !== state.queue.length) await setQueue(queue);
  emit();
  schedulePush(0);
}

export async function setPodcastPrivate(id: string, isPrivate: boolean) {
  const p = state.podcasts.get(id);
  if (!p) return;
  await savePodcast({ ...p, isPrivate, dirty: true, updatedAt: Date.now() });
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

/** RSS adresa podcastu z Apple (žebříček ji neobsahuje – dohledá se). */
async function appleFeedUrl(a: ApplePodcast): Promise<string> {
  const info = a.feedUrl ? a : await appleLookup(a.appleId);
  if (!info?.feedUrl) throw new Error('Tento podcast je na Apple Podcasts jen v placeném předplatném a nemá veřejné RSS.');
  return info.feedUrl;
}

const appleHint = (a: ApplePodcast): Partial<Podcast> => ({ source: 'apple', appleId: a.appleId, title: a.title, author: a.author, artworkUrl: a.artworkUrl });

export const previewApple = async (a: ApplePodcast) => previewFeed(await appleFeedUrl(a), appleHint(a));
export const subscribeApple = async (a: ApplePodcast) => subscribe(await appleFeedUrl(a), appleHint(a));

// ---------------------------------------------------------------------------
// Stav poslechu, fronta

export function getState(episodeId: string): EpisodeState | undefined {
  return state.states.get(episodeId);
}

const STATE_WRITE_DELAY_MS = 1000;
let stateWriteTimer: number | undefined;
const pendingStateWrites = new Map<string, EpisodeState>();

function flushStateWrites() {
  clearTimeout(stateWriteTimer);
  const items = [...pendingStateWrites.values()];
  pendingStateWrites.clear();
  void idb.putStates(items);
}

type EpisodeStatePatch = Partial<Pick<EpisodeState, 'position' | 'duration' | 'played' | 'skipped'>>;

/** Změní stav epizody; do databáze se zapíše s malým zpožděním (průběžná pozice se mění často). */
export function updateEpisodeState(episodeId: string, patch: EpisodeStatePatch) {
  const ep = state.episodes.get(episodeId);
  const prev = state.states.get(episodeId);
  const next: EpisodeState = {
    episodeId,
    podcastId: ep?.podcastId ?? prev?.podcastId ?? '',
    position: prev?.position ?? 0,
    duration: prev?.duration ?? ep?.duration ?? null,
    played: prev?.played ?? false,
    skipped: prev?.skipped ?? false,
    ...patch,
    updatedAt: Date.now(),
    dirty: true,
  };
  state.states.set(episodeId, next);
  pendingStateWrites.set(episodeId, next);
  emit();
  clearTimeout(stateWriteTimer);
  stateWriteTimer = window.setTimeout(flushStateWrites, STATE_WRITE_DELAY_MS);
  schedulePush();
}

/** Změní stav epizody a hned ho zapíše do databáze. */
export function updateEpisodeStateNow(episodeId: string, patch: EpisodeStatePatch) {
  updateEpisodeState(episodeId, patch);
  flushStateWrites();
}

export function markPlayed(episodeId: string, played: boolean) {
  updateEpisodeStateNow(episodeId, { played, skipped: false, position: 0 });
}

/** „Nechci přehrát“ – epizoda zmizí z nových a nepřehraných i z fronty. */
export function markSkipped(episodeId: string, skipped: boolean) {
  updateEpisodeStateNow(episodeId, { skipped, played: false });
  if (skipped && state.queue.includes(episodeId)) void removeFromQueue(episodeId);
}

/** Přehráno nebo přeskočeno – už nepatří mezi nepřehrané. */
export const isDone = (episodeId: string) => {
  const st = state.states.get(episodeId);
  return !!(st?.played || st?.skipped);
};

export async function setQueue(ids: string[]) {
  state.queue = [...new Set(ids)];
  emit();
  await writeKv('queue', state.queue);
}

export const playNext = (id: string) => setQueue([id, ...state.queue.filter((x) => x !== id)]);
export const playLast = (id: string) => setQueue([...state.queue.filter((x) => x !== id), id]);
export const removeFromQueue = (id: string) => setQueue(state.queue.filter((x) => x !== id));

// ---------------------------------------------------------------------------
// Kategorie (vlastní, podcast může být ve více kategoriích)

/** Pseudokategorie pro filtr: podcasty, které nejsou v žádné kategorii. */
export const NO_CATEGORY = '__none';

async function setCategories(list: Category[]) {
  state.categories = list;
  emit();
  await writeKv('categories', list);
}

export async function createCategory(name: string, podcastId?: string): Promise<string> {
  const id = randomId();
  await setCategories([...state.categories, { id, name: name.trim(), podcastIds: podcastId ? [podcastId] : [] }]);
  return id;
}

export const renameCategory = (id: string, name: string) =>
  setCategories(state.categories.map((c) => (c.id === id ? { ...c, name: name.trim() || c.name } : c)));

export const deleteCategory = (id: string) => setCategories(state.categories.filter((c) => c.id !== id));

export function moveCategory(id: string, delta: number) {
  const list = [...state.categories];
  const i = list.findIndex((c) => c.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  return setCategories(list);
}

const toggled = (ids: string[], id: string) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

export const togglePodcastCategory = (categoryId: string, podcastId: string) =>
  setCategories(state.categories.map((c) => (c.id === categoryId ? { ...c, podcastIds: toggled(c.podcastIds, podcastId) } : c)));

/** Filtr podle kategorie: null = vše, NO_CATEGORY = bez kategorie */
export function inCategory(podcastId: string, categoryId: string | null): boolean {
  if (!categoryId) return true;
  if (categoryId === NO_CATEGORY) return !state.categories.some((c) => c.podcastIds.includes(podcastId));
  return !!state.categories.find((c) => c.id === categoryId)?.podcastIds.includes(podcastId);
}

export const categoryNamesFor = (podcastId: string) => state.categories.filter((c) => c.podcastIds.includes(podcastId)).map((c) => c.name);

// ---------------------------------------------------------------------------
// Nastavení (globální a jednotlivých podcastů)

export const podSettings = (podcastId: string | null | undefined): PodcastSettings => (podcastId && state.podSettings[podcastId]) || {};

/** Výchozí hodnoty (žádná rychlost, 0 s, vypnuto) se neukládají. */
const withoutDefaults = (ps: PodcastSettings) =>
  Object.fromEntries(Object.entries(ps).filter(([, v]) => v !== undefined && v !== 0 && v !== false)) as PodcastSettings;

export async function updatePodSettings(podcastId: string, patch: Partial<PodcastSettings>) {
  const merged = withoutDefaults({ ...podSettings(podcastId), ...patch });
  const all = { ...state.podSettings };
  if (Object.keys(merged).length) all[podcastId] = merged;
  else delete all[podcastId];
  state.podSettings = all;
  emit();
  await writeKv('podcastSettings', all);
}

/** Rychlost pro daný podcast (vlastní, jinak globální). */
export const rateFor = (podcastId: string | null | undefined) => podSettings(podcastId).rate ?? state.settings.rate;

export async function updateSettings(patch: Partial<Settings>) {
  state.settings = { ...state.settings, ...patch };
  emit();
  await writeKv('settings', state.settings);
}

export function rememberNowPlaying(id: string) {
  void writeKv('nowPlaying', id);
}
