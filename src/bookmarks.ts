import { getPodcast, kvEntries, writeKv } from './library';
import { deviceId } from './stats';
import { emit, state, toast } from './store';
import { formatClock } from './util';

/**
 * Záložky v epizodách. Každé zařízení zapisuje do vlastního klíče `bookmarks-<zařízení>`,
 * takže se souběžná přidání z více zařízení nepřepisují.
 */
export interface Bookmark {
  id: string;
  episodeId: string;
  podcastId: string;
  time: number;
  note: string;
  createdAt: number;
  // Pro export i po zmizení epizody z feedu
  episodeTitle: string;
  podcastTitle: string;
}

const ownKey = () => `bookmarks-${deviceId()}`;

/** Všechny záložky ze všech zařízení, od nejnovější. */
export function allBookmarks(): (Bookmark & { key: string })[] {
  const out: (Bookmark & { key: string })[] = [];
  for (const rec of kvEntries('bookmarks-')) {
    if (Array.isArray(rec.value)) for (const b of rec.value as Bookmark[]) out.push({ ...b, key: rec.key });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

const listFor = (key: string) => (kvEntries(key).find((r) => r.key === key)?.value as Bookmark[] | undefined) ?? [];

async function saveList(key: string, list: Bookmark[]) {
  await writeKv(key, list);
  emit();
}

export async function addBookmark(episodeId: string, time: number): Promise<Bookmark | null> {
  const ep = state.episodes.get(episodeId);
  if (!ep) return null;
  const b: Bookmark = {
    id: Math.random().toString(36).slice(2, 10),
    episodeId,
    podcastId: ep.podcastId,
    time: Math.max(0, Math.round(time)),
    note: '',
    createdAt: Date.now(),
    episodeTitle: ep.title,
    podcastTitle: getPodcast(ep.podcastId)?.title ?? '',
  };
  const key = ownKey();
  await saveList(key, [...listFor(key), b]);
  toast(`Záložka v ${formatClock(b.time)} uložena`);
  return b;
}

export async function updateBookmarkNote(b: { id: string; key: string }, note: string) {
  await saveList(
    b.key,
    listFor(b.key).map((x) => (x.id === b.id ? { ...x, note } : x)),
  );
}

export async function deleteBookmark(b: { id: string; key: string }) {
  await saveList(
    b.key,
    listFor(b.key).filter((x) => x.id !== b.id),
  );
}

/** Export do Markdownu (Obsidian, Notion, Bear…), seskupeno podle epizod. */
export function bookmarksMarkdown(): string {
  const groups = new Map<string, (Bookmark & { key: string })[]>();
  for (const b of allBookmarks().sort((a, b) => a.time - b.time)) {
    const g = groups.get(b.episodeId);
    if (g) g.push(b);
    else groups.set(b.episodeId, [b]);
  }
  const lines = ['# Záložky z podcastů', ''];
  for (const list of groups.values()) {
    const first = list[0];
    const link = state.episodes.get(first.episodeId)?.link;
    lines.push(`## ${first.podcastTitle} – ${first.episodeTitle}`);
    if (link) lines.push(link);
    lines.push('');
    for (const b of list) lines.push(`- **${formatClock(b.time)}**${b.note ? ` – ${b.note}` : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}
