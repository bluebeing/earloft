import { kvEntries, writeKv } from './library';

/**
 * Evidence poslechu. Každé zařízení zapisuje jen do vlastních klíčů
 * `stats-<zařízení>-<RRRRMM>`, takže se souběžné zápisy z více zařízení nepřepisují.
 * Hodnota: { "DD": { podcastId: [sekundy obsahu, sekundy reálného času] } }
 */
type MonthData = Record<string, Record<string, [number, number]>>;

const DEVICE_KEY = 'podcasty.device';

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'nodevice';
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const monthKey = (d: Date) => `stats-${deviceId()}-${d.getFullYear()}${pad(d.getMonth() + 1)}`;

let pending = new Map<string, MonthData>();
let lastFlush = Date.now();

/** Přičte odposlouchaný čas (volá přehrávač průběžně). */
export function recordListening(podcastId: string, contentSec: number, wallSec: number) {
  if (!podcastId || !(contentSec > 0)) return;
  const now = new Date();
  const key = monthKey(now);
  let month = pending.get(key);
  if (!month) {
    const saved = kvEntries(key).find((r) => r.key === key)?.value as MonthData | undefined;
    month = structuredClone(saved ?? {});
    pending.set(key, month);
  }
  const day = (month[pad(now.getDate())] ??= {});
  const cur = (day[podcastId] ??= [0, 0]);
  cur[0] = Math.round((cur[0] + contentSec) * 10) / 10;
  cur[1] = Math.round((cur[1] + wallSec) * 10) / 10;
  if (Date.now() - lastFlush > 30000) flushStats();
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
