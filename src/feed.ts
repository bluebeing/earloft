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

const kids = (el: Element, name: string) => Array.from(el.children).filter((c) => c.nodeName.toLowerCase() === name);
const kid = (el: Element, name: string) => kids(el, name)[0] ?? null;
const text = (el: Element, ...names: string[]) => {
  for (const n of names) {
    const v = kid(el, n)?.textContent?.trim();
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

const int = (v: string) => (/^\d+$/.test(v) ? Number(v) : null);

export function parseFeed(xml: string, podcastId: string): ParsedFeed {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Feed není platné RSS/XML');
  const channel = doc.getElementsByTagName('channel')[0];
  if (!channel) throw new Error('Feed neobsahuje <channel> – nejde o podcastové RSS');

  const channelImage =
    kid(channel, 'itunes:image')?.getAttribute('href') || kid(channel, 'image')?.getElementsByTagName('url')[0]?.textContent?.trim() || null;

  const episodes: Episode[] = [];
  const notes = new Map<string, string>();
  const seen = new Set<string>();

  for (const item of kids(channel, 'item')) {
    const enclosure = kid(item, 'enclosure');
    const audioUrl = enclosure?.getAttribute('url')?.trim();
    if (!audioUrl) continue;
    const guid = text(item, 'guid') || audioUrl;
    const id = episodeIdFor(podcastId, guid);
    if (seen.has(id)) continue;
    seen.add(id);

    const html = text(item, 'content:encoded') || text(item, 'description') || text(item, 'itunes:summary');
    const pub = Date.parse(text(item, 'pubdate'));
    episodes.push({
      id,
      podcastId,
      guid,
      title: text(item, 'title', 'itunes:title') || 'Bez názvu',
      pubDate: isNaN(pub) ? 0 : pub,
      duration: parseDuration(text(item, 'itunes:duration')),
      audioUrl,
      audioType: enclosure?.getAttribute('type') ?? null,
      artworkUrl: kid(item, 'itunes:image')?.getAttribute('href') ?? null,
      summary: htmlToText(text(item, 'itunes:subtitle') || html).slice(0, 300),
      season: int(text(item, 'itunes:season')),
      episode: int(text(item, 'itunes:episode')),
      link: text(item, 'link') || null,
    });
    if (html) notes.set(id, html);
  }

  episodes.sort((a, b) => b.pubDate - a.pubDate);

  return {
    title: text(channel, 'title') || 'Bez názvu',
    author: text(channel, 'itunes:author', 'author') || null,
    description: htmlToText(text(channel, 'description', 'itunes:summary')),
    link: text(channel, 'link') || null,
    artworkUrl: channelImage,
    episodes,
    notes,
  };
}
