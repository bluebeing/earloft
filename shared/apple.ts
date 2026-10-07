/** Převod odpovědí Apple (iTunes Search API a iTunes RSS) – sdílí PWA i Worker. */

export interface ApplePodcast {
  appleId: string;
  title: string;
  author: string;
  artworkUrl: string;
  feedUrl: string | null;
  genre: string | null;
}

const bigArtwork = (url: string | undefined) => (url ? url.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/, '/600x600bb.$2') : '');

export const cleanCountry = (c: string) => (/^[a-z]{2}$/i.test(c) ? c.toLowerCase() : 'cz');

export const appleSearchUrl = (q: string, country = 'cz') =>
  `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=40&country=${cleanCountry(country)}&term=${encodeURIComponent(q.trim())}`;
export const appleLookupUrl = (id: string) => `https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=podcast`;
// Starší iTunes RSS je spolehlivější než rss.marketingtools.apple.com
export const appleTopUrl = (country = 'cz') => `https://itunes.apple.com/${cleanCountry(country)}/rss/toppodcasts/limit=50/json`;

export function fromItunes(r: any): ApplePodcast {
  return {
    appleId: String(r.collectionId ?? r.trackId),
    title: r.collectionName ?? r.trackName ?? '',
    author: r.artistName ?? '',
    artworkUrl: r.artworkUrl600 ?? bigArtwork(r.artworkUrl100),
    // Podcasty dostupné jen přes placené Apple Subscriptions feedUrl nemají
    feedUrl: r.feedUrl ?? null,
    genre: r.primaryGenreName ?? null,
  };
}

export const parseSearch = (data: any): ApplePodcast[] => (data?.results ?? []).map(fromItunes);
export const parseLookup = (data: any): ApplePodcast | null => {
  const r = (data?.results ?? [])[0];
  return r ? fromItunes(r) : null;
};
export const parseTop = (data: any): ApplePodcast[] =>
  (data?.feed?.entry ?? []).map((r: any) => ({
    appleId: String(r.id?.attributes?.['im:id'] ?? ''),
    title: r['im:name']?.label ?? '',
    author: r['im:artist']?.label ?? '',
    artworkUrl: bigArtwork(r['im:image']?.at(-1)?.label),
    feedUrl: null,
    genre: r.category?.attributes?.label ?? null,
  }));
