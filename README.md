# Posluchárna

Osobní podcastový přehrávač jako PWA, vzhledem podobný Apple Podcasts. Hraje **soukromé RSS feedy placených podcastů** (Herohero, Forendors, Patreon, Supercast…) i **bezplatné podcasty z Apple Podcasts**. Odběry, rozposlouchané pozice, fronta, kategorie a statistiky se synchronizují mezi zařízeními. Běží zdarma na Cloudflare Workers + D1 a je určený pro jednoho uživatele: každý si nasazuje vlastní instanci.

## Funkce

- Přidání podcastu vyhledáním v katalogu Apple Podcasts, vložením odkazu `podcasts.apple.com/…` nebo vložením RSS URL (i soukromé s tokenem). Funguje i import a export OPML.
- **Poslouchat:** pokračovat v poslechu, fronta (Up Next) a nové epizody s filtrem podle kategorií.
- **Knihovna** s vlastními kategoriemi. Podcast může být ve více kategoriích.
- **Epizody:** lze je označit jako přehrané nebo jako „Nechci přehrát“. Časové značky v poznámkách jsou klikací.
- **Přehrávač:**
  - posun ±15/30 s, rychlost 0.8–2× a časovač vypnutí;
  - ovládání z lock screenu, AirPods i CarPlay (Media Session API);
  - stažení velkého přehrávače tahem dolů.
- **Přehled:**
  - kalendář vydaných epizod;
  - statistiky poslechu: odposlouchaný čas, graf, dokončené epizody, čas ušetřený rychlostí, série dní a nejposlouchanější podcasty.
- **Rozložení pro mobil** (iPhone, PWA na ploše) **i pro počítač**: boční panel, spodní přehrávač a klávesové zkratky (mezerník, ← →, Esc).

## Jak to funguje

```
PWA (Preact + IndexedDB)  ──Bearer token──►  Cloudflare Worker  ──►  D1 (odběry, pozice, fronta, nastavení, statistiky)
        │                                           └─► /api/feed – proxy RSS (kvůli CORS), streamuje
        ├─► itunes.apple.com – hledání a žebříčky (přímo z prohlížeče, CORS)
        └─ audio se přehrává přímo z URL epizody
```

- **RSS parsuje prohlížeč** (DOMParser) a Worker feedy jen přeposílá. Free plán Workers má limit 10 ms CPU na request, velké feedy (i 20 MB) by se na serveru zparsovat nestihly. Nezměněný feed se pozná podle ETagu nebo otisku obsahu a znovu se nezpracovává.
- **Apple Podcasts:** každý veřejný podcast má v katalogu své RSS a appka ho odebírá přímo. Podcasty, které jsou jen v placeném předplatném Apple Podcasts Subscriptions, veřejné RSS nemají, takže je přehrát nelze. iTunes API se volá z prohlížeče, protože sdílené IP adresy Cloudflare Apple omezuje (HTTP 429). Worker slouží jen jako záloha.
- **Synchronizace:** platí poslední změna podle času zápisu (last-write-wins). Statistiky zapisuje každé zařízení do vlastních klíčů, takže se souběžné zápisy nepřepisují.

## Lokální vývoj

```bash
npm install
echo APP_TOKEN=dev-token-zmen-me > .dev.vars
npm run db:local        # vytvoří lokální D1 schéma
npm run dev             # http://localhost:5173, token: dev-token-zmen-me
```

## Nasazení na vlastní Cloudflare účet

```bash
npx wrangler login
npx wrangler d1 create podcasty          # vypíše database_id → vlož ho do wrangler.jsonc
npm run db:remote                        # vytvoří tabulky v produkční D1
npx wrangler secret put APP_TOKEN        # vlož dlouhý náhodný token, např. z: openssl rand -base64 32
npm run deploy
```

Appka poběží na `https://podcasty.<tvoje-subdoména>.workers.dev`. Při aktualizaci starší instance spusť i migrace z `worker/migrations/` (`npm run db:migrate`).

**iPhone:** otevři URL v Safari, klepni na Sdílet a pak na „Přidat na plochu“. Appku spusť z plochy a zadej token.

## Bezpečnost

- Všechna `/api/*` volání vyžadují `APP_TOKEN` (Bearer, porovnání v konstantním čase). Bez něj server vrací 401 a proxy feedů nejde použít jako otevřená proxy.
- Proxy vrací obsah feedů jako `text/plain` s `nosniff` a `CSP: sandbox`, takže ho prohlížeč nikdy nevykreslí jako stránku z domény appky.
- Poznámky epizod se čistí knihovnou DOMPurify. Odkazy z feedů se otevírají jen jako `http(s)`. Statické soubory mají přísnou Content-Security-Policy (`public/_headers`).
- URL soukromých feedů jsou jen v tvé D1 a v prohlížeči. Worker je nezapisuje do logů.
- OPML export obsahuje i soukromé URL, proto ho nesdílej.
- V repozitáři nejsou žádná tajemství. `database_id` ve `wrangler.jsonc` bez přístupu k Cloudflare účtu k ničemu není a token se nastavuje jako secret.

## Struktura

| Cesta | Obsah |
| --- | --- |
| `worker/index.ts` | API, autentizace, proxy feedů, synchronizace |
| `worker/apple.ts`, `shared/apple.ts` | iTunes Search / Lookup / žebříčky |
| `worker/schema.sql`, `worker/migrations/` | D1 schéma a migrace |
| `src/library.ts` | odběry, obnova feedů, synchronizace, fronta, kategorie, OPML |
| `src/player.ts` | přehrávač, Media Session, ukládání pozic |
| `src/stats.ts` | evidence poslechu pro statistiky |
| `src/feed.ts` | parser RSS (DOMParser) |
| `src/ui/` | obrazovky a komponenty |
| `src/styles.css`, `src/desktop.css` | vzhled (mobil, počítač) |
| `scripts/make-icons.mjs` | generátor PNG ikon |

## Licence

[MIT](LICENSE)
