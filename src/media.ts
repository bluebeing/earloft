import { useEffect, useState } from 'preact/hooks';
import { api } from './api';
import { getEpisodeNotes } from './library';
import type { Episode } from './types';

// ---------------------------------------------------------------------------
// Kapitoly: <podcast:chapters> (JSON) nebo časové značky v poznámkách epizody

export interface Chapter {
  start: number;
  title: string;
  url?: string | null;
}

const chapterCache = new Map<string, Chapter[]>();
const chapterLoading = new Map<string, Promise<Chapter[]>>();

/** Cizí soubory (JSON kapitol, přepisy) jdou přes naši proxy kvůli CORS. */
const fetchText = async (url: string) => (await api(`/api/feed?url=${encodeURIComponent(url)}`)).text();

function parseChaptersJson(text: string): Chapter[] {
  const data = JSON.parse(text);
  return (data?.chapters ?? [])
    .filter((c: any) => c && c.toc !== false && typeof c.startTime === 'number')
    .map((c: any) => ({ start: c.startTime, title: String(c.title ?? '').trim() || 'Kapitola', url: c.url ?? null }));
}

const TIMESTAMP = String.raw`(?:(\d{1,2}):)?(\d{1,2}):(\d{2})`;
const LEADING = new RegExp(String.raw`^\s*[\(\[]?${TIMESTAMP}[\)\]]?\s*[-–—:|.)]?\s*(.{2,})$`);
const TRAILING = new RegExp(String.raw`^\s*(.{2,}?)\s*[-–—:|(\[]?\s*${TIMESTAMP}[\)\]]?\s*$`);
const toSeconds = (h?: string, m?: string, s?: string) => Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s);

/** „12:34 Název“ nebo „Název – 12:34“ po řádcích poznámek → kapitoly */
export function parseNoteChapters(html: string): Chapter[] {
  const withBreaks = html.replace(/<(br|\/p|\/li|\/div|\/h\d)[^>]*>/gi, '\n');
  const text = new DOMParser().parseFromString(withBreaks, 'text/html').body.textContent ?? '';
  const out: Chapter[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.length > 200) continue;
    let m = line.match(LEADING);
    if (m) {
      out.push({ start: toSeconds(m[1], m[2], m[3]), title: m[4].trim() });
      continue;
    }
    m = line.match(TRAILING);
    if (m) out.push({ start: toSeconds(m[2], m[3], m[4]), title: m[1].replace(/[-–—:|(\[]\s*$/, '').trim() });
  }
  // Musí to vypadat jako opravdové kapitoly: aspoň 2, vzestupně
  const sorted = out.filter((c, i) => i === 0 || c.start > out[i - 1].start);
  return sorted.length >= 2 && sorted.length === out.length ? sorted : [];
}

export function loadChapters(ep: Episode): Promise<Chapter[]> {
  const cached = chapterCache.get(ep.id);
  if (cached) return Promise.resolve(cached);
  let p = chapterLoading.get(ep.id);
  if (!p) {
    p = (async () => {
      let chapters: Chapter[] = [];
      if (ep.chaptersUrl) {
        try {
          chapters = parseChaptersJson(await fetchText(ep.chaptersUrl));
        } catch {
          /* zkusit poznámky */
        }
      }
      if (!chapters.length) {
        const notes = await getEpisodeNotes(ep.id);
        if (notes) chapters = parseNoteChapters(notes);
      }
      chapters.sort((a, b) => a.start - b.start);
      chapterCache.set(ep.id, chapters);
      return chapters;
    })().finally(() => chapterLoading.delete(ep.id));
    chapterLoading.set(ep.id, p);
  }
  return p;
}

export const cachedChapters = (episodeId: string) => chapterCache.get(episodeId) ?? null;

/** Index kapitoly, která hraje na pozici `pos` (-1 = před první) */
export function chapterIndexAt(chapters: Chapter[], pos: number): number {
  let idx = -1;
  for (let i = 0; i < chapters.length; i++) if (chapters[i].start <= pos + 0.5) idx = i;
  return idx;
}

export function useChapters(ep: Episode | null | undefined): Chapter[] {
  const [chapters, setChapters] = useState<Chapter[]>(() => (ep ? (cachedChapters(ep.id) ?? []) : []));
  useEffect(() => {
    if (!ep) return setChapters([]);
    let alive = true;
    setChapters(cachedChapters(ep.id) ?? []);
    void loadChapters(ep).then((c) => alive && setChapters(c));
    return () => void (alive = false);
  }, [ep?.id]);
  return chapters;
}

// ---------------------------------------------------------------------------
// Přepisy: <podcast:transcript> – WebVTT, SRT, JSON, HTML

export interface Cue {
  start: number; // -1 = bez časování
  end: number;
  text: string;
  speaker?: string;
}

const TYPE_ORDER = ['text/vtt', 'application/x-subrip', 'application/srt', 'application/json', 'text/html', 'text/plain'];

export const hasTranscript = (ep: Episode | null | undefined) => !!ep?.transcripts?.length;

function pickTranscript(ep: Episode) {
  const list = ep.transcripts ?? [];
  return [...list].sort((a, b) => {
    const ia = TYPE_ORDER.findIndex((t) => a.type.includes(t.split('/')[1]));
    const ib = TYPE_ORDER.findIndex((t) => b.type.includes(t.split('/')[1]));
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  })[0];
}

const vttTime = (t: string) => {
  const m = t.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000 : 0;
};

/** WebVTT i SRT (bloky oddělené prázdným řádkem, řádek s „-->“) */
function parseTimed(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    let body = lines.slice(ti + 1).join(' ').trim();
    let speaker: string | undefined;
    const v = body.match(/^<v\s+([^>]+)>/);
    if (v) speaker = v[1].trim();
    body = body.replace(/<[^>]+>/g, '').trim();
    if (body) cues.push({ start: vttTime(a), end: vttTime(b), text: body, speaker });
  }
  return cues;
}

