import { randomId } from './util';

/**
 * Bezpečný přístup k localStorage – v privátním režimu nebo se zablokovaným úložištěm
 * prohlížeč hází výjimky; appka pak funguje dál, jen si nic nepamatuje.
 */

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Uloží hodnotu; prázdná hodnota (null / '') klíč smaže. */
export function writeLocal(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* úložiště nedostupné */
  }
}

const DEVICE_KEY = 'podcasty.device';

/**
 * Trvalé ID tohoto zařízení. Data, která zapisuje více zařízení zároveň (statistiky, záložky),
 * se ukládají pod klíči s tímto ID, aby se souběžné zápisy nepřepisovaly.
 */
export function deviceId(): string {
  let id = readLocal(DEVICE_KEY);
  if (!id) {
    id = randomId();
    writeLocal(DEVICE_KEY, id);
  }
  return id;
}
