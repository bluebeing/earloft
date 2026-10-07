import { appleLookup, appleSearch, appleTop } from './apple';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_TOKEN: string;
}

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

const err = (status: number, message: string) => json({ error: message }, status);

/** Porovnání tokenu v konstantním čase. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function authorized(req: Request, env: Env): boolean {
  if (!env.APP_TOKEN) return false;
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return safeEqual(token, env.APP_TOKEN);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    if (!authorized(req, env)) return err(401, 'Neplatný token');

    try {
      return await route(req, url, env, ctx);
    } catch (e) {
      // Do logu nikdy nepíšeme URL feedů (soukromé obsahují tokeny)
      console.error('API error', url.pathname, e instanceof Error ? e.message : e);
      return err(500, 'Chyba serveru');
    }
  },
} satisfies ExportedHandler<Env>;

async function route(req: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const path = url.pathname;
  const method = req.method;

  if (path === '/api/ping') return json({ ok: true });

  if (path === '/api/feed' && method === 'GET') return proxyFeed(req, url);

  if (path === '/api/apple/search') return json(await appleSearch(url.searchParams.get('q') ?? '', url.searchParams.get('country') ?? 'cz', ctx));
  if (path === '/api/apple/top') return json(await appleTop(url.searchParams.get('country') ?? 'cz', ctx));
  if (path === '/api/apple/lookup') return json(await appleLookup(url.searchParams.get('id') ?? '', ctx));

  if (path === '/api/sync' && method === 'GET') return sync(env, Number(url.searchParams.get('since') ?? 0));
  if (path === '/api/subs' && method === 'PUT') return putSub(env, await req.json());
  if (path === '/api/state' && method === 'POST') return postState(env, await req.json());
  const kvMatch = path.match(/^\/api\/kv\/([\w-]+)$/);
  if (kvMatch && method === 'PUT') return putKv(env, kvMatch[1], await req.json());

  return err(404, 'Nenalezeno');
}

/**
 * Přeposlání RSS feedu (prohlížeč ho kvůli CORS nemůže stáhnout sám).
 * Tělo se streamuje, takže to nestojí skoro žádný CPU čas.
 */
async function proxyFeed(req: Request, url: URL): Promise<Response> {
  const target = url.searchParams.get('url') ?? '';
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return err(400, 'Neplatná URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return err(400, 'Nepodporovaný protokol');

  const headers = new Headers({
    'user-agent': 'PodcastyPWA/1.0 (+private podcast player)',
    accept: 'application/rss+xml, application/xml, text/xml, */*',
  });
  const inm = req.headers.get('if-none-match');
  const ims = req.headers.get('if-modified-since');
  if (inm) headers.set('if-none-match', inm);
  if (ims) headers.set('if-modified-since', ims);

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), { headers, redirect: 'follow' });
  } catch {
    return err(502, 'Feed se nepodařilo stáhnout');
  }

  const out = new Headers({
    'content-type': upstream.headers.get('content-type') ?? 'application/xml',
    'cache-control': 'no-store',
    'x-final-url': upstream.url,
  });
  const etag = upstream.headers.get('etag');
  const lastMod = upstream.headers.get('last-modified');
  if (etag) out.set('etag', etag);
  if (lastMod) out.set('last-modified', lastMod);

  if (upstream.status === 304) return new Response(null, { status: 304, headers: out });
  if (!upstream.ok) return err(502, `Feed vrátil HTTP ${upstream.status}`);
  return new Response(upstream.body, { status: 200, headers: out });
}

interface SubRow {
  id: string;
  feed_url: string;
  title: string;
  author: string | null;
  artwork_url: string | null;
  source: string;
  apple_id: string | null;
  is_private: number;
  added_at: number;
  deleted: number;
  updated_at: number;
  server_ts: number;
}

