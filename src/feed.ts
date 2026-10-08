import type { Episode } from './types';
import { episodeIdFor, htmlToText } from './util';

export interface ParsedFeed {
  title: string;
  author: string | null;
  description: string;
  link: string | null;
  artworkUrl: string | null;
  episodes: Episode[];
  notes: Map<string, string>;
}

const childrenNamed = (el: Element, name: string) => Array.from(el.children).filter((c) => c.nodeName.toLowerCase() === name);
const childNamed = (el: Element, name: string) => childrenNamed(el, name)[0] ?? null;
const childText = (el: Element, ...names: string[]) => {
  for (const n of names) {
    const v = childNamed(el, n)?.textContent?.trim();
    if (v) return v;
  }
  return '';
};

/** "01:02:03" | "62:03" | "3723" → sekundy */
function parseDuration(v: string): number | null {
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v));
  const parts = v.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

const parseInteger = (v: string) => (/^\d+$/.test(v) ? Number(v) : null);

const UNTITLED = 'Bez názvu';
const SUMMARY_MAX_LENGTH = 300;

export function parseFeed(xml: string, podcastId: string): ParsedFeed {
  const channel = parseChannel(xml);
  const episodes: Episode[] = [];
  const notes = new Map<string, string>();
  const seen = new Set<string>();

  for (const item of childrenNamed(channel, 'item')) {
    const parsed = parseItem(item, podcastId);
    // Bez audia to není epizoda; u duplicitního GUID platí první výskyt
    if (!parsed || seen.has(parsed.episode.id)) continue;
    seen.add(parsed.episode.id);
    episodes.push(parsed.episode);
    if (parsed.notes) notes.set(parsed.episode.id, parsed.notes);
  }
  episodes.sort((a, b) => b.pubDate - a.pubDate);

  return {
    title: childText(channel, 'title') || UNTITLED,
    author: childText(channel, 'itunes:author', 'author') || null,
    description: htmlToText(childText(channel, 'description', 'itunes:summary')),
    link: childText(channel, 'link') || null,
    artworkUrl: channelArtwork(channel),
    episodes,
    notes,
  };
}

function parseChannel(xml: string): Element {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Feed není platné RSS/XML');
  const channel = doc.getElementsByTagName('channel')[0];
  if (!channel) throw new Error('Feed neobsahuje <channel> – nejde o podcastové RSS');
  return channel;
}

const channelArtwork = (channel: Element) =>
  childNamed(channel, 'itunes:image')?.getAttribute('href') || childNamed(channel, 'image')?.getElementsByTagName('url')[0]?.textContent?.trim() || null;

/** Jedna položka feedu → epizoda a její poznámky (HTML). Položka bez audia vrátí null. */
function parseItem(item: Element, podcastId: string): { episode: Episode; notes: string } | null {
  const enclosure = childNamed(item, 'enclosure');
  const audioUrl = enclosure?.getAttribute('url')?.trim();
  if (!audioUrl) return null;
  const guid = childText(item, 'guid') || audioUrl;
  const notes = childText(item, 'content:encoded') || childText(item, 'description') || childText(item, 'itunes:summary');
  const pubDate = Date.parse(childText(item, 'pubdate'));
  return {
    notes,
    episode: {
      id: episodeIdFor(podcastId, guid),
      podcastId,
      guid,
      title: childText(item, 'title', 'itunes:title') || UNTITLED,
      pubDate: isNaN(pubDate) ? 0 : pubDate,
      duration: parseDuration(childText(item, 'itunes:duration')),
      audioUrl,
      audioType: enclosure?.getAttribute('type') ?? null,
      artworkUrl: childNamed(item, 'itunes:image')?.getAttribute('href') ?? null,
      summary: htmlToText(childText(item, 'itunes:subtitle') || notes).slice(0, SUMMARY_MAX_LENGTH),
      season: parseInteger(childText(item, 'itunes:season')),
      episode: parseInteger(childText(item, 'itunes:episode')),
      link: childText(item, 'link') || null,
      chaptersUrl: childNamed(item, 'podcast:chapters')?.getAttribute('url') ?? null,
      transcripts: childrenNamed(item, 'podcast:transcript')
        .map((t) => ({ url: t.getAttribute('url') ?? '', type: (t.getAttribute('type') ?? '').toLowerCase() }))
        .filter((t) => t.url),
    },
  };
}
