import { getPodcast, getState, markPlayed, markSkipped, podSettings, rateFor, updatePodSettings, push, rememberNowPlaying, setQueue, updateEpisodeState, updateSettings } from './library';
import { cachedChapters, chapterIndexAt, loadChapters } from './media';
import { flushStats, recordListening } from './stats';
import { emit, set, state, tick } from './store';

/** Jediný audio element pro celou appku (iOS si pak drží přehrávání na pozadí). */
const audio = new Audio();
audio.preload = 'metadata';

let loadedId: string | null = null;
let pendingSeek: number | null = null;
let lastSaved = 0;
let lastEmit = 0;
let outroDone = false;
let chapterIdx = -2;
/** Poslední pozice pro počítání odposlechnutého času (null = po skoku) */
let lastTime: number | null = null;

const PLAYED_THRESHOLD = 0.95;

function currentEpisode() {
  return state.currentId ? state.episodes.get(state.currentId) ?? null : null;
}

function load(id: string) {
  const ep = state.episodes.get(id);
  if (!ep) return false;
  const st = getState(id);
  const intro = podSettings(ep.podcastId).skipIntro ?? 0;
  let resumeAt = st && !st.played ? st.position : 0;
  // Přeskočit úvod (znělku), pokud epizoda ještě nebyla rozposlouchaná za něj
  if (intro && resumeAt < intro) resumeAt = intro;
  loadedId = id;
  outroDone = false;
  chapterIdx = -2;
  pendingSeek = resumeAt > 5 || intro ? resumeAt : null;
  audio.src = ep.audioUrl;
  const rate = rateFor(ep.podcastId);
  audio.defaultPlaybackRate = rate;
  audio.playbackRate = rate;
  void loadChapters(ep);
  set({ currentId: id, position: resumeAt, duration: ep.duration ?? st?.duration ?? 0, buffering: true });
  updateMediaSession();
  return true;
}

export async function playEpisode(id: string) {
  if (state.currentId && state.currentId !== id) saveProgress(true);
  if (loadedId !== id) {
    if (!load(id)) return;
  } else if (audio.paused) {
    // Pozice mohla přijít ze synchronizace z jiného zařízení
    const st = getState(id);
    if (st && !st.dirty && !st.played && Math.abs(st.position - audio.currentTime) > 3) audio.currentTime = st.position;
  }
  if (getState(id)?.skipped) markSkipped(id, false);
  // Pokud hraje epizoda z fronty, z fronty ji vyřadíme
  if (state.queue.includes(id)) void setQueue(state.queue.filter((x) => x !== id));
  rememberNowPlaying(id);
  try {
    await audio.play();
  } catch (e) {
    console.warn('play() selhalo', e);
    set({ playing: false, buffering: false });
  }
}

export function togglePlay() {
  if (!state.currentId) return;
  if (audio.paused) void playEpisode(state.currentId);
  else audio.pause();
}

export function pause() {
  audio.pause();
}

export function seekTo(sec: number) {
  const dur = audio.duration || state.duration;
  const t = Math.max(0, Math.min(sec, dur ? dur - 1 : sec));
  if (loadedId !== state.currentId && state.currentId) {
    // Epizoda zatím není načtená (např. po restartu appky) – jen uložit pozici
    updateEpisodeState(state.currentId, { position: t, played: false });
    set({ position: t });
    return;
  }
  if (audio.readyState >= 1) audio.currentTime = t;
  else pendingSeek = t;
  set({ position: t });
  saveProgress();
}

export const skip = (delta: number) => seekTo((audio.currentTime || state.position) + delta);
export const skipBack = () => skip(-state.settings.skipBack);
export const skipForward = () => skip(state.settings.skipForward);

