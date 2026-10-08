import { useRef, useState } from 'preact/hooks';
import { activePodcasts, getPodcast, inCategory, isDone } from '../library';
import { allRecords, dayKey, type ListenRecord } from '../stats';
import { readLocal, writeLocal } from '../storage';
import { useStore } from '../store';
import type { Episode } from '../types';
import { CategoryChips, useCategoryFilter } from './categories';
import { BookmarksView } from './extras';
import { Artwork, EpisodeRow, Header } from './common';
import { BackIcon } from './icons';

const VIEW_KEY = 'podcasty.overview';
type View = 'calendar' | 'stats' | 'bookmarks';

const savedView = (): View => {
  const v = readLocal(VIEW_KEY);
  return v === 'stats' || v === 'bookmarks' ? v : 'calendar';
};

export function Overview() {
  const [view, setView] = useState<View>(savedView);
  const choose = (v: View) => {
    setView(v);
    writeLocal(VIEW_KEY, v);
  };
  return (
    <div class="screen">
      <Header title="Přehled" large />
      <div class="segmented top">
        <button class={view === 'calendar' ? 'on' : ''} onClick={() => choose('calendar')}>
          Kalendář
        </button>
        <button class={view === 'stats' ? 'on' : ''} onClick={() => choose('stats')}>
          Statistiky
        </button>
        <button class={view === 'bookmarks' ? 'on' : ''} onClick={() => choose('bookmarks')}>
          Záložky
        </button>
      </div>
      <div class="fade-swap" key={view}>
        {view === 'calendar' ? <Calendar /> : view === 'stats' ? <Stats /> : <BookmarksView />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kalendář vydaných epizod

const monthFmt = new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' });
const dayTitleFmt = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });
const WEEKDAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
const SWIPE_MIN_DISTANCE = 50;
const MAX_DAY_ARTWORKS = 3;

const firstOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

/** Epizody podcastů z kategorie vydané v daném měsíci, podle dne (klíč `dayKey`). */
function episodesByDay(month: Date, categoryId: string | null, byPodcast: Map<string, Episode[]>): Map<string, Episode[]> {
  const result = new Map<string, Episode[]>();
  const from = month.getTime();
  const to = new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime();
  for (const p of activePodcasts()) {
    if (!inCategory(p.id, categoryId)) continue;
    for (const e of byPodcast.get(p.id) ?? []) {
      if (e.pubDate >= to) continue;
      if (e.pubDate < from) break; // seřazeno od nejnovější
      const key = dayKey(new Date(e.pubDate));
      const list = result.get(key);
      if (list) list.push(e);
      else result.set(key, [e]);
    }
  }
  return result;
}

/** Buňky měsíční mřížky po týdnech od pondělí; null = prázdné místo před/za měsícem. */
function monthGrid(month: Date): (Date | null)[] {
  const leading = (month.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = Array(leading).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  while (cells.length % 7) cells.push(null);
  return cells;
}

const parseDayKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

function Calendar() {
  const s = useStore();
  const [cat, setCat] = useCategoryFilter('calendar');
  const today = new Date();
  const [month, setMonth] = useState(() => firstOfMonth(today));
  const [selected, setSelected] = useState(() => dayKey(today));
  const [slide, setSlide] = useState<'next' | 'prev' | ''>('');
  const touch = useRef<{ x: number; y: number } | null>(null);

  const byDay = episodesByDay(month, cat, s.byPodcast);

  const shift = (delta: number) => {
    setSlide(delta > 0 ? 'next' : 'prev');
    const m = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    setMonth(m);
    setSelected(dayKey(sameMonth(m, today) ? today : m));
  };
  const goToday = () => {
    setSlide('');
    setMonth(firstOfMonth(today));
    setSelected(dayKey(today));
  };
  const onSwipeEnd = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    const horizontal = Math.abs(dx) > Math.abs(dy) * 1.5;
    if (Math.abs(dx) > SWIPE_MIN_DISTANCE && horizontal) shift(dx < 0 ? 1 : -1);
  };

  const todayKey = dayKey(today);
  const selectedEps = (byDay.get(selected) ?? []).slice().sort((a, b) => b.pubDate - a.pubDate);
  const monthCount = [...byDay.values()].reduce((n, l) => n + l.length, 0);

  return (
    <>
      <CategoryChips value={cat} onChange={setCat} />
      <div class="cal-layout">
        <div class="cal-main">
          <div class="cal-head">
            <button class="icon-btn" onClick={() => shift(-1)} aria-label="Předchozí měsíc">
              <BackIcon size={20} />
            </button>
            <div class="cal-title">
              <span>{monthFmt.format(month)}</span>
              <small>{monthCount ? `${monthCount} epizod` : 'nic nevyšlo'}</small>
            </div>
            <button class="icon-btn flip" onClick={() => shift(1)} aria-label="Další měsíc">
              <BackIcon size={20} />
            </button>
          </div>
          <button class="link-btn cal-today" onClick={goToday}>
            Dnes
          </button>
          <div class="cal-weekdays">
            {WEEKDAYS.map((d) => (
              <span>{d}</span>
            ))}
          </div>
          <div
            class={`cal-grid ${slide}`}
            key={month.getTime()}
            onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
            onTouchEnd={onSwipeEnd}
          >
            {monthGrid(month).map((d) => {
              if (!d) return <span class="cal-cell empty" />;
              const key = dayKey(d);
              return (
                <CalendarDay date={d} episodes={byDay.get(key) ?? []} today={key === todayKey} selected={key === selected} onSelect={() => setSelected(key)} />
              );
            })}
          </div>
        </div>
        <div class="cal-side">
          <h2 class="section-title cal-day-title">{dayTitleFmt.format(parseDayKey(selected))}</h2>
          {selectedEps.length ? (
            <div class="list fade-swap" key={selected}>
              {selectedEps.map((ep) => (
                <EpisodeRow ep={ep} showPodcast />
              ))}
            </div>
          ) : (
            <p class="muted cal-none">Tento den nic nevyšlo.</p>
          )}
        </div>
      </div>
    </>
  );
}

interface CalendarDayProps {
  date: Date;
  episodes: Episode[];
  today: boolean;
  selected: boolean;
  onSelect: () => void;
}

function CalendarDay({ date, episodes, today, selected, onSelect }: CalendarDayProps) {
  const podcastIds = [...new Set(episodes.map((e) => e.podcastId))];
  return (
    <button
      class={`cal-cell${today ? ' today' : ''}${selected ? ' selected' : ''}${episodes.length ? ' has' : ''}`}
      onClick={onSelect}
      aria-label={`${date.getDate()}. – ${episodes.length} epizod`}
    >
      <span class="cal-num">{date.getDate()}</span>
      <span class="cal-arts">
        {podcastIds.slice(0, MAX_DAY_ARTWORKS).map((id) => (
          <Artwork src={getPodcast(id)?.artworkUrl} size={16} />
        ))}
        {podcastIds.length > MAX_DAY_ARTWORKS && <span class="cal-more">+{podcastIds.length - MAX_DAY_ARTWORKS}</span>}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Statistiky

type Period = 'week' | 'month' | 'year' | 'all';
const PERIODS: { id: Period; label: string }[] = [
  { id: 'week', label: '7 dní' },
  { id: 'month', label: '30 dní' },
  { id: 'year', label: 'Rok' },
  { id: 'all', label: 'Celkem' },
];

const DAY_MS = 86400000;
/** Den se do série počítá od minuty poslechu */
const STREAK_MIN_SECONDS = 60;
const TOP_PODCASTS = 8;

const shortDay = new Intl.DateTimeFormat('cs-CZ', { weekday: 'short' });
const dayMonth = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric' });
const monthShort = new Intl.DateTimeFormat('cs-CZ', { month: 'short' });
const monthLong = new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' });

/** 3725 s → "1 h 2 min"; nenulový čas pod minutu → "<1 min" */
function formatListenTime(sec: number): string {
  const total = Math.round(sec / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h >= 100) return `${h} h`;
  if (h) return m ? `${h} h ${m} min` : `${h} h`;
  return sec > 0 && m === 0 ? '<1 min' : `${m} min`;
}

interface Bucket {
  label: string;
  title: string;
  value: number;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Rok a celkem se zobrazují po měsících, kratší období po dnech. */
const isMonthly = (period: Period) => period === 'year' || period === 'all';
const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;

function periodStart(period: Period, records: ListenRecord[], today: Date): Date {
  if (period === 'week') return addDays(today, -6);
  if (period === 'month') return addDays(today, -29);
  if (period === 'year') return new Date(today.getFullYear(), today.getMonth() - 11, 1);
  return firstOfMonth(records.reduce((min, r) => (r.date < min ? r.date : min), today));
}

/** Sloupce grafu: po dnech (7/30 dní) nebo po měsících (rok, celkem). */
function buildBuckets(period: Period, from: Date, today: Date, records: ListenRecord[]): Bucket[] {
  const buckets: Bucket[] = [];
  const index = new Map<string, number>();
  const keyOf = isMonthly(period) ? monthKey : dayKey;
  const add = (d: Date, label: string, title: string) => {
    index.set(keyOf(d), buckets.length);
    buckets.push({ label, title, value: 0 });
  };

  if (isMonthly(period)) {
    for (let d = new Date(from); d <= today; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      add(d, monthShort.format(d).replace('.', ''), monthLong.format(d));
    }
  } else {
    for (let d = new Date(from); d <= today; d = addDays(d, 1)) {
      // U 30 dní by se popisky překrývaly – jen každý pátý den
      const label = period === 'week' ? shortDay.format(d) : d.getDate() % 5 === 0 ? String(d.getDate()) : '';
      add(d, label, `${shortDay.format(d)} ${dayMonth.format(d)}`);
    }
  }
  for (const r of records) {
    const i = index.get(keyOf(r.date));
    if (i !== undefined) buckets[i].value += r.content;
  }
  return buckets;
}

/** Počet po sobě jdoucích dnů s poslechem. Dnešek se ještě může doposlouchat – když dnes nic, počítá se od včerejška. */
function listeningStreak(records: ListenRecord[], today: Date): number {
  const perDay = new Map<string, number>();
  for (const r of records) perDay.set(dayKey(r.date), (perDay.get(dayKey(r.date)) ?? 0) + r.content);
  const listened = (d: Date) => (perDay.get(dayKey(d)) ?? 0) >= STREAK_MIN_SECONDS;
  let streak = 0;
  for (let d = listened(today) ? today : addDays(today, -1); listened(d); d = addDays(d, -1)) streak++;
  return streak;
}

function topPodcasts(records: ListenRecord[]): [string, number][] {
  const totals = new Map<string, number>();
  for (const r of records) totals.set(r.podcastId, (totals.get(r.podcastId) ?? 0) + r.content);
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_PODCASTS);
}

const sumOf = (records: ListenRecord[], field: 'content' | 'wall') => records.reduce((n, r) => n + r[field], 0);

function Stats() {
  const s = useStore();
  const [period, setPeriod] = useState<Period>('week');
  const [hover, setHover] = useState<number | null>(null);

  const records = allRecords();
  const today = startOfDay(new Date());
  const from = periodStart(period, records, today);
  const inRange = records.filter((r) => r.date >= from);
  const buckets = buildBuckets(period, from, today, inRange);

  const total = sumOf(inRange, 'content');
  const days = Math.max(1, Math.round((today.getTime() - from.getTime()) / DAY_MS) + 1);
  const average = total / (isMonthly(period) ? Math.max(1, buckets.length) : days);
  const finished = [...s.states.values()].filter((st) => st.played && st.updatedAt >= from.getTime()).length;
  const unplayed = activePodcasts().reduce((n, p) => n + (s.byPodcast.get(p.id) ?? []).filter((e) => !isDone(e.id)).length, 0);
  const top = topPodcasts(inRange);
  const topMax = top[0]?.[1] ?? 1;
  const max = Math.max(...buckets.map((b) => b.value), 1);
  const shown = hover !== null ? buckets[hover] : null;

  return (
    <>
      <div class="chips">
        {PERIODS.map((p) => (
          <button
            class={`chip${period === p.id ? ' on' : ''}`}
            onClick={() => {
              setPeriod(p.id);
              setHover(null);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div class="stat-hero">
        <div class="stat-hero-label">Odposloucháno</div>
        <div class="stat-hero-value">{formatListenTime(total)}</div>
      </div>

      <div class="chart-card">
        <div class="chart-readout">
          {shown ? (
            <>
              <strong>{formatListenTime(shown.value)}</strong> <span class="muted">{shown.title}</span>
            </>
          ) : (
            <span class="muted">
              Ø {formatListenTime(average)} {isMonthly(period) ? 'měsíčně' : 'denně'}
            </span>
          )}
        </div>
        <div class={`bars n${Math.min(buckets.length, 31)}`} onPointerLeave={() => setHover(null)} key={period}>
          {buckets.map((b, i) => (
            <div
              class={`bar-col${hover === i ? ' hover' : ''}`}
              onPointerEnter={() => setHover(i)}
              onClick={() => setHover(hover === i ? null : i)}
              title={`${b.title}: ${formatListenTime(b.value)}`}
            >
              <div class="bar-track">
                <div class="bar" style={{ height: `${b.value ? Math.max(2, (b.value / max) * 100) : 0}%`, animationDelay: `${i * 12}ms` }} />
              </div>
              <span class="bar-label">{b.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div class="stat-tiles">
        <StatTile label="Dokončené epizody" value={finished} />
        <StatTile label="Ušetřeno rychlostí" value={formatListenTime(Math.max(0, total - sumOf(inRange, 'wall')))} />
        <StatTile label="Série dní" value={listeningStreak(records, today)} />
        <StatTile label="Nepřehrané v knihovně" value={unplayed} />
      </div>

      <h2 class="section-title">Nejposlouchanější</h2>
      {top.length === 0 ? (
        <p class="muted">Zatím žádný poslech v tomto období. Statistiky se počítají od aktualizace appky.</p>
      ) : (
        <div class="list top-list">
          {top.map(([podcastId, seconds]) => (
            <TopPodcastRow podcastId={podcastId} seconds={seconds} share={seconds / topMax} />
          ))}
        </div>
      )}
      <p class="hint">Poslech se počítá jen při skutečném přehrávání (přeskakování se nezapočítává) a sčítá se ze všech tvých zařízení.</p>
    </>
  );
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div class="stat-tile">
      <span class="stat-label">{label}</span>
      <span class="stat-value">{value}</span>
    </div>
  );
}

function TopPodcastRow({ podcastId, seconds, share }: { podcastId: string; seconds: number; share: number }) {
  const p = getPodcast(podcastId);
  return (
    <a class="top-row" href={`#/podcast/${podcastId}`}>
      <Artwork src={p?.artworkUrl} size={44} />
      <div class="top-body">
        <div class="top-line">
          <span class="top-title">{p?.title ?? 'Odebraný podcast'}</span>
          <span class="top-value">{formatListenTime(seconds)}</span>
        </div>
        <div class="top-track">
          <div class="top-bar" style={{ width: `${share * 100}%` }} />
        </div>
      </div>
    </a>
  );
}
