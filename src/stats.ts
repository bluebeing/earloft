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
const roundTenth = (n: number) => Math.round(n * 10) / 10;

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
  totals[0] = roundTenth(totals[0] + contentSec);
  totals[1] = roundTenth(totals[1] + wallSec);
  if (Date.now() - lastFlush > FLUSH_INTERVAL_MS) flushStats();
}

export function flushStats() {
  lastFlush = Date.now();
  for (const [key, value] of pending) void writeKv(key, value);
  pending = new Map();
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
