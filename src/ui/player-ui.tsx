import { useState } from 'preact/hooks';
import { getPodcast } from '../library';
import { seekTo, setRate, setSleepTimer, skipBack, skipForward, togglePlay } from '../player';
import { set, useStore, useTick } from '../store';
import { formatClock } from '../util';
import { Artwork, go, showActions, useDismiss } from './common';
import { ChevronDownIcon, MoonIcon, PauseIcon, PlayIcon, SkipIcon } from './icons';

export function MiniPlayer() {
  const s = useStore();
  useTick();
  const ep = s.currentId ? s.episodes.get(s.currentId) : null;
  if (!ep) return null;
  const pod = getPodcast(ep.podcastId);
  const pct = s.duration ? (s.position / s.duration) * 100 : 0;
  return (
    <div class="mini-player" onClick={() => set({ nowPlayingOpen: true })}>
      <div class="mini-progress" style={{ width: `${pct}%` }} />
      <Artwork src={ep.artworkUrl || pod?.artworkUrl} size={44} />
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

const RATES = [0.8, 1, 1.1, 1.2, 1.3, 1.5, 1.75, 2];

export function NowPlaying() {
  const s = useStore();
  useTick(s.nowPlayingOpen);
  const [scrub, setScrub] = useState<number | null>(null);
  const ep = s.currentId ? s.episodes.get(s.currentId) : null;
  const visible = s.nowPlayingOpen && !!ep;
  const { ref, closing, close } = useDismiss(() => set({ nowPlayingOpen: false }), visible, true);
  if (!visible || !ep) return null;
  const pod = getPodcast(ep.podcastId);
  const dur = s.duration || ep.duration || 0;
  const pos = scrub ?? s.position;

  const nextRate = () => {
    const i = RATES.indexOf(s.settings.rate);
    setRate(RATES[(i + 1) % RATES.length] ?? 1);
  };

  const sleepMenu = () =>
    showActions('Časovač vypnutí', [
      ...[5, 15, 30, 45, 60].map((m) => ({ label: `${m} minut`, onClick: () => setSleepTimer(m) })),
      { label: 'Na konci epizody', onClick: () => setSleepTimer('end') },
      ...(s.sleepAt || s.sleepAtEnd ? [{ label: 'Vypnout časovač', destructive: true, onClick: () => setSleepTimer(null) }] : []),
    ]);

  const sleepLabel = s.sleepAtEnd ? 'Konec ep.' : s.sleepAt ? `${Math.max(1, Math.ceil((s.sleepAt - Date.now()) / 60000))} min` : '';

  return (
    <div class={`now-playing${closing ? ' closing' : ''}`} ref={ref}>
      <div class="np-inner">
        <button class="np-close" onClick={close} aria-label="Zavřít">
          <ChevronDownIcon size={28} />
        </button>
        <div class="np-art">
          <Artwork src={ep.artworkUrl || pod?.artworkUrl} size={0} class="fluid" />
        </div>
        <div class="np-info">
          <div class="np-title">{ep.title}</div>
          <button
            class="np-podcast"
            onClick={() => {
              close();
              if (pod) go(`/podcast/${pod.id}`);
            }}
          >
            {pod?.title}
          </button>
        </div>

        <div class="np-scrubber">
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.floor(dur))}
            step={1}
            value={Math.floor(pos)}
            onInput={(e) => setScrub(Number((e.target as HTMLInputElement).value))}
            onChange={(e) => {
              seekTo(Number((e.target as HTMLInputElement).value));
              setScrub(null);
            }}
            class={scrub !== null ? 'scrubbing' : ''}
            style={{ '--pct': `${dur ? (pos / dur) * 100 : 0}%` }}
          />
          <div class="np-times">
            <span>{formatClock(pos)}</span>
            <span>{dur ? `-${formatClock(dur - pos)}` : '--:--'}</span>
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
          <button class="pill-btn" onClick={nextRate}>
            {s.settings.rate}×
          </button>
          <button
            class="pill-btn"
            onClick={() => {
              close();
              go(`/episode/${ep.id}`);
            }}
          >
            Poznámky
          </button>
          <button class={`pill-btn${sleepLabel ? ' on' : ''}`} onClick={sleepMenu}>
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
  const [scrub, setScrub] = useState<number | null>(null);
  const ep = s.currentId ? s.episodes.get(s.currentId) : null;
  if (!ep) return null;
  const pod = getPodcast(ep.podcastId);
  const dur = s.duration || ep.duration || 0;
  const pos = scrub ?? s.position;
  const nextRate = () => {
    const i = RATES.indexOf(s.settings.rate);
    setRate(RATES[(i + 1) % RATES.length] ?? 1);
  };
  const sleepMenu = () =>
    showActions('Časovač vypnutí', [
      ...[5, 15, 30, 45, 60].map((m) => ({ label: `${m} minut`, onClick: () => setSleepTimer(m) })),
      { label: 'Na konci epizody', onClick: () => setSleepTimer('end') },
      ...(s.sleepAt || s.sleepAtEnd ? [{ label: 'Vypnout časovač', destructive: true, onClick: () => setSleepTimer(null) }] : []),
    ]);
  const sleepOn = !!(s.sleepAt || s.sleepAtEnd);

  return (
    <div class="desk-player">
      <div class="dp-info">
        <button class="dp-art" onClick={() => set({ nowPlayingOpen: true })} aria-label="Otevřít přehrávač">
          <Artwork src={ep.artworkUrl || pod?.artworkUrl} size={56} />
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
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.floor(dur))}
            step={1}
            value={Math.floor(pos)}
            onInput={(e) => setScrub(Number((e.target as HTMLInputElement).value))}
            onChange={(e) => {
              seekTo(Number((e.target as HTMLInputElement).value));
              setScrub(null);
            }}
            class={scrub !== null ? 'scrubbing' : ''}
            style={{ '--pct': `${dur ? (pos / dur) * 100 : 0}%` }}
            aria-label="Pozice v epizodě"
          />
          <span>{dur ? `-${formatClock(dur - pos)}` : '--:--'}</span>
        </div>
      </div>

      <div class="dp-extras">
        <button class="pill-btn" onClick={nextRate} title="Rychlost přehrávání">
          {s.settings.rate}×
        </button>
        <button class={`pill-btn${sleepOn ? ' on' : ''}`} onClick={sleepMenu} title="Časovač vypnutí">
          <MoonIcon size={14} />
        </button>
        <button class="icon-btn" onClick={() => set({ nowPlayingOpen: true })} title="Celá obrazovka" aria-label="Otevřít přehrávač">
          <ChevronDownIcon size={22} style={{ transform: 'rotate(180deg)' }} />
        </button>
      </div>
    </div>
  );
}