/** Změna rychlosti: má-li hrající podcast vlastní rychlost, mění se ta, jinak globální. */
export function setRate(rate: number) {
  audio.playbackRate = rate;
  audio.defaultPlaybackRate = rate;
  const podcastId = currentEpisode()?.podcastId;
  if (podcastId && podSettings(podcastId).rate !== undefined) void updatePodSettings(podcastId, { rate });
  else void updateSettings({ rate });
}

/** Aktuální rychlost (podle hrajícího podcastu). */
export const currentRate = () => rateFor(currentEpisode()?.podcastId);

export function seekChapter(delta: 1 | -1) {
  const ep = currentEpisode();
  const chapters = ep ? cachedChapters(ep.id) : null;
  if (!chapters?.length) return;
  const pos = audio.currentTime || state.position;
  let i = chapterIndexAt(chapters, pos);
  // „Předchozí“ v prvních 3 s kapitoly skočí o kapitolu zpět, jinak na její začátek
  if (delta < 0 && i >= 0 && pos - chapters[i].start < 3) i--;
  const target = delta > 0 ? chapters[i + 1] : chapters[Math.max(0, i)];
  if (target) seekTo(target.start);
}

export function setSleepTimer(minutes: number | 'end' | null) {
  if (minutes === 'end') set({ sleepAt: null, sleepAtEnd: true });
  else if (minutes === null) set({ sleepAt: null, sleepAtEnd: false });
  else set({ sleepAt: Date.now() + minutes * 60000, sleepAtEnd: false });
}

function saveProgress(force = false) {
  const id = state.currentId;
  if (!id || loadedId !== id || outroDone) return;
  const pos = audio.currentTime;
  const dur = audio.duration;
  if (!isFinite(pos)) return;
  const now = Date.now();
  if (!force && now - lastSaved < 10000) return;
  lastSaved = now;
  const played = isFinite(dur) && dur > 0 && pos / dur >= PLAYED_THRESHOLD;
  updateEpisodeState(id, { position: played ? 0 : pos, duration: isFinite(dur) ? dur : null, played }, force);
}

function next() {
  const nextId = state.queue.find((id) => state.episodes.has(id));
  if (nextId) void playEpisode(nextId);
  else set({ playing: false });
}

// ---------------------------------------------------------------------------
// Události audio elementu

audio.addEventListener('loadedmetadata', () => {
  if (pendingSeek !== null) {
    audio.currentTime = pendingSeek;
    pendingSeek = null;
  }
  audio.playbackRate = currentRate();
  if (isFinite(audio.duration)) set({ duration: audio.duration });
});

audio.addEventListener('timeupdate', () => {
  const now = Date.now();
  // Statistiky: počítá se jen plynulé přehrávání, ne skoky
  if (!audio.paused && lastTime !== null) {
    const delta = audio.currentTime - lastTime;
    const ep = currentEpisode();
    if (ep && delta > 0 && delta < 3) recordListening(ep.podcastId, delta, delta / (audio.playbackRate || 1));
  }
  lastTime = audio.currentTime;
  if (now - lastEmit > 500) {
    lastEmit = now;
    tick(audio.currentTime, isFinite(audio.duration) ? audio.duration : state.duration);
    updatePositionState();
  }
  saveProgress();
  const ep = currentEpisode();
  // Kapitola na lock screenu
  const chapters = ep ? cachedChapters(ep.id) : null;
  if (chapters?.length) {
    const idx = chapterIndexAt(chapters, audio.currentTime);
    if (idx !== chapterIdx) {
      chapterIdx = idx;
      updateMediaSession(idx >= 0 ? chapters[idx].title : null);
    }
  }
  // Přeskočit závěr: N sekund před koncem epizodu ukončit
  const outro = ep ? (podSettings(ep.podcastId).skipOutro ?? 0) : 0;
  if (outro && !outroDone && !audio.paused && isFinite(audio.duration) && audio.duration > outro * 2 && audio.duration - audio.currentTime <= outro) {
    outroDone = true;
    finishEpisode();
    return;
  }
  if (state.sleepAt && now >= state.sleepAt) {
    audio.pause();
    set({ sleepAt: null });
  }
});