function parseJsonTranscript(text: string): Cue[] {
  const data = JSON.parse(text);
  return (data?.segments ?? [])
    .filter((s: any) => s && typeof s.startTime === 'number' && s.body)
    .map((s: any) => ({ start: s.startTime, end: s.endTime ?? s.startTime, text: String(s.body).trim(), speaker: s.speaker }));
}

function parseHtmlTranscript(text: string): Cue[] {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  return [...doc.body.querySelectorAll('p, cite, time, div')]
    .map((el) => el.textContent?.trim() ?? '')
    .filter(Boolean)
    .map((t) => ({ start: -1, end: -1, text: t }));
}

/** Krátké titulky spojí do vět/odstavců, ať se to dobře čte. */
function mergeCues(cues: Cue[]): Cue[] {
  const out: Cue[] = [];
  for (const c of cues) {
    const last = out[out.length - 1];
    const sameSpeaker = last && last.speaker === c.speaker;
    if (last && sameSpeaker && last.start >= 0 && !/[.!?…]["“”']?$/.test(last.text) && last.text.length < 220) {
      last.text += ' ' + c.text;
      last.end = c.end;
    } else out.push({ ...c });
  }
  return out;
}

const transcriptCache = new Map<string, Promise<Cue[]>>();

export function loadTranscript(ep: Episode): Promise<Cue[]> {
  let p = transcriptCache.get(ep.id);
  if (!p) {
    const t = pickTranscript(ep);
    p = !t
      ? Promise.resolve([])
      : fetchText(t.url).then((text) => {
          const trimmed = text.trimStart();
          if (t.type.includes('json') || trimmed.startsWith('{')) return mergeCues(parseJsonTranscript(text));
          if (trimmed.startsWith('WEBVTT') || text.includes('-->')) return mergeCues(parseTimed(text));
          return parseHtmlTranscript(text);
        });
    p.catch(() => transcriptCache.delete(ep.id));
    transcriptCache.set(ep.id, p);
  }
  return p;
}
