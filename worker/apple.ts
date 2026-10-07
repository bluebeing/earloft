/** Záložní proxy na Apple katalog (PWA volá Apple primárně přímo – sdílené IP Cloudflare Apple často omezuje 429). */
import { appleLookupUrl, appleSearchUrl, appleTopUrl, parseLookup, parseSearch, parseTop, type ApplePodcast } from '../shared/apple';

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

export async function appleSearch(q: string, country: string, ctx: ExecutionContext): Promise<ApplePodcast[]> {
  if (!q.trim()) return [];
  return parseSearch(await cachedJson(appleSearchUrl(q, country), 3600, ctx));
}

export async function appleLookup(id: string, ctx: ExecutionContext): Promise<ApplePodcast | null> {
  if (!/^\d+$/.test(id)) return null;
  return parseLookup(await cachedJson(appleLookupUrl(id), 3600, ctx));
}

export async function appleTop(country: string, ctx: ExecutionContext): Promise<ApplePodcast[]> {
  return parseTop(await cachedJson(appleTopUrl(country), 6 * 3600, ctx));
}
