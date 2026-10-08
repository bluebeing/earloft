import {
  episodeArtwork,
  getPodcast,
  getState,
  markPlayed,
  markSkipped,
  podSettings,
  rateFor,
  rememberNowPlaying,
  removeFromQueue,
  updateEpisodeState,
  updateEpisodeStateNow,
  updatePodSettings,
  updateSettings,
} from './library';
import { cachedChapters, chapterIndexAt, loadChapters } from './media';
import { flushStats, recordListening } from './stats';
import { set, state, tick, toast } from './store';
import { push } from './sync';

/** Jediný audio element pro celou appku (iOS si pak drží přehrávání na pozadí). */
const audio = new Audio();
audio.preload = 'metadata';

let loadedId: string | null = null;
let pendingSeek: number | null = null;
let lastSaved = 0;
let lastEmit = 0;
let outroDone = false;
/** Kapitola zobrazená na zamčené obrazovce (-2 = zatím žádná, -1 = před první kapitolou) */
let chapterIdx = -2;
/** Poslední pozice pro počítání odposlechnutého času (null = po skoku) */
let lastTime: number | null = null;

/** Od jaké části epizody se počítá jako přehraná */
const PLAYED_THRESHOLD = 0.95;
const SAVE_INTERVAL_MS = 10000;
const TICK_INTERVAL_MS = 500;
/** Delší posun mezi dvěma `timeupdate` je skok, ne poslech */
const MAX_LISTEN_STEP_S = 3;
/** Rozdíl pozice, od kterého se převezme pozice z jiného zařízení */
const SYNC_POSITION_TOLERANCE_S = 3;
/** Kratší rozposlouchanost se při načtení ignoruje (začne se od začátku) */
const MIN_RESUME_S = 5;
const RATES = [0.8, 1, 1.1, 1.2, 1.3, 1.5, 1.75, 2];

export function currentEpisode() {
  return state.currentId ? (state.episodes.get(state.currentId) ?? null) : null;
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
  pendingSeek = resumeAt > MIN_RESUME_S || intro ? resumeAt : null;
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
  if (state.currentId && state.currentId !== id) saveProgressNow();
  if (loadedId !== id) {
    if (!load(id)) return;
  } else if (audio.paused) {
    // Pozice mohla přijít ze synchronizace z jiného zařízení
    const st = getState(id);
    if (st && !st.dirty && !st.played && Math.abs(st.position - audio.currentTime) > SYNC_POSITION_TOLERANCE_S) audio.currentTime = st.position;
  }
  if (getState(id)?.skipped) markSkipped(id, false);
  // Pokud hraje epizoda z fronty, z fronty ji vyřadíme
  if (state.queue.includes(id)) void removeFromQueue(id);
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
  saveProgressThrottled();
}

/** Přehraje epizodu od daného času (načte ji, pokud zrovna nehraje). */
export async function playAt(episodeId: string, time: number) {
  if (state.currentId === episodeId && loadedId === episodeId) {
    seekTo(time);
    if (!state.playing) void playEpisode(episodeId);
  } else {
    await playEpisode(episodeId);
    seekTo(time);
  }
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

/** Přepne na další rychlost v řadě (za nejvyšší následuje nejnižší). */
export function cycleRate() {
  const i = RATES.indexOf(currentRate());
  setRate(RATES[(i + 1) % RATES.length]);
}

/** „Předchozí“ v prvních sekundách kapitoly skočí o kapitolu zpět, jinak na její začátek. */
const RESTART_CHAPTER_WINDOW_S = 3;

export function seekChapter(delta: 1 | -1) {
  const ep = currentEpisode();
  const chapters = ep ? cachedChapters(ep.id) : null;
  if (!chapters?.length) return;
  const pos = audio.currentTime || state.position;
  let i = chapterIndexAt(chapters, pos);
  if (delta < 0 && i >= 0 && pos - chapters[i].start < RESTART_CHAPTER_WINDOW_S) i--;
  const target = delta > 0 ? chapters[i + 1] : chapters[Math.max(0, i)];
  if (target) seekTo(target.start);
}

export function setSleepTimer(minutes: number | 'end' | null) {
  if (minutes === 'end') set({ sleepAt: null, sleepAtEnd: true });
  else if (minutes === null) set({ sleepAt: null, sleepAtEnd: false });
  else set({ sleepAt: Date.now() + minutes * 60000, sleepAtEnd: false });
}

/** Průběžné uložení pozice – nejvýš jednou za SAVE_INTERVAL_MS. */
function saveProgressThrottled() {
  if (Date.now() - lastSaved < SAVE_INTERVAL_MS) return;
  const progress = currentProgress();
  if (progress) updateEpisodeState(progress.id, progress.patch);
}

/** Okamžité uložení pozice (pauza, přepnutí epizody, schování appky). */
function saveProgressNow() {
  const progress = currentProgress();
  if (progress) updateEpisodeStateNow(progress.id, progress.patch);
}

function currentProgress() {
  const id = state.currentId;
  if (!id || loadedId !== id || outroDone) return null;
  const pos = audio.currentTime;
  const dur = audio.duration;
  if (!isFinite(pos)) return null;
  lastSaved = Date.now();
  const played = isFinite(dur) && dur > 0 && pos / dur >= PLAYED_THRESHOLD;
  return { id, patch: { position: played ? 0 : pos, duration: isFinite(dur) ? dur : null, played } };
}

function playNextInQueue() {
  const nextId = state.queue.find((id) => state.episodes.has(id));
  if (nextId) void playEpisode(nextId);
  else set({ playing: false });
}

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
  playNextInQueue();
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
  recordListeningStep();
  emitTickThrottled();
  saveProgressThrottled();
  showCurrentChapter();
  if (reachedOutro()) {
    finishEpisode();
    return;
  }
  stopIfSleepTimerElapsed();
});

