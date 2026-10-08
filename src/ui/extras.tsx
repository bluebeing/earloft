import { useEffect, useRef, useState } from 'preact/hooks';
import { addBookmark, allBookmarks, bookmarksMarkdown, deleteBookmark, updateBookmarkNote } from '../bookmarks';
import { getPodcast, podSettings, updatePodSettings } from '../library';
import { chapterIndexAt, hasTranscript, loadTranscript, useChapters, type Chapter, type Cue } from '../media';
import { isLoaded, playEpisode, seekTo } from '../player';
import { state, toast, useStore, useTick } from '../store';
import type { Episode } from '../types';
import { formatClock } from '../util';
import { Artwork, Empty, Header, NotFoundInline, Spinner, go, scroller, showActions } from './common';
import { BookmarkIcon, TrashIcon } from './icons';

/** Přehraje epizodu od daného času (načte ji, pokud zrovna nehraje). */
export async function playAt(episodeId: string, time: number) {
  if (state.currentId === episodeId && isLoaded(episodeId)) {
    seekTo(time);
    if (!state.playing) void playEpisode(episodeId);
  } else {
    await playEpisode(episodeId);
    seekTo(time);
  }
}

// ---------------------------------------------------------------------------
// Kapitoly

export function showChapters(ep: Episode, chapters: Chapter[], pos: number) {
  const cur = state.currentId === ep.id ? chapterIndexAt(chapters, pos) : -1;
  showActions(
    'Kapitoly',
    chapters.map((c, i) => ({
      label: `${i === cur ? '▶︎ ' : ''}${formatClock(c.start)} · ${c.title}`,
      onClick: () => void playAt(ep.id, c.start),
    })),
  );
}

