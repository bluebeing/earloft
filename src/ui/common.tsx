import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getPodcast, markPlayed, playLast, playNext, removeFromQueue } from '../library';
import { playEpisode, togglePlay } from '../player';
import { state, useStore, useTick } from '../store';
import type { Episode } from '../types';
import { formatDate, formatDuration } from '../util';
import { BackIcon, CheckIcon, MoreIcon, PauseIcon, PlayIcon } from './icons';

// ---------------------------------------------------------------------------
// Hash router: #/library, #/podcast/ID …

export type NavDir = 'forward' | 'back' | 'tab' | 'none';
export const TAB_ROOTS = ['#/', '#/library', '#/search', '#/settings'];

const currentHash = () => (location.hash && location.hash !== '#' ? location.hash : '#/');
/** Vlastní zásobník historie – podle něj poznáme směr navigace (animace) a kam vrátit scroll. */
const stack: string[] = [currentHash()];
const scrollPos = new Map<string, number>();
let lastDir: NavDir = 'none';

window.addEventListener('scroll', () => scrollPos.set(currentHash(), window.scrollY), { passive: true });
window.addEventListener('hashchange', () => {
  const h = currentHash();
  if (TAB_ROOTS.includes(h)) {
    stack.length = 0;
    stack.push(h);
    lastDir = 'tab';
  } else if (stack.length > 1 && stack[stack.length - 2] === h) {
    stack.pop();
    lastDir = 'back';
  } else {
    stack.push(h);
    lastDir = 'forward';
  }
});

/** Kam se má po přechodu posunout stránka: zpět/záložka = kde jsi byl, vpřed = nahoru. */
export const scrollTargetFor = (hash: string, dir: NavDir) => (dir === 'forward' ? 0 : (scrollPos.get(hash) ?? 0));

export function useRoute(): { route: string[]; hash: string; dir: NavDir } {
  const read = () => {
    const hash = currentHash();
    return { hash, dir: lastDir, route: hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent) };
  };
  const [r, setR] = useState(read);
  useEffect(() => {
    const on = () => setR(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

export const go = (path: string) => {
  location.hash = path;
};

/** Zpět v appce; při otevření rovnou na detailu (bez historie) skočí na úvod. */
export const goBack = () => (stack.length > 1 ? history.back() : go('/'));

/** Horní lišta jako v iOS: průhledná nahoře, po odscrollování rozmazané pozadí a malý titulek. */
export function Header({ title, back, actions, large }: { title: string; back?: boolean; actions?: ComponentChildren; large?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const threshold = large ? 40 : 150;
    const on = () => setScrolled(window.scrollY > threshold);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [large]);
  return (
    <>
      <header class={`topbar${scrolled ? ' scrolled' : ''}`}>
        <div class="topbar-row">
          {back ? (
            <button class="icon-btn back" onClick={goBack} aria-label="Zpět">
              <BackIcon size={22} />
            </button>
          ) : (
            <span />
          )}
          <div class={`topbar-title${scrolled ? ' visible' : ''}`}>{title}</div>
          <div class="topbar-actions">{actions}</div>
        </div>
      </header>
      {large && <h1 class="large-title">{title}</h1>}
    </>
  );
}

export function Artwork({ src, size, alt = '', class: cls = '' }: { src?: string | null; size: number; alt?: string; class?: string }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // Obrázek z cache může být hotový dřív, než se navěsí onLoad
  useEffect(() => {
    if (img.current?.complete && img.current.naturalWidth) setLoaded(true);
  }, [src]);
  return (
    <div class={`artwork ${cls}`} style={size ? { width: `${size}px`, height: `${size}px` } : undefined}>
      {src && !failed ? (
        <img
          ref={img}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          class={loaded ? 'loaded' : ''}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : (
        <div class="artwork-fallback" />
      )}
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

/**
 * Zavírání s animací (+ volitelně stažení tahem dolů jako v iOS).
 * `open` = je prvek právě zobrazený (aby se listenery navěsily až na existující DOM).
 */
export function useDismiss(onClosed: () => void, open: boolean, swipe = false) {
  const ref = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;

  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      closedRef.current();
    }, 240);
  };

  useEffect(() => {
    const el = ref.current;
    if (!swipe || !open || !el) return;
    let startY = 0;
    let dy = 0;
    let t0 = 0;
    let active = false;
    const start = (e: TouchEvent) => {
      // Posuvník a vnitřní scroll mají přednost
      if ((e.target as HTMLElement).closest('input') || el.scrollTop > 0) return;
      active = true;
      startY = e.touches[0].clientY;
      dy = 0;
      t0 = Date.now();
      el.style.transition = 'none';
    };
    const move = (e: TouchEvent) => {
      if (!active) return;
      dy = Math.max(0, e.touches[0].clientY - startY);
      if (dy > 0) {
        e.preventDefault();
        el.style.transform = `translateY(${dy}px)`;
      }
    };
    const end = () => {
      if (!active) return;
      active = false;
      const velocity = dy / Math.max(1, Date.now() - t0);
      el.style.transition = 'transform 0.26s cubic-bezier(0.2, 0.8, 0.2, 1)';
      if (dy > 120 || (dy > 30 && velocity > 0.5)) {
        el.style.transform = 'translateY(100%)';
        setTimeout(() => closedRef.current(), 250);
      } else {
        el.style.transform = '';
      }
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [swipe, open]);

  return { ref, closing, close };
}

export function ActionSheetHost() {
  const [sheet, setSheet] = useState<{ title?: string; actions: Action[] } | null>(null);
  const { ref, closing, close } = useDismiss(() => setSheet(null), !!sheet, true);
  useEffect(() => {
    openSheet = setSheet;
    return () => void (openSheet = null);
  }, []);
  if (!sheet) return null;
  return (
    <div class={`sheet-backdrop${closing ? ' closing' : ''}`} onClick={close}>
      <div class="action-sheet" ref={ref} onClick={(e) => e.stopPropagation()}>
        <div class="action-group">
          {sheet.title && <div class="action-title">{sheet.title}</div>}
          {sheet.actions.map((a) => (
            <button
              class={`action${a.destructive ? ' destructive' : ''}`}
              onClick={() => {
                close();
                a.onClick();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
        <button class="action action-cancel" onClick={close}>
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
  useTick(isCurrent);
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
