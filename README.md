# Podcasty

Osobní podcastový přehrávač jako PWA, vzhledem podobný Apple Podcasts. Hraje **soukromé RSS feedy placených podcastů** (Herohero, Forendors, Patreon, Supercast…) i **bezplatné podcasty z Apple Podcasts**. Odběry, rozposlouchané pozice, fronta a nastavení se synchronizují mezi zařízeními. Běží zdarma na Cloudflare.

## Jak to funguje

```
PWA (Preact + IndexedDB)  ──Bearer token──►  Cloudflare Worker  ──►  D1 (odběry, pozice, fronta, nastavení)
        │                                           ├─► /api/feed  – proxy RSS (kvůli CORS), streamuje
        │                                           └─► /api/apple – iTunes Search/Lookup/žebříčky
        └─ audio se přehrává přímo z URL epizody
```

- **RSS parsuje prohlížeč**, Worker je jen přeposílá. Free plán Workers má limit 10 ms CPU na request, velké feedy (i 20 MB) by se na serveru parsovat nestihly.
- **Apple Podcasts:** hledání a žebříčky jdou přes iTunes API. Každý veřejný podcast tam má své RSS a appka ho odebírá přímo. Podcasty, které jsou jen v placeném předplatném Apple Podcasts Subscriptions, veřejné RSS nemají, takže v appce nefungují.
- **Sync:** last‑write‑wins podle času změny na klientu. Při otevření appky se synchronizuje a feedy se obnovují nejvýš jednou za 15 minut. Při pauze a při schování appky se pozice odešle hned.
- **iOS:** Media Session API zajišťuje ovládání na zamčené obrazovce, z AirPods a v CarPlay (±15/30 s). Přehrávání na pozadí funguje přes jeden sdílený `<audio>` element.

## Lokální vývoj

```bash
npm install
echo APP_TOKEN=dev-token-zmen-me > .dev.vars
npm run db:local        # vytvoří lokální D1 schéma
npm run dev             # http://localhost:5173, token: dev-token-zmen-me
```

## Nasazení na Cloudflare (jednorázově)

```bash
npx wrangler login
npx wrangler d1 create podcasty          # vypíše database_id → vlož ho do wrangler.jsonc
npm run db:remote                        # vytvoří tabulky v produkční D1
npx wrangler secret put APP_TOKEN        # vlož dlouhý náhodný token (např. z: openssl rand -hex 32)
npm run deploy
```

Appka poběží na `https://podcasty.<tvůj-subdoména>.workers.dev`.

**iPhone:** otevři URL v Safari, klepni na Sdílet a pak na „Přidat na plochu“, spusť appku z plochy a zadej token. Totéž udělej na dalších zařízeních.

## Bezpečnost

- Všechna `/api/*` volání vyžadují `APP_TOKEN` a bez něj vrací 401.
- URL soukromých feedů jsou uložené v D1 na tvém Cloudflare účtu a Worker je nezapisuje do logů.
- OPML export obsahuje i soukromé URL, proto ho nesdílej.

## Struktura

| Cesta | Obsah |
| --- | --- |
| `worker/index.ts` | API, auth, proxy feedů, sync |
| `worker/apple.ts` | iTunes Search / Lookup / žebříčky |
| `worker/schema.sql` | D1 schéma |
| `src/library.ts` | odběry, obnova feedů, synchronizace, fronta, OPML |
| `src/player.ts` | přehrávač, Media Session, ukládání pozic |
| `src/feed.ts` | parser RSS (DOMParser) |
| `src/ui/` | obrazovky a komponenty |
| `scripts/make-icons.mjs` | generátor PNG ikon |
