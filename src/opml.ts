import { activePodcasts, subscribe } from './library';
import { toast } from './store';
import { pool } from './util';

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function exportOpml(): string {
  const outlines = activePodcasts().map(
    (p) => `    <outline type="rss" text="${escapeXml(p.title)}" title="${escapeXml(p.title)}" xmlUrl="${escapeXml(p.feedUrl)}" />`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>Earloft</title></head>\n  <body>\n${outlines.join('\n')}\n  </body>\n</opml>\n`;
}

export async function importOpml(xml: string): Promise<{ added: number; failed: number }> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const urls = [...doc.querySelectorAll('outline[xmlUrl]')].map((o) => o.getAttribute('xmlUrl')!).filter(Boolean);
  let added = 0;
  let failed = 0;
  await pool(urls, 3, async (url) => {
    try {
      await subscribe(url);
      added++;
    } catch {
      failed++;
    }
  });
  toast(`Importováno ${added} podcastů${failed ? `, ${failed} se nepodařilo` : ''}`);
  return { added, failed };
}