async function sync(env: Env, since: number): Promise<Response> {
  const now = Date.now();
  const [subs, states, kv] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM subscriptions WHERE server_ts > ?').bind(since),
    env.DB.prepare('SELECT episode_id, podcast_id, position_s, duration_s, played, skipped, updated_at FROM episode_state WHERE server_ts > ?').bind(since),
    env.DB.prepare('SELECT key, value, updated_at FROM kv WHERE server_ts > ?').bind(since),
  ]);
  return json({
    now,
    subs: (subs.results as unknown as SubRow[]).map((r) => ({
      id: r.id,
      feedUrl: r.feed_url,
      title: r.title,
      author: r.author,
      artworkUrl: r.artwork_url,
      source: r.source,
      appleId: r.apple_id,
      isPrivate: !!r.is_private,
      addedAt: r.added_at,
      deleted: !!r.deleted,
      updatedAt: r.updated_at,
    })),
    states: (states.results as Record<string, unknown>[]).map((r) => ({
      episodeId: r.episode_id,
      podcastId: r.podcast_id,
      position: r.position_s,
      duration: r.duration_s,
      played: !!r.played,
      skipped: !!r.skipped,
      updatedAt: r.updated_at,
    })),
    kv: (kv.results as { key: string; value: string; updated_at: number }[]).map((r) => ({
      key: r.key,
      value: JSON.parse(r.value),
      updatedAt: r.updated_at,
    })),
  });
}

interface SubInput {
  id: string;
  feedUrl: string;
  title: string;
  author?: string | null;
  artworkUrl?: string | null;
  source?: string;
  appleId?: string | null;
  isPrivate?: boolean;
  addedAt: number;
  deleted?: boolean;
  updatedAt: number;
}

async function putSub(env: Env, s: SubInput): Promise<Response> {
  if (!s?.id || !s.feedUrl || typeof s.updatedAt !== 'number') return err(400, 'Neúplná data');
  await env.DB.prepare(
    `INSERT INTO subscriptions (id, feed_url, title, author, artwork_url, source, apple_id, is_private, added_at, deleted, updated_at, server_ts)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
     ON CONFLICT(id) DO UPDATE SET
       feed_url = excluded.feed_url, title = excluded.title, author = excluded.author, artwork_url = excluded.artwork_url,
       source = excluded.source, apple_id = excluded.apple_id, is_private = excluded.is_private, added_at = excluded.added_at,
       deleted = excluded.deleted, updated_at = excluded.updated_at, server_ts = excluded.server_ts
     WHERE excluded.updated_at >= subscriptions.updated_at`,
  )
    .bind(
      s.id,
      s.feedUrl,
      s.title || s.feedUrl,
      s.author ?? null,
      s.artworkUrl ?? null,
      s.source ?? 'rss',
      s.appleId ?? null,
      s.isPrivate ? 1 : 0,
      s.addedAt,
      s.deleted ? 1 : 0,
      s.updatedAt,
      Date.now(),
    )
    .run();
  return json({ ok: true });
}

interface StateInput {
  episodeId: string;
  podcastId: string;
  position: number;
  duration?: number | null;
  played: boolean;
  skipped?: boolean;
  updatedAt: number;
}

async function postState(env: Env, items: StateInput[]): Promise<Response> {
  if (!Array.isArray(items)) return err(400, 'Očekávám pole');
  const now = Date.now();
  const stmt = env.DB.prepare(
    `INSERT INTO episode_state (episode_id, podcast_id, position_s, duration_s, played, skipped, updated_at, server_ts)
     VALUES (?1, ?2, ?3, ?4, ?5, ?8, ?6, ?7)
     ON CONFLICT(episode_id) DO UPDATE SET
       position_s = excluded.position_s, duration_s = COALESCE(excluded.duration_s, episode_state.duration_s),
       played = excluded.played, skipped = excluded.skipped, updated_at = excluded.updated_at, server_ts = excluded.server_ts
     WHERE excluded.updated_at > episode_state.updated_at`,
  );
  const valid = items.filter((i) => i && typeof i.episodeId === 'string' && typeof i.updatedAt === 'number').slice(0, 500);
  if (valid.length) {
    await env.DB.batch(
      valid.map((i) => stmt.bind(i.episodeId, i.podcastId ?? '', Number(i.position) || 0, i.duration ?? null, i.played ? 1 : 0, i.updatedAt, now, i.skipped ? 1 : 0)),
    );
  }
  return json({ ok: true, count: valid.length });
}

async function putKv(env: Env, key: string, body: { value: unknown; updatedAt: number }): Promise<Response> {
  if (typeof body?.updatedAt !== 'number') return err(400, 'Chybí updatedAt');
  await env.DB.prepare(
    `INSERT INTO kv (key, value, updated_at, server_ts) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, server_ts = excluded.server_ts
     WHERE excluded.updated_at > kv.updated_at`,
  )
    .bind(key, JSON.stringify(body.value ?? null), body.updatedAt, Date.now())
    .run();
  return json({ ok: true });
}
