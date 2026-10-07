/** Napojení na veřejný katalog Apple Podcasts (iTunes Search API). */

export interface ApplePodcast {
  appleId: string;
  title: string;
  author: string;
  artworkUrl: string;
  feedUrl: string | null;
  genre: string | null;
}

const bigArtwork = (url: string | undefined) => (url ? url.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/, '/600x600bb.$2') : '');

async function cachedJson(url: string, ttl: number, ctx: ExecutionContext): Promise<any> {
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(url);
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const res = await fetch(url, { headers: { 'user-agent': 'PodcastyPWA/1.0' } });
  if (!res.ok) throw new Error(`Apple API HTTP ${res.status}`);
  const text = await res.text();
  ctx.waitUntil(cache.put(key, new Response(text, { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${ttl}` } })));
  return JSON.parse(text);
}

function fromItunes(r: any): ApplePodcast {
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

const cleanCountry = (c: string) => (/^[a-z]{2}$/i.test(c) ? c.toLowerCase() : 'cz');

export async function appleSearch(q: string, country: string, ctx: ExecutionContext): Promise<ApplePodcast[]> {
  q = q.trim();
  if (!q) return [];
  const url = `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=40&country=${cleanCountry(country)}&term=${encodeURIComponent(q)}`;
  const data = await cachedJson(url, 3600, ctx);
  return (data.results ?? []).map(fromItunes);
}

export async function appleLookup(id: string, ctx: ExecutionContext): Promise<ApplePodcast | null> {
  if (!/^\d+$/.test(id)) return null;
  const data = await cachedJson(`https://itunes.apple.com/lookup?id=${id}&entity=podcast`, 3600, ctx);
  const r = (data.results ?? [])[0];
  return r ? fromItunes(r) : null;
}

export async function appleTop(country: string, ctx: ExecutionContext): Promise<ApplePodcast[]> {
  // Starší iTunes RSS je spolehlivější než rss.marketingtools.apple.com
  const url = `https://itunes.apple.com/${cleanCountry(country)}/rss/toppodcasts/limit=50/json`;
  const data = await cachedJson(url, 6 * 3600, ctx);
  return (data.feed?.entry ?? []).map((r: any) => ({
    appleId: String(r.id?.attributes?.['im:id'] ?? ''),
    title: r['im:name']?.label ?? '',
    author: r['im:artist']?.label ?? '',
    artworkUrl: bigArtwork(r['im:image']?.at(-1)?.label),
    feedUrl: null,
    genre: r.category?.attributes?.label ?? null,
  }));
}
