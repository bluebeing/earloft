import { useRef, useState } from 'preact/hooks';
import { activePodcasts, getPodcast, inCategory, isDone } from '../library';
import { allRecords, dayKey } from '../stats';
import { useStore } from '../store';
import type { Episode } from '../types';
import { CategoryChips, useCategoryFilter } from './categories';
import { Artwork, EpisodeRow, Header } from './common';
import { BackIcon } from './icons';

const VIEW_KEY = 'podcasty.overview';

export function Overview() {
  const [view, setView] = useState<'calendar' | 'stats'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'stats' ? 'stats' : 'calendar';
    } catch {
      return 'calendar';
    }
  });
  const choose = (v: 'calendar' | 'stats') => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
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
      </div>
      <div class="fade-swap" key={view}>
        {view === 'calendar' ? <Calendar /> : <Stats />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kalendář vydaných epizod

const monthFmt = new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' });
const dayTitleFmt = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });
const WEEKDAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];

function Calendar() {
  const s = useStore();
  const [cat, setCat] = useCategoryFilter('calendar');
  const today = new Date();
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(() => dayKey(today));
  const [slide, setSlide] = useState<'next' | 'prev' | ''>('');
  const touch = useRef<{ x: number; y: number } | null>(null);

  // Epizody viditelného měsíce podle dne
  const byDay = new Map<string, Episode[]>();
  const from = month.getTime();
  const to = new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime();
  for (const p of activePodcasts()) {
    if (!inCategory(p.id, cat)) continue;
    for (const e of s.byPodcast.get(p.id) ?? []) {
      if (e.pubDate >= to) continue;
      if (e.pubDate < from) break; // seřazeno od nejnovější
      const k = dayKey(new Date(e.pubDate));
      let list = byDay.get(k);
      if (!list) byDay.set(k, (list = []));
      list.push(e);
    }
  }

  const shift = (delta: number) => {
    setSlide(delta > 0 ? 'next' : 'prev');
    const m = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    setMonth(m);
    const isThisMonth = m.getFullYear() === today.getFullYear() && m.getMonth() === today.getMonth();
    setSelected(dayKey(isThisMonth ? today : m));
  };
  const goToday = () => {
    setSlide('');
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelected(dayKey(today));
  };

  // Mřížka: týden začíná pondělím
  const offset = (month.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array(offset).fill(null)];
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  while (cells.length % 7) cells.push(null);

  const todayKey = dayKey(today);
  const selectedEps = (byDay.get(selected) ?? []).slice().sort((a, b) => b.pubDate - a.pubDate);
  const [sy, sm, sd] = selected.split('-').map(Number);
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
        onTouchEnd={(e) => {
          const t = touch.current;
          touch.current = null;
          if (!t) return;
          const dx = e.changedTouches[0].clientX - t.x;
          const dy = e.changedTouches[0].clientY - t.y;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) shift(dx < 0 ? 1 : -1);
        }}
      >
        {cells.map((d) => {
          if (!d) return <span class="cal-cell empty" />;
          const k = dayKey(d);
          const eps = byDay.get(k) ?? [];
          const pods = [...new Set(eps.map((e) => e.podcastId))];
          return (
            <button
              class={`cal-cell${k === todayKey ? ' today' : ''}${k === selected ? ' selected' : ''}${eps.length ? ' has' : ''}`}
              onClick={() => setSelected(k)}
              aria-label={`${d.getDate()}. – ${eps.length} epizod`}
            >
              <span class="cal-num">{d.getDate()}</span>
              <span class="cal-arts">
                {pods.slice(0, 3).map((pid) => (
                  <Artwork src={getPodcast(pid)?.artworkUrl} size={16} />
                ))}
                {pods.length > 3 && <span class="cal-more">+{pods.length - 3}</span>}
              </span>
            </button>
          );
        })}
      </div>

        </div>
        <div class="cal-side">
      <h2 class="section-title cal-day-title">{dayTitleFmt.format(new Date(sy, sm - 1, sd))}</h2>
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

// ---------------------------------------------------------------------------
// Statistiky

type Period = 'week' | 'month' | 'year' | 'all';
const PERIODS: { id: Period; label: string }[] = [
  { id: 'week', label: '7 dní' },
  { id: 'month', label: '30 dní' },
  { id: 'year', label: 'Rok' },
  { id: 'all', label: 'Celkem' },
];

const shortDay = new Intl.DateTimeFormat('cs-CZ', { weekday: 'short' });
const dayMonth = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric' });
const monthShort = new Intl.DateTimeFormat('cs-CZ', { month: 'short' });
const monthLong = new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' });

