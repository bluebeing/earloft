import { useState } from 'preact/hooks';
import { episodeArtwork, getPodcast } from '../library';
import { chapterIndexAt, hasTranscript, useChapters, type Chapter } from '../media';
import { currentRate, cycleRate, seekChapter, seekTo, setSleepTimer, skipBack, skipForward, togglePlay } from '../player';
import { set, state, useStore, useTick } from '../store';
import { formatClock } from '../util';
import { Artwork, go, showActions, useDismiss } from './common';
import { BookmarkButton, showChapters } from './extras';
import { ChevronDownIcon, ListIcon, MoonIcon, PauseIcon, PlayIcon, SkipIcon, TextIcon } from './icons';

const openNowPlaying = () => set({ nowPlayingOpen: true });

const SLEEP_MINUTES = [5, 15, 30, 45, 60];

const sleepTimerOn = () => !!(state.sleepAt || state.sleepAtEnd);

function showSleepMenu() {
  showActions('Časovač vypnutí', [
    ...SLEEP_MINUTES.map((m) => ({ label: `${m} minut`, onClick: () => setSleepTimer(m) })),
    { label: 'Na konci epizody', onClick: () => setSleepTimer('end') },
    ...(sleepTimerOn() ? [{ label: 'Vypnout časovač', destructive: true, onClick: () => setSleepTimer(null) }] : []),
  ]);
}

function sleepTimerLabel(): string {
  if (state.sleepAtEnd) return 'Konec ep.';
  if (state.sleepAt) return `${Math.max(1, Math.ceil((state.sleepAt - Date.now()) / 60000))} min`;
  return '';
}

const currentChapter = (chapters: Chapter[], position: number) => chapters[chapterIndexAt(chapters, position)] ?? null;

/** Posuvník pozice: během tažení ukazuje cílový čas, skočí se až po puštění. */
function useScrubber(duration: number, position: number) {
  const [scrub, setScrub] = useState<number | null>(null);
  const pos = scrub ?? position;
  const inputProps = {
    type: 'range' as const,
    min: 0,
    max: Math.max(1, Math.floor(duration)),
    step: 1,
    value: Math.floor(pos),
    onInput: (e: Event) => setScrub(Number((e.target as HTMLInputElement).value)),
    onChange: (e: Event) => {
      seekTo(Number((e.target as HTMLInputElement).value));
      setScrub(null);
    },
    class: scrub !== null ? 'scrubbing' : '',
    style: { '--pct': `${duration ? (pos / duration) * 100 : 0}%` },
  };
  return { pos, inputProps };
}

const remainingLabel = (duration: number, pos: number) => (duration ? `-${formatClock(duration - pos)}` : '--:--');

