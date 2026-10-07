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

export interface Settings {
  rate: number;
  skipBack: number;
  skipForward: number;
}

export type { ApplePodcast } from '../shared/apple';