/** 3725 s → "1 h 2 min"; pod minutu "0 min" */
function hm(sec: number): string {
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

function Stats() {
  const s = useStore();
  const [period, setPeriod] = useState<Period>('week');
  const [hover, setHover] = useState<number | null>(null);

  const records = allRecords();
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let from: Date;
  if (period === 'week') from = new Date(startOfToday.getTime() - 6 * 86400000);
  else if (period === 'month') from = new Date(startOfToday.getTime() - 29 * 86400000);
  else if (period === 'year') from = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  else {
    const first = records.reduce((min, r) => (r.date < min ? r.date : min), startOfToday);
    from = new Date(first.getFullYear(), first.getMonth(), 1);
  }
  const inRange = records.filter((r) => r.date >= from);

  // Sloupce: po dnech (7/30 dní) nebo po měsících
  const buckets: Bucket[] = [];
  const index = new Map<string, number>();
  if (period === 'week' || period === 'month') {
    for (let d = new Date(from); d <= startOfToday; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      index.set(dayKey(d), buckets.length);
      buckets.push({
        label: period === 'week' ? shortDay.format(d) : d.getDate() % 5 === 0 ? String(d.getDate()) : '',
        title: `${shortDay.format(d)} ${dayMonth.format(d)}`,
        value: 0,
      });
    }
    for (const r of inRange) {
      const i = index.get(dayKey(r.date));
      if (i !== undefined) buckets[i].value += r.content;
    }
  } else {
    for (let d = new Date(from); d <= now; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      index.set(`${d.getFullYear()}-${d.getMonth()}`, buckets.length);
      buckets.push({ label: monthShort.format(d).replace('.', ''), title: monthLong.format(d), value: 0 });
    }
    for (const r of inRange) {
      const i = index.get(`${r.date.getFullYear()}-${r.date.getMonth()}`);
      if (i !== undefined) buckets[i].value += r.content;
    }
  }

  const total = inRange.reduce((n, r) => n + r.content, 0);
  const wall = inRange.reduce((n, r) => n + r.wall, 0);
  const days = Math.max(1, Math.round((startOfToday.getTime() - from.getTime()) / 86400000) + 1);
  const finished = [...s.states.values()].filter((st) => st.played && st.updatedAt >= from.getTime()).length;

  // Série po sobě jdoucích dnů s poslechem (aspoň minuta)
  const perDay = new Map<string, number>();
  for (const r of records) perDay.set(dayKey(r.date), (perDay.get(dayKey(r.date)) ?? 0) + r.content);
  const prevDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  const listened = (d: Date) => (perDay.get(dayKey(d)) ?? 0) >= 60;
  let streak = 0;
  // Dnešek se ještě může doposlouchat – když dnes nic, počítá se od včerejška
  let d = listened(startOfToday) ? startOfToday : prevDay(startOfToday);
  while (listened(d)) {
    streak++;
    d = prevDay(d);
  }

  const byPodcast = new Map<string, number>();
  for (const r of inRange) byPodcast.set(r.podcastId, (byPodcast.get(r.podcastId) ?? 0) + r.content);
  const top = [...byPodcast.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topMax = top[0]?.[1] ?? 1;

  const max = Math.max(...buckets.map((b) => b.value), 1);
  const shown = hover !== null ? buckets[hover] : null;

  const pods = activePodcasts();
  const unplayed = pods.reduce((n, p) => n + (s.byPodcast.get(p.id) ?? []).filter((e) => !isDone(e.id)).length, 0);

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
        <div class="stat-hero-value">{hm(total)}</div>
      </div>

      <div class="chart-card">
        <div class="chart-readout">
          {shown ? (
            <>
              <strong>{hm(shown.value)}</strong> <span class="muted">{shown.title}</span>
            </>
          ) : (
            <span class="muted">Ø {hm(total / (period === 'year' || period === 'all' ? Math.max(1, buckets.length) : days))} {period === 'year' || period === 'all' ? 'měsíčně' : 'denně'}</span>
          )}
        </div>
        <div class={`bars n${Math.min(buckets.length, 31)}`} onPointerLeave={() => setHover(null)} key={period}>
          {buckets.map((b, i) => (
            <div
              class={`bar-col${hover === i ? ' hover' : ''}`}
              onPointerEnter={() => setHover(i)}
              onClick={() => setHover(hover === i ? null : i)}
              title={`${b.title}: ${hm(b.value)}`}
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
        <div class="stat-tile">
          <span class="stat-label">Dokončené epizody</span>
          <span class="stat-value">{finished}</span>
        </div>
        <div class="stat-tile">
          <span class="stat-label">Ušetřeno rychlostí</span>
          <span class="stat-value">{hm(Math.max(0, total - wall))}</span>
        </div>
        <div class="stat-tile">
          <span class="stat-label">Série dní</span>
          <span class="stat-value">{streak}</span>
        </div>
        <div class="stat-tile">
          <span class="stat-label">Nepřehrané v knihovně</span>
          <span class="stat-value">{unplayed}</span>
        </div>
      </div>

      <h2 class="section-title">Nejposlouchanější</h2>
      {top.length === 0 ? (
        <p class="muted">Zatím žádný poslech v tomto období. Statistiky se počítají od aktualizace appky.</p>
      ) : (
        <div class="list top-list">
          {top.map(([pid, sec]) => {
            const p = getPodcast(pid);
            return (
              <a class="top-row" href={`#/podcast/${pid}`}>
                <Artwork src={p?.artworkUrl} size={44} />
                <div class="top-body">
                  <div class="top-line">
                    <span class="top-title">{p?.title ?? 'Odebraný podcast'}</span>
                    <span class="top-value">{hm(sec)}</span>
                  </div>
                  <div class="top-track">
                    <div class="top-bar" style={{ width: `${(sec / topMax) * 100}%` }} />
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
      <p class="hint">Poslech se počítá jen při skutečném přehrávání (přeskakování se nezapočítává) a sčítá se ze všech tvých zařízení.</p>
    </>
  );
}