export function MiniPlayer() {
  const s = useStore();
  useTick();
  const ep = s.currentId ? s.episodes.get(s.currentId) : null;
  if (!ep) return null;
  const pod = getPodcast(ep.podcastId);
  const pct = s.duration ? (s.position / s.duration) * 100 : 0;
  return (
    <div class="mini-player" onClick={openNowPlaying}>
      <div class="mini-progress" style={{ width: `${pct}%` }} />
      <Artwork src={episodeArtwork(ep)} size={44} />
      <div class="mini-text">
        <div class="mini-title">{ep.title}</div>
        <div class="mini-sub">{pod?.title}</div>
      </div>
      <button
        class="icon-btn"
        aria-label={s.playing ? 'Pozastavit' : 'Přehrát'}
        onClick={(e) => {
          e.stopPropagation();
          togglePlay();
        }}
      >
        {s.playing ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
      </button>
      <button
        class="icon-btn"
        aria-label="Posunout vpřed"
        onClick={(e) => {
          e.stopPropagation();
          skipForward();
        }}
      >
        <SkipIcon seconds={s.settings.skipForward} forward size={28} />
      </button>
    </div>
  );
}

export function NowPlaying() {
  const s = useStore();
  useTick(s.nowPlayingOpen);
  const ep = s.currentId ? s.episodes.get(s.currentId) : null;
  const visible = s.nowPlayingOpen && !!ep;
  const { ref, closing, close } = useDismiss(() => set({ nowPlayingOpen: false }), visible);
  const chapters = useChapters(visible ? ep : null);
  const dur = s.duration || ep?.duration || 0;
  const { pos, inputProps } = useScrubber(dur, s.position);
  if (!visible || !ep) return null;
  const chapter = currentChapter(chapters, s.position);
  const pod = getPodcast(ep.podcastId);
  const sleepLabel = sleepTimerLabel();
  const closeAndGo = (path: string) => {
    close();
    go(path);
  };

  return (
    <div class={`now-playing${closing ? ' closing' : ''}`} ref={ref}>
      <div class="np-inner">
        <button class="np-close" onClick={close} aria-label="Zavřít">
          <ChevronDownIcon size={28} />
        </button>
        <div class="np-art">
          <Artwork src={episodeArtwork(ep)} size={0} class="fluid" />
        </div>
        <div class="np-info">
          <div class="np-title">{ep.title}</div>
          <button class="np-podcast" onClick={() => (pod ? closeAndGo(`/podcast/${pod.id}`) : close())}>
            {pod?.title}
          </button>
          {chapter && (
            <button class="np-chapter" onClick={() => showChapters(ep, chapters, s.position)}>
              <ListIcon size={13} /> {chapter.title}
            </button>
          )}
        </div>

        <div class="np-scrubber">
          <input {...inputProps} />
          <div class="np-times">
            <span>{formatClock(pos)}</span>
            <span>{remainingLabel(dur, pos)}</span>
          </div>
        </div>

        <div class="np-controls">
          <button class="icon-btn" onClick={skipBack} aria-label={`Zpět o ${s.settings.skipBack} s`}>
            <SkipIcon seconds={s.settings.skipBack} size={44} />
          </button>
          <button class="icon-btn np-play" onClick={togglePlay} aria-label={s.playing ? 'Pozastavit' : 'Přehrát'}>
            {s.buffering && s.playing ? <div class="spinner large" /> : s.playing ? <PauseIcon size={56} /> : <PlayIcon size={56} />}
          </button>
          <button class="icon-btn" onClick={skipForward} aria-label={`Vpřed o ${s.settings.skipForward} s`}>
            <SkipIcon seconds={s.settings.skipForward} forward size={44} />
          </button>
        </div>

        <div class="np-extras">
          <button class="pill-btn" onClick={cycleRate} title="Rychlost">
            {currentRate()}×
          </button>
          {chapters.length > 0 && (
            <button class="pill-btn" onClick={() => showChapters(ep, chapters, s.position)} title="Kapitoly" aria-label="Kapitoly">
              <ListIcon size={15} />
            </button>
          )}
          {hasTranscript(ep) && (
            <button class="pill-btn" title="Přepis" aria-label="Přepis" onClick={() => closeAndGo(`/transcript/${ep.id}`)}>
              <TextIcon size={15} />
            </button>
          )}
          <BookmarkButton compact />
          <button class="pill-btn" onClick={() => closeAndGo(`/episode/${ep.id}`)}>
            Poznámky
          </button>
          <button class={`pill-btn${sleepLabel ? ' on' : ''}`} onClick={showSleepMenu} aria-label="Časovač vypnutí">
            <MoonIcon size={14} /> {sleepLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Spodní přehrávač pro počítač: info vlevo, ovládání + posuvník uprostřed, doplňky vpravo. */
export function DesktopPlayer() {
  const s = useStore();
  useTick();
  const ep = s.currentId ? s.episodes.get(s.currentId) : null;
  const chapters = useChapters(ep);
  const dur = s.duration || ep?.duration || 0;
  const { pos, inputProps } = useScrubber(dur, s.position);
  if (!ep) return null;
  const pod = getPodcast(ep.podcastId);
  const chapter = currentChapter(chapters, s.position);

  return (
    <div class="desk-player">
      <div class="dp-info">
        <button class="dp-art" onClick={openNowPlaying} aria-label="Otevřít přehrávač">
          <Artwork src={episodeArtwork(ep)} size={56} />
        </button>
        <div class="dp-text">
          <a class="dp-title" href={`#/episode/${ep.id}`} title={ep.title}>
            {ep.title}
          </a>
          {pod && (
            <a class="dp-sub" href={`#/podcast/${pod.id}`}>
              {pod.title}
            </a>
          )}
          {chapter && (
            <button class="dp-chapter" onClick={() => showChapters(ep, chapters, s.position)} title="Kapitoly">
              <ListIcon size={12} /> {chapter.title}
            </button>
          )}
        </div>
      </div>

      <div class="dp-center">
        <div class="dp-controls">
          <button class="icon-btn" onClick={skipBack} aria-label={`Zpět o ${s.settings.skipBack} s`} title="Zpět (←)">
            <SkipIcon seconds={s.settings.skipBack} size={30} />
          </button>
          <button class="icon-btn dp-play" onClick={togglePlay} aria-label={s.playing ? 'Pozastavit' : 'Přehrát'} title="Přehrát / pozastavit (mezerník)">
            {s.playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
          </button>
          <button class="icon-btn" onClick={skipForward} aria-label={`Vpřed o ${s.settings.skipForward} s`} title="Vpřed (→)">
            <SkipIcon seconds={s.settings.skipForward} forward size={30} />
          </button>
        </div>
        <div class="dp-scrubber np-scrubber">
          <span>{formatClock(pos)}</span>
          <input {...inputProps} aria-label="Pozice v epizodě" />
          <span>{remainingLabel(dur, pos)}</span>
        </div>
      </div>

      <div class="dp-extras">
        {chapters.length > 1 && (
          <>
            <button class="icon-btn" onClick={() => seekChapter(-1)} title="Předchozí kapitola" aria-label="Předchozí kapitola">
              <ChevronDownIcon size={20} style={{ transform: 'rotate(90deg)' }} />
            </button>
            <button class="icon-btn" onClick={() => seekChapter(1)} title="Další kapitola" aria-label="Další kapitola">
              <ChevronDownIcon size={20} style={{ transform: 'rotate(-90deg)' }} />
            </button>
          </>
        )}
        {hasTranscript(ep) && (
          <a class="pill-btn" href={`#/transcript/${ep.id}`} title="Přepis" aria-label="Přepis">
            <TextIcon size={15} />
          </a>
        )}
        <BookmarkButton compact />
        <button class="pill-btn" onClick={cycleRate} title="Rychlost přehrávání">
          {currentRate()}×
        </button>
        <button class={`pill-btn${sleepTimerOn() ? ' on' : ''}`} onClick={showSleepMenu} title="Časovač vypnutí">
          <MoonIcon size={14} />
        </button>
        <button class="icon-btn" onClick={openNowPlaying} title="Celá obrazovka" aria-label="Otevřít přehrávač">
          <ChevronDownIcon size={22} style={{ transform: 'rotate(180deg)' }} />
        </button>
      </div>
    </div>
  );
}