/** Statistiky: počítá se jen plynulé přehrávání, ne skoky. */
function recordListeningStep() {
  const ep = currentEpisode();
  if (ep && !audio.paused && lastTime !== null) {
    const delta = audio.currentTime - lastTime;
    if (delta > 0 && delta < MAX_LISTEN_STEP_S) recordListening(ep.podcastId, delta, delta / (audio.playbackRate || 1));
  }
  lastTime = audio.currentTime;
}

function emitTickThrottled() {
  const now = Date.now();
  if (now - lastEmit <= TICK_INTERVAL_MS) return;
  lastEmit = now;
  tick(audio.currentTime, isFinite(audio.duration) ? audio.duration : state.duration);
  updatePositionState();
}

/** Název aktuální kapitoly na zamčené obrazovce. */
function showCurrentChapter() {
  const ep = currentEpisode();
  const chapters = ep ? cachedChapters(ep.id) : null;
  if (!chapters?.length) return;
  const idx = chapterIndexAt(chapters, audio.currentTime);
  if (idx === chapterIdx) return;
  chapterIdx = idx;
  updateMediaSession(idx >= 0 ? chapters[idx].title : null);
}

/** Přeskočení závěru: posledních N sekund (podle nastavení podcastu) se nehraje. */
function reachedOutro(): boolean {
  const ep = currentEpisode();
  const outro = ep ? (podSettings(ep.podcastId).skipOutro ?? 0) : 0;
  const dur = audio.duration;
  // U krátké epizody by „závěr“ mohl být většina obsahu – pak se nepřeskakuje
  return !!outro && !outroDone && !audio.paused && isFinite(dur) && dur > outro * 2 && dur - audio.currentTime <= outro;
}

function stopIfSleepTimerElapsed() {
  if (state.sleepAt && Date.now() >= state.sleepAt) {
    audio.pause();
    set({ sleepAt: null });
  }
}

audio.addEventListener('seeking', () => (lastTime = null));
audio.addEventListener('playing', () => set({ playing: true, buffering: false }));
audio.addEventListener('play', () => set({ playing: true }));
audio.addEventListener('waiting', () => set({ buffering: true }));
audio.addEventListener('pause', () => {
  set({ playing: false, buffering: false });
  lastTime = null;
  flushStats();
  saveProgressNow();
  void push().catch(() => {});
});
audio.addEventListener('ratechange', () => {
  // iOS po změně src vrací rychlost na 1 → vrátit nastavenou
  const rate = currentRate();
  if (audio.playbackRate !== rate && !audio.paused) audio.playbackRate = rate;
});
audio.addEventListener('ended', finishEpisode);
audio.addEventListener('error', () => {
  set({ playing: false, buffering: false });
  if (audio.src) toast('Epizodu se nepodařilo přehrát');
});

// Při schování appky uložit pozici a odeslat na server
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushStats();
    saveProgressNow();
    void push(true).catch(() => {});
  }
});
window.addEventListener('pagehide', saveProgressNow);

// ---------------------------------------------------------------------------
// Media Session – ovládání ze zamčené obrazovky, AirPods, CarPlay

function updateMediaSession(chapter: string | null = null) {
  if (!('mediaSession' in navigator)) return;
  const ep = currentEpisode();
  if (!ep) return;
  const pod = getPodcast(ep.podcastId);
  const art = episodeArtwork(ep);
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
  const setHandler = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
    try {
      navigator.mediaSession.setActionHandler(action, fn);
    } catch {
      /* nepodporovaná akce */
    }
  };
  setHandler('play', () => state.currentId && void playEpisode(state.currentId));
  setHandler('pause', () => audio.pause());
  setHandler('seekbackward', (d) => skip(-(d.seekOffset || state.settings.skipBack)));
  setHandler('seekforward', (d) => skip(d.seekOffset || state.settings.skipForward));
  setHandler('seekto', (d) => d.seekTime != null && seekTo(d.seekTime));
  // Na iOS se místo ±skip jinak zobrazí předchozí/další – mapujeme je na posun
  setHandler('previoustrack', skipBack);
  setHandler('nexttrack', skipForward);
}

/** Po startu appky zobrazit v mini-přehrávači naposledy hranou epizodu (bez přehrávání). */
export function restoreLastEpisode() {
  const ep = currentEpisode();
  if (!ep) return;
  const st = getState(ep.id);
  set({ position: st && !st.played ? st.position : 0, duration: ep.duration ?? st?.duration ?? 0 });
  updateMediaSession();
}
