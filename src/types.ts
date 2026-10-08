export interface Podcast {
  id: string;
  feedUrl: string;
  title: string;
  author: string | null;
  artworkUrl: string | null;
  source: 'rss' | 'apple';
  appleId: string | null;
  isPrivate: boolean;
  addedAt: number;
  updatedAt: number;
  deleted?: boolean;
  dirty?: boolean;
  // Lokální metadata z feedu (nesynchronizují se)
  description?: string;
  link?: string;
  etag?: string | null;
  contentHash?: string;
  lastModified?: string | null;
  lastFetchedAt?: number;
  fetchError?: string | null;
}

export interface Episode {
  id: string;
  podcastId: string;
  guid: string;
  title: string;
  pubDate: number;
  duration: number | null;
  audioUrl: string;
  audioType: string | null;
  artworkUrl: string | null;
  summary: string;
  season: number | null;
  episode: number | null;
  link: string | null;
  /** Podcasting 2.0: <podcast:chapters url> (JSON) */
  chaptersUrl?: string | null;
  /** Podcasting 2.0: <podcast:transcript> */
  transcripts?: { url: string; type: string }[];
}

export interface EpisodeState {
  episodeId: string;
  podcastId: string;
  position: number;
  duration: number | null;
  played: boolean;
  /** „Nechci přehrát“ */
  skipped?: boolean;
  updatedAt: number;
  dirty?: boolean;
}

export interface KvRecord<T = unknown> {
  key: string;
  value: T;
  updatedAt: number;
  dirty?: boolean;
}

export interface Category {
  id: string;
  name: string;
  podcastIds: string[];
}

/** Nastavení konkrétního podcastu (přebíjí globální) */
export interface PodcastSettings {
  rate?: number;
  /** přeskočit prvních N sekund (znělka, reklama) */
  skipIntro?: number;
  /** ukončit N sekund před koncem */
  skipOutro?: number;
  /** nové díly automaticky na konec fronty */
  autoQueue?: boolean;
}

export interface Settings {
  rate: number;
  skipBack: number;
  skipForward: number;
}

export type { ApplePodcast } from '../shared/apple';
