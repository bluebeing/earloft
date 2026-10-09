import { kvEntries, readKv, writeKv } from './kv';
import { deviceId } from './storage';

/**
 * Evidence poslechu. Každé zařízení zapisuje jen do vlastních klíčů
 * `stats-<zařízení>-<RRRRMM>`, takže se souběžné zápisy z více zařízení nepřepisují.
 * Hodnota: { "DD": { podcastId: [sekundy obsahu, sekundy reálného času] } }
 */
type MonthData = Record<string, Record<string, [number, number]>>;

const pad = (n: number) => String(n).padStart(2, '0');
const monthKey = (d: Date) => `stats-${deviceId()}-${d.getFullYear()}${pad(d.getMonth() + 1)}`;

const FLUSH_INTERVAL_MS = 30000;
/** Zaokrouhluje se až při ukládání součtů – ne po krocích přehrávače (viz recordListening). */
const roundHundredth = (n: number) => Math.round(n * 100) / 100;

let pending = new Map<string, MonthData>();
let lastFlush = Date.now();

/** Přičte odposlouchaný čas (volá přehrávač průběžně). */
export function recordListening(podcastId: string, contentSec: number, wallSec: number) {
  if (!podcastId || !(contentSec > 0)) return;
  const now = new Date();
  const key = monthKey(now);
  let month = pending.get(key);
  if (!month) {
    month = structuredClone(readKv<MonthData>(key) ?? {});
    pending.set(key, month);
  }
  const day = (month[pad(now.getDate())] ??= {});
  const totals = (day[podcastId] ??= [0, 0]);
  // Žádné zaokrouhlování po krocích: přehrávač hlásí ~každých 0,25 s a zaokrouhlení
  // každého kroku na 0,1 s smazalo rozdíl obsah − reálný čas (ušetřeno rychlostí ≈ 0).
  totals[0] += contentSec;
  totals[1] += wallSec;
  if (Date.now() - lastFlush > FLUSH_INTERVAL_MS) flushStats();
}

export function flushStats() {
  lastFlush = Date.now();
  for (const [key, value] of pending) void writeKv(key, roundMonth(value));
  pending = new Map();
}

function roundMonth(month: MonthData): MonthData {
  const out: MonthData = {};
  for (const [dd, pods] of Object.entries(month)) {
    out[dd] = {};
    for (const [podcastId, [content, wall]] of Object.entries(pods)) out[dd][podcastId] = [roundHundredth(content), roundHundredth(wall)];
  }
  return out;
}

const REPAIR_FLAG = 'podcasty.statsWallRepair1';

/**
 * Jednorázová oprava záznamů z doby chyby se zaokrouhlováním: reálný čas byl skoro stejný
 * jako odposlouchaný obsah i při rychlejším přehrávání. Odhadne se jako obsah ÷ rychlost
 * podcastu (vlastní, jinak globální). Opravuje jen záznamy tohoto zařízení.
 */
export function repairWallTimes(rateFor: (podcastId: string) => number) {
  try {
    if (localStorage.getItem(REPAIR_FLAG)) return;
  } catch {
    return;
  }
  const prefix = `stats-${deviceId()}-`;
  for (const rec of kvEntries(prefix)) {
    const month = structuredClone(rec.value as MonthData);
    let changed = false;
    for (const pods of Object.values(month)) {
      for (const [podcastId, totals] of Object.entries(pods)) {
        const [content, wall] = totals;
        const rate = rateFor(podcastId);
        // Jen zjevně poškozené záznamy: rychlost > 1, ale „ušetřeno“ méně než 2 %
        if (rate > 1 && content > 0 && content - wall < content * 0.02) {
          pods[podcastId] = [content, roundHundredth(content / rate)];
          changed = true;
        }
      }
    }
    if (changed) void writeKv(rec.key, month);
  }
  try {
    localStorage.setItem(REPAIR_FLAG, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export interface ListenRecord {
  date: Date;
  podcastId: string;
  content: number;
  wall: number;
}

/** Všechny záznamy ze všech zařízení. */
export function allRecords(): ListenRecord[] {
  flushStats();
  const out: ListenRecord[] = [];
  for (const rec of kvEntries('stats-')) {
    const m = rec.key.match(/-(\d{4})(\d{2})$/);
    if (!m || !rec.value) continue;
    const year = Number(m[1]);
    const month = Number(m[2]) - 1;
    for (const [dd, pods] of Object.entries(rec.value as MonthData)) {
      for (const [podcastId, [content, wall]] of Object.entries(pods)) {
        out.push({ date: new Date(year, month, Number(dd)), podcastId, content, wall });
      }
    }
  }
  return out;
}

export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
