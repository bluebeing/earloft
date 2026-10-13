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

/** Kdy uživatel s epizodou naposledy něco dělal (poslech, přehráno…), nebo undefined. */
export type LastTouched = (episodeId: string) => number | undefined;

export function parseFeed(xml: string, podcastId: string, lastTouched?: LastTouched): ParsedFeed {
  const channel = parseChannel(xml);
  const items: ParsedItem[] = [];
  const seen = new Set<string>();

  for (const item of childrenNamed(channel, 'item')) {
    const parsed = parseItem(item, podcastId);
    // Bez audia to není epizoda; u duplicitního GUID platí první výskyt
    if (!parsed || seen.has(parsed.episode.id)) continue;
    seen.add(parsed.episode.id);
    items.push(parsed);
  }

  const episodes: Episode[] = [];
  const notes = new Map<string, string>();
  for (const it of mergeFormatTwins(items, lastTouched)) {
    episodes.push(it.episode);
    if (it.notes) notes.set(it.episode.id, it.notes);
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

interface ParsedItem {
  episode: Episode;
  notes: string;
  /** velikost souboru v bajtech (enclosure length), pokud ji feed uvádí */
  size: number;
}

// ---------------------------------------------------------------------------
// Stejný díl ve více formátech
//
// Některé feedy (např. Patreon) dávají každý díl dvakrát – jako MP3 a jako M4A,
// s různým GUID, stejným názvem a délkou, vydané pár sekund po sobě. Pro posluchače
// je to jedna epizoda, takže z dvojice necháme jednu.

const TWIN_MAX_PUBLISH_GAP_MS = 6 * 3600 * 1000;
const TWIN_MAX_DURATION_DIFF_S = 10;

const twinKey = (title: string) => title.toLocaleLowerCase('cs').replace(/\s+/g, ' ').trim();

function areFormatTwins(a: Episode, b: Episode): boolean {
  if (Math.abs(a.pubDate - b.pubDate) > TWIN_MAX_PUBLISH_GAP_MS) return false;
  if (a.duration == null || b.duration == null) return true;
  return Math.abs(a.duration - b.duration) <= TWIN_MAX_DURATION_DIFF_S;
}

/**
 * Kterou verzi nechat: tu, se kterou uživatel naposledy pracoval (aby nezmizel poslech
 * ani „přehráno“); jinak menší soubor (šetří data).
 */
function isPreferredTwin(candidate: ParsedItem, current: ParsedItem, lastTouched?: LastTouched): boolean {
  const touchedCandidate = lastTouched?.(candidate.episode.id) ?? 0;
  const touchedCurrent = lastTouched?.(current.episode.id) ?? 0;
  if (touchedCandidate !== touchedCurrent) return touchedCandidate > touchedCurrent;
  return (candidate.size || Infinity) < (current.size || Infinity);
}

function mergeFormatTwins(items: ParsedItem[], lastTouched?: LastTouched): ParsedItem[] {
  const byTitle = new Map<string, ParsedItem[]>();
  for (const it of items) {
    const key = twinKey(it.episode.title);
    const group = byTitle.get(key) ?? [];
    const twinIndex = group.findIndex((g) => areFormatTwins(g.episode, it.episode));
    if (twinIndex < 0) group.push(it);
    else if (isPreferredTwin(it, group[twinIndex], lastTouched)) group[twinIndex] = it;
    byTitle.set(key, group);
  }
  return [...byTitle.values()].flat();
}

/** Jedna položka feedu → epizoda a její poznámky (HTML). Položka bez audia vrátí null. */
function parseItem(item: Element, podcastId: string): ParsedItem | null {
  const enclosure = childNamed(item, 'enclosure');
  const audioUrl = enclosure?.getAttribute('url')?.trim();
  if (!audioUrl) return null;
  const guid = childText(item, 'guid') || audioUrl;
  const notes = childText(item, 'content:encoded') || childText(item, 'description') || childText(item, 'itunes:summary');
  const pubDate = Date.parse(childText(item, 'pubdate'));
  return {
    notes,
    size: Number(enclosure?.getAttribute('length')) || 0,
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
