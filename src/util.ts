/** Rychlý deterministický hash (cyrb53) → 14 hex znaků. Stejný na všech zařízeních. */
export function hashId(str: string): string {
  let h1 = 0xdeadbeef ^ 0,
    h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export const podcastIdFor = (feedUrl: string) => hashId(feedUrl.trim());
export const episodeIdFor = (podcastId: string, guid: string) => hashId(`${podcastId}|${guid}`);

/** 3725 → "1:02:05", 125 → "2:05" */
export function formatClock(sec: number): string {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 3725 → "1 h 2 min", 125 → "2 min" */
export function formatDuration(sec: number | null | undefined): string {
  if (!sec || sec < 1) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${Math.max(1, m)} min`;
}

const dayFmt = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric' });
const yearFmt = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
const weekdayFmt = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long' });

export function formatDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.floor((startOfToday - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (diffDays <= 0) return 'Dnes';
  if (diffDays === 1) return 'Včera';
  if (diffDays < 7) return weekdayFmt.format(d);
  if (d.getFullYear() === now.getFullYear()) return dayFmt.format(d);
  return yearFmt.format(d);
}

/** Převod HTML na prostý text bez načítání obrázků apod. */
export function htmlToText(html: string): string {
  if (!html) return '';
  if (!/[<&]/.test(html)) return html.trim();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      try {
        await fn(item);
      } catch (e) {
        console.warn(e);
      }
    }
  });
  await Promise.all(workers);
}

/** Jen http(s) odkazy – hodnoty z RSS jsou nedůvěryhodné (např. javascript: URL). */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Heuristika: vypadá URL feedu jako soukromá (obsahuje token)? */
export function looksPrivate(url: string): boolean {
  try {
    const u = new URL(url);
    if (/herohero|patreon|supercast|memberful|substack|forendors|glow\.fm|steadyhq|buzzsprout\.com\/.*private|private/i.test(u.href)) return true;
    for (const [k, v] of u.searchParams) if (/token|auth|key|secret|sig|hash/i.test(k) || v.length >= 20) return true;
    return u.pathname.split('/').some((seg) => /^[A-Za-z0-9_-]{24,}$/.test(seg));
  } catch {
    return false;
  }
}

/** Z odkazu podcasts.apple.com/.../id1234567 vytáhne ID. */
export function appleIdFromUrl(text: string): string | null {
  const m = text.match(/(?:podcasts|itunes)\.apple\.com\/.*?id(\d{5,})/i);
  return m ? m[1] : null;
}

/** Krátké náhodné ID (záložky, kategorie, zařízení). */
export const randomId = () => Math.random().toString(36).slice(2, 10);

/** Text chyby pro uživatele. */
export const errorMessage = (e: unknown, fallback?: string) => (e instanceof Error ? e.message : (fallback ?? String(e)));

/** Nabídne vygenerovaný text ke stažení jako soubor. */
export function downloadFile(filename: string, content: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