audio.addEventListener('seeking', () => (lastTime = null));
audio.addEventListener('playing', () => set({ playing: true, buffering: false }));
audio.addEventListener('play', () => set({ playing: true }));
audio.addEventListener('waiting', () => set({ buffering: true }));
audio.addEventListener('pause', () => {
  set({ playing: false, buffering: false });
  lastTime = null;
  flushStats();
  saveProgress(true);
  void push().catch(() => {});
});
audio.addEventListener('ratechange', () => {
  // iOS po změně src vrací rychlost na 1 → vrátit nastavenou
  const rate = currentRate();
  if (audio.playbackRate !== rate && !audio.paused) audio.playbackRate = rate;
});
audio.addEventListener('ended', () => finishEpisode());

/** Konec epizody (skutečný, nebo po přeskočení závěru): označit přehrané a pustit další z fronty. */
function finishEpisode() {
  const id = state.currentId;
  outroDone = true; // pauza níže už nesmí přepsat stav „přehráno“ pozicí
  if (!audio.ended) audio.pause();
  if (id) markPlayed(id, true);
  if (state.sleepAtEnd) {
    set({ sleepAtEnd: false, playing: false });
    return;
  }
  next();
}
audio.addEventListener('error', () => {
  set({ playing: false, buffering: false });
  if (audio.src) window.dispatchEvent(new CustomEvent('podcasty:toast', { detail: 'Epizodu se nepodařilo přehrát' }));
});

// Při schování appky uložit pozici a odeslat na server
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushStats();
    saveProgress(true);
    void push(true).catch(() => {});
  }
});
window.addEventListener('pagehide', () => saveProgress(true));

// ---------------------------------------------------------------------------
// Media Session – ovládání ze zamčené obrazovky, AirPods, CarPlay

function updateMediaSession(chapter: string | null = null) {
  if (!('mediaSession' in navigator)) return;
  const ep = currentEpisode();
  if (!ep) return;
  const pod = getPodcast(ep.podcastId);
  const art = ep.artworkUrl || pod?.artworkUrl;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: ep.title,
    artist: chapter ? `${chapter} · ${pod?.title ?? ''}` : (pod?.title ?? ''),
    album: pod?.author ?? '',
    artwork: art ? [{ src: art, sizes: '600x600' }] : [],
  });
}

function updatePositionState() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const d = audio.duration;
  if (!isFinite(d) || d <= 0) return;
  try {
    navigator.mediaSession.setPositionState({ duration: d, position: Math.min(audio.currentTime, d), playbackRate: audio.playbackRate || 1 });
  } catch {
    /* některé prohlížeče hází při nekonzistentních hodnotách */
  }
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const h = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
    try {
      ms.setActionHandler(action, fn);
    } catch {
      /* nepodporovaná akce */
    }
  };
  h('play', () => state.currentId && void playEpisode(state.currentId));
  h('pause', () => audio.pause());
  h('seekbackward', (d) => skip(-(d.seekOffset || state.settings.skipBack)));
  h('seekforward', (d) => skip(d.seekOffset || state.settings.skipForward));
  h('seekto', (d) => d.seekTime != null && seekTo(d.seekTime));
  // Na iOS se místo ±skip jinak zobrazí předchozí/další – mapujeme je na posun
  h('previoustrack', () => skipBack());
  h('nexttrack', () => skipForward());
}

/** Po startu appky zobrazit v mini-přehrávači naposledy hranou epizodu (bez přehrávání). */
export function restoreLastEpisode() {
  const id = state.currentId;
  if (!id) return;
  const ep = state.episodes.get(id);
  if (!ep) return;
  const st = getState(id);
  set({ position: st && !st.played ? st.position : 0, duration: ep.duration ?? st?.duration ?? 0 });
  updateMediaSession();
  emit();
}

export const isLoaded = (id: string) => loadedId === id;
