import { showActions } from './ui/common';
import { audioElement } from './player';
import { readLocal, writeLocal } from './storage';
import { set, toast } from './store';

/**
 * Výběr zvukového výstupu – podle toho, co prohlížeč umí:
 * - Safari (iPhone, iPad, Mac): systémový AirPlay výběr. Na iPhonu nabídne i AirPods
 *   a další Bluetooth sluchátka, Apple TV a AirPlay reproduktory.
 * - Chrome/Edge na počítači: výstupní zařízení přes setSinkId (sluchátka, reproduktory…).
 * - Chrome na Androidu: Remote Playback API (Chromecast).
 */
export type OutputKind = 'airplay' | 'sink' | 'remote' | null;

type WebKitAudio = HTMLAudioElement & {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
};
type SinkAudio = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void>; sinkId?: string };

const SINK_KEY = 'podcasty.audioSink';

export function outputKind(): OutputKind {
  const audio = audioElement() as WebKitAudio & SinkAudio;
  if (typeof audio.webkitShowPlaybackTargetPicker === 'function') return 'airplay';
  if (typeof audio.setSinkId === 'function' && !!navigator.mediaDevices) return 'sink';
  if (audio.remote && /Android/.test(navigator.userAgent)) return 'remote';
  return null;
}

/** Otevře výběr výstupu (AirPlay / Chromecast / seznam zvukových zařízení). */
export async function chooseOutput() {
  const audio = audioElement() as WebKitAudio & SinkAudio;
  switch (outputKind()) {
    case 'airplay':
      audio.webkitShowPlaybackTargetPicker!();
      return;
    case 'remote':
      try {
        await audio.remote.prompt();
      } catch {
        /* zrušeno nebo nic k dispozici */
      }
      return;
    case 'sink':
      return chooseSink(audio);
  }
}

async function chooseSink(audio: SinkAudio) {
  let outputs = await audioOutputs();
  // Bez oprávnění prohlížeč názvy zařízení neprozradí – požádáme o něj jen jednou, na přání
  if (outputs.length > 1 && outputs.every((d) => !d.label)) {
    const ok = confirm('Prohlížeč ukáže názvy zvukových zařízení jen s oprávněním k mikrofonu. Nic se nenahrává – oprávnění se použije jen pro načtení seznamu. Pokračovat?');
    if (!ok) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      toast('Bez oprávnění nejde seznam zařízení zobrazit');
      return;
    }
    outputs = await audioOutputs();
  }
  if (outputs.length <= 1) {
    toast('Jiné zvukové výstupy nejsou k dispozici');
    return;
  }
  const current = audio.sinkId || 'default';
  showActions(
    'Kam pustit zvuk',
    outputs.map((d) => ({
      label: `${d.deviceId === current || (current === '' && d.deviceId === 'default') ? '✓ ' : ''}${d.label || 'Zvukové zařízení'}`,
      onClick: () => void applySink(audio, d.deviceId, d.label),
    })),
  );
}

async function audioOutputs(): Promise<MediaDeviceInfo[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  // „communications“ je na Windows duplikát výchozího zařízení
  return all.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'communications');
}

async function applySink(audio: SinkAudio, deviceId: string, label: string) {
  try {
    await audio.setSinkId!(deviceId);
    writeLocal(SINK_KEY, deviceId === 'default' ? null : deviceId);
    set({ outputActive: deviceId !== 'default' });
    toast(`Zvuk jde do: ${label || 'vybrané zařízení'}`);
  } catch {
    toast('Výstup se nepodařilo přepnout');
  }
}

/** Při startu: obnovit naposledy zvolený výstup a sledovat AirPlay. */
export function initOutput() {
  const audio = audioElement() as WebKitAudio & SinkAudio;
  const saved = readLocal(SINK_KEY);
  if (saved && typeof audio.setSinkId === 'function') {
    // Zařízení mezitím nemusí být připojené – pak zůstane výchozí výstup
    audio.setSinkId(saved).then(
      () => set({ outputActive: true }),
      () => writeLocal(SINK_KEY, null),
    );
  }
  audio.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', () => {
    set({ outputActive: !!audio.webkitCurrentPlaybackTargetIsWireless });
  });
}
