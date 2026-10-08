import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import DOMPurify from 'dompurify';
import { addBookmark } from '../bookmarks';
import {
  activePodcasts,
  appleLookup,
  appleSearch,
  appleTop,
  categoryNamesFor,
  episodeArtwork,
  getEpisodeNotes,
  getPodcast,
  inCategory,
  isDone,
  isSubscribed,
  markPlayed,
  podSettings,
  previewApple,
  previewFeed,
  refreshAll,
  refreshPodcast,
  removeFromQueue,
  setPodcastPrivate,
  subscribe,
  subscribeApple,
  unsubscribe,
} from '../library';
import { hasTranscript } from '../media';
import { playAt, playEpisode } from '../player';
import { toast, useStore } from '../store';
import type { ApplePodcast, Episode } from '../types';
import { appleIdFromUrl, errorMessage, formatDate, formatDuration, safeHttpUrl } from '../util';
import { CategoryChips, pickCategories, useCategoryFilter } from './categories';
import { Artwork, Empty, EpisodeRow, Header, NotFound, PlayPill, Spinner, episodeActions, go, goBack, showActions } from './common';
import { ChapterList, EpisodeBookmarks } from './extras';
import { BookmarkIcon, CheckIcon, LockIcon, MoreIcon, PlayIcon, PlusIcon, RefreshIcon, TextIcon } from './icons';

// ---------------------------------------------------------------------------
// Poslouchat