/** Seznam kapitol v detailu epizody (aktuální zvýrazněná). */
export function ChapterList({ ep }: { ep: Episode }) {
  const s = useStore();
  const chapters = useChapters(ep);
  const isCurrent = s.currentId === ep.id;
  useTick(isCurrent);
  if (!chapters.length) return null;
  const cur = isCurrent ? chapterIndexAt(chapters, s.position) : -1;
  return (
    <section class="chapters">
      <h2 class="section-title">Kapitoly</h2>
      <div class="chapter-list">
        {chapters.map((c, i) => (
          <button class={`chapter-row${i === cur ? ' on' : ''}`} onClick={() => void playAt(ep.id, c.start)}>
            <span class="chapter-time">{formatClock(c.start)}</span>
            <span class="chapter-title">{c.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Přepis

export function TranscriptPage({ id }: { id: string }) {
  const s = useStore();
  const ep = s.episodes.get(id);
  const [cues, setCues] = useState<Cue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isCurrent = s.currentId === id;
  useTick(isCurrent);
  const lastUserScroll = useRef(0);
  const lastActive = useRef(-1);

  useEffect(() => {
    if (!ep) return;
    loadTranscript(ep).then(setCues, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  // Uživatel scrolluje sám → chvíli neposouvat automaticky
  useEffect(() => {
    const el = scroller();
    const on = () => (lastUserScroll.current = Date.now());
    el?.addEventListener('touchmove', on, { passive: true });
    el?.addEventListener('wheel', on, { passive: true });
    return () => {
      el?.removeEventListener('touchmove', on);
      el?.removeEventListener('wheel', on);
    };
  }, []);

  const active = cues && isCurrent ? cues.findIndex((c, i) => c.start >= 0 && c.start <= s.position && (cues[i + 1]?.start ?? Infinity) > s.position) : -1;

  useEffect(() => {
    if (active < 0 || active === lastActive.current) return;
    lastActive.current = active;
    if (Date.now() - lastUserScroll.current < 4000) return;
    document.querySelector(`[data-cue="${active}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active]);

  if (!ep) return <NotFoundInline />;
  const pod = getPodcast(ep.podcastId);

  return (
    <div class="screen">
      <Header title="Přepis" back />
      <div class="transcript-head">
        <Artwork src={ep.artworkUrl || pod?.artworkUrl} size={56} />
        <div>
          <div class="episode-meta">{pod?.title}</div>
          <div class="episode-title">{ep.title}</div>
        </div>
      </div>
      {error && <div class="error-box">Přepis se nepodařilo načíst: {error}</div>}
      {!cues && !error && <Spinner />}
      {cues && cues.length === 0 && <Empty title="Přepis je prázdný" />}
      {cues && (
        <div class="transcript">
          {cues.map((c, i) => {
            const showSpeaker = c.speaker && c.speaker !== cues[i - 1]?.speaker;
            return (
              <p
                data-cue={i}
                class={`cue${i === active ? ' on' : ''}${c.start >= 0 ? ' timed' : ''}${active >= 0 && i < active ? ' past' : ''}`}
                onClick={() => c.start >= 0 && void playAt(ep.id, c.start)}
              >
                {showSpeaker && <span class="cue-speaker">{c.speaker}</span>}
                {c.start >= 0 && <span class="cue-time">{formatClock(c.start)}</span>}
                {c.text}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const openTranscript = (ep: Episode) => go(`/transcript/${ep.id}`);
export { hasTranscript };

// ---------------------------------------------------------------------------
// Nastavení podcastu

const RATE_OPTIONS = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5, 1.75, 2];
const INTRO_OPTIONS = [0, 10, 15, 20, 30, 45, 60, 90, 120];
const OUTRO_OPTIONS = [0, 10, 15, 20, 30, 45, 60, 90, 120, 180];

export function PodcastSettingsPage({ id }: { id: string }) {
  const s = useStore();
  const pod = getPodcast(id);
  if (!pod) return <NotFoundInline />;
  const ps = podSettings(id);
  const num = (e: Event) => Number((e.target as HTMLSelectElement).value);

  return (
    <div class="screen">
      <Header title="Nastavení podcastu" back />
      <div class="transcript-head">
        <Artwork src={pod.artworkUrl} size={56} />
        <div>
          <div class="episode-title">{pod.title}</div>
          <div class="episode-meta">{pod.author}</div>
        </div>
      </div>

      <h2 class="section-title">Přehrávání</h2>
      <div class="form-group">
        <label class="form-row">
          <span>Rychlost</span>
          <select value={ps.rate ?? ''} onChange={(e) => void updatePodSettings(id, { rate: (e.target as HTMLSelectElement).value ? num(e) : undefined })}>
            <option value="">Výchozí ({s.settings.rate}×)</option>
            {RATE_OPTIONS.map((r) => (
              <option value={r}>{r}×</option>
            ))}
          </select>
        </label>
        <label class="form-row">
          <span>Přeskočit úvod</span>
          <select value={ps.skipIntro ?? 0} onChange={(e) => void updatePodSettings(id, { skipIntro: num(e) })}>
            {INTRO_OPTIONS.map((v) => (
              <option value={v}>{v ? `${v} s` : 'Ne'}</option>
            ))}
          </select>
        </label>
        <label class="form-row">
          <span>Přeskočit závěr</span>
          <select value={ps.skipOutro ?? 0} onChange={(e) => void updatePodSettings(id, { skipOutro: num(e) })}>
            {OUTRO_OPTIONS.map((v) => (
              <option value={v}>{v ? `posledních ${v} s` : 'Ne'}</option>
            ))}
          </select>
        </label>
      </div>
      <p class="hint">Úvod se přeskočí při spuštění nové epizody. Před koncem se epizoda ukončí, označí jako přehraná a pustí se další z fronty.</p>

      <h2 class="section-title">Nové epizody</h2>
      <div class="form-group">
        <label class="form-row">
          <span>Automaticky přidat do fronty</span>
          <input type="checkbox" class="switch" checked={!!ps.autoQueue} onChange={(e) => void updatePodSettings(id, { autoQueue: (e.target as HTMLInputElement).checked })} />
        </label>
      </div>
      <p class="hint">Nové díly (ne starší než týden) se po obnovení feedu zařadí na konec fronty.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Záložky

export function bookmarkHere() {
  if (!state.currentId) return;
  void addBookmark(state.currentId, state.position);
}

export function BookmarkButton({ compact }: { compact?: boolean }) {
  return (
    <button class="pill-btn" onClick={bookmarkHere} title="Uložit záložku (B)" aria-label="Uložit záložku">
      <BookmarkIcon size={14} />
      {!compact && ' Záložka'}
    </button>
  );
}

function BookmarkRow({ b, showEpisode }: { b: ReturnType<typeof allBookmarks>[number]; showEpisode?: boolean }) {
  const [note, setNote] = useState(b.note);
  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => setNote(b.note), [b.note]);
  const ep = state.episodes.get(b.episodeId);
  const pod = getPodcast(b.podcastId);
  return (
    <div class="bookmark-row">
      {showEpisode && <Artwork src={ep?.artworkUrl || pod?.artworkUrl} size={44} />}
      <div class="bookmark-body">
        {showEpisode && (
          <a class="bookmark-ep" href={ep ? `#/episode/${ep.id}` : undefined}>
            <span class="episode-meta">{b.podcastTitle}</span>
            <span class="bookmark-ep-title">{b.episodeTitle}</span>
          </a>
        )}
        <div class="bookmark-line">
          <button class="play-pill" disabled={!ep} onClick={() => void playAt(b.episodeId, b.time)} title={ep ? 'Přehrát od záložky' : 'Epizoda už není ve feedu'}>
            ▶︎ {formatClock(b.time)}
          </button>
          <input
            class="bookmark-note"
            placeholder="Přidat poznámku…"
            value={note}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value;
              setNote(v);
              // Uložit chvíli po dopsání (nespoléhat jen na opuštění pole)
              clearTimeout(saveTimer.current);
              saveTimer.current = window.setTimeout(() => void updateBookmarkNote(b, v), 700);
            }}
            onBlur={() => {
              clearTimeout(saveTimer.current);
              if (note !== b.note) void updateBookmarkNote(b, note);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <button class="icon-btn small destructive" onClick={() => void deleteBookmark(b)} aria-label="Smazat záložku">
            <TrashIcon size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Záložky jedné epizody (v jejím detailu). */
export function EpisodeBookmarks({ ep }: { ep: Episode }) {
  useStore();
  const list = allBookmarks()
    .filter((b) => b.episodeId === ep.id)
    .sort((a, b) => a.time - b.time);
  if (!list.length) return null;
  return (
    <section>
      <h2 class="section-title">Záložky</h2>
      <div class="list">
        {list.map((b) => (
          <BookmarkRow b={b} key={b.id} />
        ))}
      </div>
    </section>
  );
}

/** Všechny záložky (Přehled → Záložky). */
export function BookmarksView() {
  useStore();
  const list = allBookmarks();

  const download = () => {
    const blob = new Blob([bookmarksMarkdown()], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'earloft-zalozky.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bookmarksMarkdown());
      toast('Zkopírováno jako Markdown');
    } catch {
      toast('Kopírování se nepovedlo');
    }
  };

  if (!list.length)
    return (
      <Empty title="Zatím žádné záložky">
        Při poslechu klepni v přehrávači na <BookmarkIcon size={13} /> a uloží se aktuální místo. Poznámku k němu dopíšeš tady.
      </Empty>
    );

  return (
    <>
      <div class="chips">
        <button class="chip" onClick={() => void copy()}>
          Kopírovat jako Markdown
        </button>
        <button class="chip" onClick={download}>
          Stáhnout .md
        </button>
      </div>
      <div class="list">
        {list.map((b) => (
          <BookmarkRow b={b} key={b.id} showEpisode />
        ))}
      </div>
    </>
  );
}
