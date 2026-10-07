import { useEffect, useReducer } from 'preact/hooks';
import type { Episode, EpisodeState, Podcast, Settings } from './types';

export interface AppState {
  ready: boolean;
  authed: boolean;
  podcasts: Map<string, Podcast>;
  episodes: Map<string, Episode>;
  /** epizody podle podcastu, seřazené od nejnovější */
  byPodcast: Map<string, Episode[]>;
  states: Map<string, EpisodeState>;
  queue: string[];
  settings: Settings;
  refreshing: boolean;
  syncing: boolean;
  lastSyncAt: number;
  toast: string | null;
  // přehrávač
  currentId: string | null;
  playing: boolean;
  buffering: boolean;
  position: number;
  duration: number;
  sleepAt: number | null;
  sleepAtEnd: boolean;
  nowPlayingOpen: boolean;
}

export const DEFAULT_SETTINGS: Settings = { rate: 1, skipBack: 15, skipForward: 30 };

export const state: AppState = {
  ready: false,
  authed: false,
  podcasts: new Map(),
  episodes: new Map(),
  byPodcast: new Map(),
  states: new Map(),
  queue: [],
  settings: { ...DEFAULT_SETTINGS },
  refreshing: false,
  syncing: false,
  lastSyncAt: 0,
  toast: null,
  currentId: null,
  playing: false,
  buffering: false,
  position: 0,
  duration: 0,
  sleepAt: null,
  sleepAtEnd: false,
  nowPlayingOpen: false,
};

const listeners = new Set<() => void>();
let scheduled = false;

/** Upozorní komponenty na změnu (sloučeno do jednoho snímku). */
export function emit() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    listeners.forEach((l) => l());
  });
}

export function set(patch: Partial<AppState>) {
  Object.assign(state, patch);
  emit();
}

/** Komponenta se překreslí při každé změně stavu. */
export function useStore(): AppState {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    listeners.add(force as () => void);
    return () => void listeners.delete(force as () => void);
  }, []);
  return state;
}

export function indexEpisodes(podcastId: string) {
  const list: Episode[] = [];
  for (const e of state.episodes.values()) if (e.podcastId === podcastId) list.push(e);
  list.sort((a, b) => b.pubDate - a.pubDate);
  state.byPodcast.set(podcastId, list);
}

export function rebuildIndex() {
  const map = new Map<string, Episode[]>();
  for (const e of state.episodes.values()) {
    let l = map.get(e.podcastId);
    if (!l) map.set(e.podcastId, (l = []));
    l.push(e);
  }
  for (const l of map.values()) l.sort((a, b) => b.pubDate - a.pubDate);
  state.byPodcast = map;
}

let toastTimer: number | undefined;
export function toast(msg: string) {
  clearTimeout(toastTimer);
  set({ toast: msg });
  toastTimer = window.setTimeout(() => set({ toast: null }), 3500);
}