export function ListenNow() {
  const s = useStore();
  const [cat, setCat] = useCategoryFilter('listen');

  const inProgress =
      [...s.states.values()]
        .filter((st) => !st.played && !st.skipped && st.position > 5 && s.episodes.has(st.episodeId) && !s.queue.includes(st.episodeId))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 12)
        .map((st) => s.episodes.get(st.episodeId)!);

  const queue = s.queue.map((id) => s.episodes.get(id)).filter(Boolean) as Episode[];

  const latest = (() => {
    const out: Episode[] = [];
    for (const p of activePodcasts()) if (inCategory(p.id, cat)) out.push(...(s.byPodcast.get(p.id) ?? []).slice(0, 5));
    return out
      .filter((e) => !isDone(e.id))
      .sort((a, b) => b.pubDate - a.pubDate)
      .slice(0, 40);
  })();

  return (
    <div class="screen">
      <Header
        title="Poslouchat"
        large
        actions={
          <button class={`icon-btn${s.refreshing ? ' spinning' : ''}`} onClick={() => void refreshAll()} aria-label="Obnovit">
            <RefreshIcon size={22} />
          </button>
        }
      />
      {s.refreshing && latest.length === 0 && inProgress.length === 0 && <Spinner />}
      {activePodcasts().length === 0 && !s.refreshing && (
        <Empty title="Zatím nic neodebíráš">
          Přidej podcast v <a href="#/search">Hledat</a> – z Apple Podcasts nebo vložením odkazu na soukromý RSS feed.
        </Empty>
      )}

      {inProgress.length > 0 && (
        <section>
          <h2 class="section-title">Pokračovat v poslechu</h2>
          <div class="cards">
            {inProgress.map((ep) => (
              <ContinueCard ep={ep} />
            ))}
          </div>
        </section>
      )}

      {queue.length > 0 && (
        <section>
          <h2 class="section-title">Fronta</h2>
          <div class="list">
            {queue.map((ep) => (
              <div class="queue-row">
                <EpisodeRow ep={ep} showPodcast />
                <button class="link-btn small" onClick={() => void removeFromQueue(ep.id)}>
                  Odebrat
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {(latest.length > 0 || cat) && (
        <section>
          <h2 class="section-title">Nové epizody</h2>
          <CategoryChips value={cat} onChange={setCat} />
          {latest.length === 0 && <Empty title="V této kategorii nic nového" />}
          <div class="list">
            {latest.map((ep) => (
              <EpisodeRow ep={ep} showPodcast />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ContinueCard({ ep }: { ep: Episode }) {
  const pod = getPodcast(ep.podcastId);
  return (
    <div class="card" onClick={() => go(`/episode/${ep.id}`)}>
      <Artwork src={episodeArtwork(ep)} size={150} />
      <div class="card-meta">{pod?.title}</div>
      <div class="card-title">{ep.title}</div>
      <PlayPill ep={ep} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Knihovna

export function Library({ catParam }: { catParam?: string }) {
  const s = useStore();
  const [chosen, setCat] = useCategoryFilter('library');
  // Kategorie z bočního panelu (#/library/<id>)
  useLayoutEffect(() => {
    if (catParam && catParam !== chosen) setCat(catParam);
  }, [catParam]);
  // Knihovna nemá „Vše“ – bez volby se ukáže první kategorie
  const cat = chosen ?? s.categories[0]?.id ?? null;
  const all = activePodcasts();
  const pods = all.filter((p) => inCategory(p.id, cat)).sort((a, b) => {
    const la = s.byPodcast.get(a.id)?.[0]?.pubDate ?? 0;
    const lb = s.byPodcast.get(b.id)?.[0]?.pubDate ?? 0;
    return lb - la;
  });
  return (
    <div class="screen">
      <Header title="Knihovna" large />
      {all.length > 0 && <CategoryChips value={cat} onChange={setCat} showManage allowAll={false} />}
      {all.length > 0 && pods.length === 0 ? (
        <Empty title="Prázdná kategorie">Podcast do kategorie přidáš v jeho detailu.</Empty>
      ) : pods.length === 0 ? (
        <Empty title="Knihovna je prázdná">
          Přidej první podcast v <a href="#/search">Hledat</a>.
        </Empty>
      ) : (
        <div class="grid">
          {pods.map((p) => {
            const unplayed = (s.byPodcast.get(p.id) ?? []).slice(0, 50).filter((e) => !isDone(e.id)).length;
            return (
              <a class="grid-item" href={`#/podcast/${p.id}`}>
                <div class="grid-art">
                  <Artwork src={p.artworkUrl} size={0} class="fluid" alt={p.title} />
                  {p.isPrivate && (
                    <span class="badge-lock" title="Soukromý feed">
                      <LockIcon size={12} />
                    </span>
                  )}
                  {p.fetchError && <span class="badge-error" title={p.fetchError}>!</span>}
                </div>
                <div class="grid-title">{p.title}</div>
                <div class="grid-sub">{unplayed ? `${unplayed} nepřehraných` : p.author}</div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail podcastu (odebíraného i náhledu)

export function PodcastPage({ id }: { id: string }) {
  const s = useStore();
  const pod = getPodcast(id);
  const [filter, setFilter] = useState<'all' | 'unplayed'>('all');
  const [limit, setLimit] = useState(60);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (!pod) return <NotFound />;
  const subscribed = isSubscribed(id);
  let eps = s.byPodcast.get(id) ?? [];
  if (filter === 'unplayed') eps = eps.filter((e) => !isDone(e.id));

  const latestUnplayed = (s.byPodcast.get(id) ?? []).find((e) => !isDone(e.id));

  const doSubscribe = async () => {
    setBusy(true);
    try {
      await subscribe(pod.feedUrl, pod);
      toast('Přidáno do knihovny');
    } catch (e) {
      toast(errorMessage(e, 'Nepodařilo se přidat'));
    } finally {
      setBusy(false);
    }
  };

  const menu = () =>
    showActions(pod.title, [
      { label: 'Nastavení podcastu…', onClick: () => go(`/podcast-settings/${pod.id}`) },
      { label: 'Kategorie…', onClick: () => pickCategories(pod.id) },
      { label: 'Obnovit feed', onClick: () => void refreshPodcast(pod, { ignoreCache: true }).then(() => toast('Obnoveno')) },
      { label: pod.isPrivate ? 'Označit jako veřejný' : 'Označit jako soukromý', onClick: () => void setPodcastPrivate(pod.id, !pod.isPrivate) },
      {
        label: 'Označit vše jako přehrané',
        onClick: () => (s.byPodcast.get(id) ?? []).forEach((e) => !s.states.get(e.id)?.played && markPlayed(e.id, true)),
      },
      ...(safeHttpUrl(pod.link) ? [{ label: 'Otevřít web podcastu', onClick: () => window.open(safeHttpUrl(pod.link)!, '_blank', 'noopener,noreferrer') }] : []),
      {
        label: 'Zrušit odběr',
        destructive: true,
        onClick: () => {
          if (confirm(`Opravdu zrušit odběr „${pod.title}“?`)) {
            void unsubscribe(pod.id);
            goBack();
          }
        },
      },
    ]);

  return (
    <div class="screen">
      <Header
        title={pod.title}
        back
        actions={
          subscribed && (
            <button class="icon-btn" onClick={menu} aria-label="Možnosti">
              <MoreIcon size={22} />
            </button>
          )
        }
      />
      <div class="podcast-hero">
        <Artwork src={pod.artworkUrl} size={200} alt={pod.title} class="hero-art" />
        <h1>{pod.title}</h1>
        {pod.author && <div class="hero-author">{pod.author}</div>}
        <div class="hero-buttons">
          {latestUnplayed && (
            <button class="btn primary" onClick={() => void playEpisode(latestUnplayed.id)}>
              <PlayIcon size={16} /> {s.states.get(latestUnplayed.id)?.position ? 'Pokračovat' : 'Nejnovější'}
            </button>
          )}
          {!subscribed && (
            <button class="btn" disabled={busy} onClick={doSubscribe}>
              <PlusIcon size={16} /> Odebírat
            </button>
          )}
          {subscribed && (
            <span class="hero-subscribed">
              <CheckIcon size={14} /> V knihovně{pod.isPrivate && ' · soukromý'}
            </span>
          )}
        </div>
        {subscribed && (
          <div class="hero-chips">
            <button class="chip category-chip" onClick={() => pickCategories(pod.id)}>
              {categoryNamesFor(pod.id).join(' · ') || '+ Přidat do kategorie'}
            </button>
            <a class="chip category-chip" href={`#/podcast-settings/${pod.id}`}>
              {podSettingsSummary(pod.id) || 'Nastavení'}
            </a>
          </div>
        )}
        {pod.fetchError && <div class="error-box">Poslední obnovení selhalo: {pod.fetchError}</div>}
        {pod.description && (
          <p class={`hero-desc${expanded ? ' expanded' : ''}`} onClick={() => setExpanded(!expanded)}>
            {pod.description}
          </p>
        )}
      </div>

      <div class="segmented">
        <button class={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
          Všechny epizody
        </button>
        <button class={filter === 'unplayed' ? 'on' : ''} onClick={() => setFilter('unplayed')}>
          Nepřehrané
        </button>
      </div>

      <div class="list">
        {eps.slice(0, limit).map((ep) => (
          <EpisodeRow ep={ep} />
        ))}
      </div>
      {eps.length > limit && (
        <button class="btn wide" onClick={() => setLimit(limit + 100)}>
          Zobrazit další ({eps.length - limit})
        </button>
      )}
      {eps.length === 0 && <Empty title="Žádné epizody" />}
    </div>
  );
}

/** Krátký popis vlastního nastavení podcastu pro čip v detailu. */
function podSettingsSummary(id: string): string {
  const ps = podSettings(id);
  const parts: string[] = [];
  if (ps.rate) parts.push(`${ps.rate}×`);
  if (ps.skipIntro) parts.push(`úvod −${ps.skipIntro} s`);
  if (ps.skipOutro) parts.push(`závěr −${ps.skipOutro} s`);
  if (ps.autoQueue) parts.push('do fronty');
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Detail epizody

const TIME_RE = /\b(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)\b/g;

/** Poznámky z feedu (nedůvěryhodné HTML nebo prostý text) → bezpečné HTML s klikacími časy. */
function prepareNotes(html: string): string {
  const looksHtml = /<[a-z][\s\S]*>/i.test(html);
  const clean = DOMPurify.sanitize(looksHtml ? html : html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'), {
    FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'video', 'audio'],
    FORBID_ATTR: ['style'],
  });
  const doc = new DOMParser().parseFromString(`<div>${clean}</div>`, 'text/html');
  const root = doc.body.firstElementChild!;
  openLinksExternally(root);
  linkifyTimestamps(doc, root);
  return root.innerHTML;
}

function openLinksExternally(root: Element) {
  root.querySelectorAll('a').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
}

/** Časové značky 12:34 → odkazy `a.ts[data-t]`, které přehrají epizodu od toho místa. */
function linkifyTimestamps(doc: Document, root: Element) {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const t of texts) {
    if (t.parentElement?.closest('a')) continue;
    const v = t.nodeValue ?? '';
    if (!TIME_RE.test(v)) continue;
    TIME_RE.lastIndex = 0;
    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const m of v.matchAll(TIME_RE)) {
      const sec = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      frag.append(v.slice(last, m.index));
      const a = doc.createElement('a');
      a.className = 'ts';
      a.dataset.t = String(sec);
      a.href = '#';
      a.textContent = m[0];
      frag.append(a);
      last = m.index! + m[0].length;
    }
    frag.append(v.slice(last));
    t.replaceWith(frag);
  }
}

export function EpisodePage({ id }: { id: string }) {
  const s = useStore();
  const ep = s.episodes.get(id);
  const [notes, setNotes] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getEpisodeNotes(id).then((html) => alive && setNotes(html ? prepareNotes(html) : ''));
    return () => void (alive = false);
  }, [id]);

  if (!ep) return <NotFound />;
  const pod = getPodcast(ep.podcastId);

  const onNotesClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a.ts') as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    void playAt(ep.id, Number(a.dataset.t));
  };

  return (
    <div class="screen">
      <Header
        title=""
        back
        actions={
          <button class="icon-btn" onClick={() => episodeActions(ep)} aria-label="Možnosti">
            <MoreIcon size={22} />
          </button>
        }
      />
      <div class="episode-hero">
        <Artwork src={episodeArtwork(ep)} size={140} />
        <div class="episode-meta">
          {formatDate(ep.pubDate)}
          {ep.duration ? ` · ${formatDuration(ep.duration)}` : ''}
        </div>
        <h1>{ep.title}</h1>
        {pod && (
          <a class="hero-author" href={`#/podcast/${pod.id}`}>
            {pod.title}
          </a>
        )}
        <div class="hero-buttons">
          <PlayPill ep={ep} />
          {hasTranscript(ep) && (
            <a class="pill-btn" href={`#/transcript/${ep.id}`}>
              <TextIcon size={14} /> Přepis
            </a>
          )}
          {s.currentId === ep.id && (
            <button class="pill-btn" onClick={() => void addBookmark(ep.id, s.position)}>
              <BookmarkIcon size={14} /> Záložka
            </button>
          )}
        </div>
      </div>
      <ChapterList ep={ep} />
      <EpisodeBookmarks ep={ep} />
      <h2 class="section-title notes-title">Poznámky</h2>
      <div class="notes" onClick={onNotesClick}>
        {notes === null ? <Spinner /> : notes ? <div dangerouslySetInnerHTML={{ __html: notes }} /> : <p class="muted">Bez popisu.</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hledat

export function Search() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ApplePodcast[] | null>(null);
  const [top, setTop] = useState<ApplePodcast[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useStore();

  useEffect(() => {
    appleTop()
      .then(setTop)
      .catch(() => setTop([]));
  }, []);

  const submit = async (e?: Event) => {
    e?.preventDefault();
    const text = q.trim();
    if (!text) return;
    setError(null);
    setLoading(true);
    try {
      const appleId = appleIdFromUrl(text);
      if (appleId) {
        const info = await appleLookup(appleId);
        if (!info) throw new Error('Podcast na Apple Podcasts nenalezen');
        go(`/podcast/${(await previewApple(info)).id}`);
      } else if (/^(https?:\/\/|feed:\/\/)/i.test(text)) {
        const url = text.replace(/^feed:\/\//i, 'https://');
        const p = await previewFeed(url);
        go(`/podcast/${p.id}`);
      } else {
        setResults(await appleSearch(text));
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const list = results ?? top;

  return (
    <div class="screen">
      <Header title="Hledat" large />
      <form class="search-box" onSubmit={submit}>
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="Podcast, odkaz z Apple Podcasts nebo RSS URL"
          value={q}
          onInput={(e) => {
            setQ((e.target as HTMLInputElement).value);
            if (!(e.target as HTMLInputElement).value) setResults(null);
          }}
        />
      </form>
      <p class="hint">
        Soukromý feed (Herohero, Patreon, Forendors…) přidáš vložením jeho RSS URL. Podcasty z Apple Podcasts vyhledej nebo vlož jejich odkaz.
      </p>
      {error && <div class="error-box">{error}</div>}
      {loading && <Spinner />}
      {!loading && list && (
        <section>
          <h2 class="section-title">{results ? 'Výsledky' : 'Nejoblíbenější v Česku'}</h2>
          {results && results.length === 0 && <Empty title="Nic nenalezeno" />}
          <div class="list">
            {list.map((a, i) => (
              <AppleRow a={a} rank={results ? undefined : i + 1} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AppleRow({ a, rank }: { a: ApplePodcast; rank?: number }) {
  const [busy, setBusy] = useState<'open' | 'add' | null>(null);
  const subscribed = activePodcasts().some((p) => p.appleId === a.appleId || (a.feedUrl && p.feedUrl === a.feedUrl));

  const run = async (kind: 'open' | 'add') => {
    setBusy(kind);
    try {
      if (kind === 'open') go(`/podcast/${(await previewApple(a)).id}`);
      else {
        await subscribeApple(a);
        toast(`„${a.title}“ přidáno do knihovny`);
      }
    } catch (e) {
      toast(errorMessage(e, 'Nepodařilo se'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="apple-row" onClick={() => !busy && void run('open')}>
      {rank && <span class="rank">{rank}</span>}
      <Artwork src={a.artworkUrl} size={64} />
      <div class="apple-body">
        <div class="episode-title">{a.title}</div>
        <div class="episode-meta">
          {a.author}
          {a.genre ? ` · ${a.genre}` : ''}
        </div>
      </div>
      {busy ? (
        <Spinner />
      ) : subscribed ? (
        <span class="icon-btn done">
          <CheckIcon size={20} />
        </span>
      ) : (
        <button
          class="icon-btn add"
          aria-label="Odebírat"
          onClick={(e) => {
            e.stopPropagation();
            void run('add');
          }}
        >
          <PlusIcon size={20} />
        </button>
      )}
    </div>
  );
}

