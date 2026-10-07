import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { getPodcast, markPlayed, playLast, playNext, removeFromQueue } from '../library';
import { playEpisode, togglePlay } from '../player';
import { state, useStore } from '../store';
import type { Episode } from '../types';
import { formatDate, formatDuration } from '../util';
import { BackIcon, CheckIcon, MoreIcon, PauseIcon, PlayIcon } from './icons';

// ---------------------------------------------------------------------------
// Hash router: #/library, #/podcast/ID …

export function useRoute(): string[] {
  const read = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (path: string) => {
  location.hash = path;
};

export function Header({ title, back, actions, large }: { title: string; back?: boolean; actions?: ComponentChildren; large?: boolean }) {
  return (
    <header class={`topbar${large ? ' large' : ''}`}>
      <div class="topbar-row">
        {back ? (
          <button class="icon-btn back" onClick={() => history.back()} aria-label="Zpět">
            <BackIcon size={22} />
          </button>
        ) : (
          <span />
        )}
        {!large && <div class="topbar-title">{title}</div>}
        <div class="topbar-actions">{actions}</div>
      </div>
      {large && <h1>{title}</h1>}
    </header>
  );
}

export function Artwork({ src, size, alt = '', class: cls = '' }: { src?: string | null; size: number; alt?: string; class?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div class={`artwork ${cls}`} style={size ? { width: `${size}px`, height: `${size}px` } : undefined}>
      {src && !failed ? <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <div class="artwork-fallback" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Akční menu (bottom sheet)

export interface Action {
  label: string;
  onClick: () => void;
  destructive?: boolean;
}

let openSheet: ((a: { title?: string; actions: Action[] } | null) => void) | null = null;

export function showActions(title: string | undefined, actions: Action[]) {
  openSheet?.({ title, actions });
}

export function ActionSheetHost() {
  const [sheet, setSheet] = useState<{ title?: string; actions: Action[] } | null>(null);
  useEffect(() => {
    openSheet = setSheet;
    return () => void (openSheet = null);
  }, []);
  if (!sheet) return null;
  return (
    <div class="sheet-backdrop" onClick={() => setSheet(null)}>
      <div class="action-sheet" onClick={(e) => e.stopPropagation()}>
        <div class="action-group">
          {sheet.title && <div class="action-title">{sheet.title}</div>}
          {sheet.actions.map((a) => (
            <button
              class={`action${a.destructive ? ' destructive' : ''}`}
              onClick={() => {
                setSheet(null);
                a.onClick();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
        <button class="action action-cancel" onClick={() => setSheet(null)}>
          Zrušit
        </button>
      </div>
    </div>
  );
}

export function episodeActions(ep: Episode) {
  const st = state.states.get(ep.id);
  const inQueue = state.queue.includes(ep.id);
  const actions: Action[] = [
    { label: 'Přehrát jako další', onClick: () => void playNext(ep.id) },
    { label: 'Přidat na konec fronty', onClick: () => void playLast(ep.id) },
  ];
  if (inQueue) actions.push({ label: 'Odebrat z fronty', onClick: () => void removeFromQueue(ep.id) });
  actions.push(
    st?.played
      ? { label: 'Označit jako nepřehrané', onClick: () => markPlayed(ep.id, false) }
      : { label: 'Označit jako přehrané', onClick: () => markPlayed(ep.id, true) },
  );
  actions.push({ label: 'Detail epizody', onClick: () => go(`/episode/${ep.id}`) });
  const pod = getPodcast(ep.podcastId);
  if (pod) actions.push({ label: `Přejít na ${pod.title}`, onClick: () => go(`/podcast/${pod.id}`) });
  showActions(ep.title, actions);
}

// ---------------------------------------------------------------------------
// Tlačítko přehrát s ukazatelem zbývajícího času

export function PlayPill({ ep }: { ep: Episode }) {
  const s = useStore();
  const st = s.states.get(ep.id);
  const isCurrent = s.currentId === ep.id;
  const playing = isCurrent && s.playing;
  const dur = (isCurrent && s.duration) || st?.duration || ep.duration || 0;
  const pos = isCurrent ? s.position : st && !st.played ? st.position : 0;
  const started = pos > 5 && dur > 0;
  const label = st?.played && !isCurrent ? 'Přehráno' : started ? `zbývá ${formatDuration(dur - pos) || '<1 min'}` : formatDuration(dur);

  return (
    <button
      class={`play-pill${playing ? ' active' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        if (isCurrent) togglePlay();
        else void playEpisode(ep.id);
      }}
      aria-label={playing ? 'Pozastavit' : 'Přehrát'}
    >
      {playing ? <PauseIcon size={12} /> : st?.played && !isCurrent ? <CheckIcon size={12} /> : <PlayIcon size={12} />}
      {started && !st?.played && (
        <span class="pill-progress">
          <span style={{ width: `${Math.min(100, (pos / dur) * 100)}%` }} />
        </span>
      )}
      <span>{label}</span>
    </button>
  );
}

export function EpisodeRow({ ep, showPodcast }: { ep: Episode; showPodcast?: boolean }) {
  const pod = getPodcast(ep.podcastId);
  const st = useStore().states.get(ep.id);
  return (
    <div class={`episode-row${st?.played ? ' played' : ''}`} onClick={() => go(`/episode/${ep.id}`)}>
      {showPodcast && <Artwork src={ep.artworkUrl || pod?.artworkUrl} size={56} />}
      <div class="episode-body">
        <div class="episode-meta">
          {showPodcast && pod ? `${pod.title} · ` : ''}
          {formatDate(ep.pubDate)}
          {ep.season && ep.episode ? ` · S${ep.season} E${ep.episode}` : ''}
        </div>
        <div class="episode-title">{ep.title}</div>
        {ep.summary && <div class="episode-summary">{ep.summary}</div>}
        <div class="episode-actions">
          <PlayPill ep={ep} />
          <button
            class="icon-btn more"
            onClick={(e) => {
              e.stopPropagation();
              episodeActions(ep);
            }}
            aria-label="Další akce"
          >
            <MoreIcon size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Spinner() {
  return <div class="spinner" aria-label="Načítám" />;
}
