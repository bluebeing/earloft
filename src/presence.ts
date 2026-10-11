import { api } from './api';
import { kvEntries, readKv, storeKv, writeKv } from './kv';
import { deviceId, readLocal, writeLocal } from './storage';
import { push } from './sync';

/**
 * „Co hraje kde“: zařízení, které přehrává, posílá každých pár sekund svůj stav
 * do kv `presence-<zařízení>`. Ostatní otevřená zařízení ho při synchronizaci uvidí
 * a ukážou, že se přehrává jinde. Pokyn k pauze jde přes kv `command-<cílové zařízení>`.
 */
export interface Presence {
  deviceId: string;
  deviceName: string;
  episodeId: string;
  podcastId: string;
  episodeTitle: string;
  podcastTitle: string;
  artworkUrl: string | null;
  position: number;
  duration: number;
  rate: number;
  playing: boolean;
  updatedAt: number;
}

export type PresenceSnapshot = Omit<Presence, 'deviceId' | 'deviceName' | 'updatedAt'>;

const PRESENCE_PREFIX = 'presence-';
const COMMAND_PREFIX = 'command-';
/** Jak často hrající zařízení hlásí stav */
export const HEARTBEAT_MS = 15000;
/** Starší stav už neplatí (zařízení zmizelo, uspalo se, ztratilo signál) */
const STALE_MS = 3 * HEARTBEAT_MS + 5000;
/** Pokyn k pauze starší než tohle se ignoruje */
const COMMAND_TTL_MS = 2 * 60000;

const DEVICE_NAME_KEY = 'podcasty.deviceName';
const HANDLED_COMMAND_KEY = 'podcasty.handledCommand';

/** Název zařízení: vlastní z nastavení, jinak odhad z prohlížeče. */
export function deviceName(): string {
  const custom = readLocal(DEVICE_NAME_KEY)?.trim();
  if (custom) return custom;
  const ua = navigator.userAgent;
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || touchMac) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'prohlížeč';
  const os = /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Počítač';
  return `${os} · ${browser}`;
}

export const setDeviceName = (name: string) => writeLocal(DEVICE_NAME_KEY, name.trim() || null);

let lastPublished = 0;
let lastPlaying = false;

/**
 * Pošle stav přehrávání na server (nejvýš jednou za HEARTBEAT_MS, změna play/pauza hned).
 * Jde přímo na API – nepíše do IndexedDB ani nečeká na dávkové odeslání.
 * Vrací true, pokud se stav opravdu odeslal.
 */
export function publishPresence(snapshot: PresenceSnapshot, force = false): boolean {
  const now = Date.now();
  if (!force && snapshot.playing === lastPlaying && now - lastPublished < HEARTBEAT_MS) return false;
  lastPublished = now;
  lastPlaying = snapshot.playing;
  const key = PRESENCE_PREFIX + deviceId();
  const value: Presence = { ...snapshot, deviceId: deviceId(), deviceName: deviceName(), updatedAt: now };
  storeKv({ key, value, updatedAt: now });
  void api(`/api/kv/${key}`, { method: 'PUT', body: JSON.stringify({ value, updatedAt: now }), keepalive: true }).catch(() => {});
  return true;
}

/** Přehrávání na jiném zařízení (nejčerstvější), nebo null. */
export function remotePresence(): Presence | null {
  const own = PRESENCE_PREFIX + deviceId();
  const now = Date.now();
  const active = kvEntries(PRESENCE_PREFIX)
    .filter((r) => r.key !== own)
    .map((r) => r.value as Presence)
    .filter((p) => p?.playing && now - p.updatedAt < STALE_MS);
  return active.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}

/** Odhad aktuální pozice na vzdáleném zařízení (od posledního hlášení hraje dál). */
export function estimatedPosition(p: Presence): number {
  const elapsed = Math.max(0, (Date.now() - p.updatedAt) / 1000) * (p.rate || 1);
  return Math.min(p.duration || Infinity, p.position + elapsed);
}

/** Požádá jiné zařízení o pozastavení (provede ho při svém nejbližším hlášení stavu). */
export async function requestPause(targetDeviceId: string) {
  await writeKv(COMMAND_PREFIX + targetDeviceId, { action: 'pause', at: Date.now(), from: deviceName() });
  await push().catch(() => {});
}

/**
 * Je pro toto zařízení nový pokyn k pauze? Vrací název zařízení, které o ni požádalo.
 * `playingSince`: pokyn starší než aktuální spuštění přehrávání se ignoruje.
 */
export function takePauseCommand(playingSince: number): string | null {
  const cmd = readKv<{ action: string; at: number; from: string }>(COMMAND_PREFIX + deviceId());
  if (!cmd || cmd.action !== 'pause') return null;
  const handled = Number(readLocal(HANDLED_COMMAND_KEY) ?? 0);
  if (cmd.at <= handled || cmd.at < playingSince || Date.now() - cmd.at > COMMAND_TTL_MS) return null;
  writeLocal(HANDLED_COMMAND_KEY, String(cmd.at));
  return cmd.from || 'jiné zařízení';
}
