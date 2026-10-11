import { useEffect, useReducer, useState } from 'preact/hooks';
import { playAt } from '../player';
import { HEARTBEAT_MS, estimatedPosition, remotePresence, requestPause } from '../presence';
import { toast, useStore } from '../store';
import { formatClock } from '../util';
import { Artwork } from './common';

/** Lišta „Přehrává se na jiném zařízení“ nad přehrávačem. */
export function RemotePlaying() {
  const s = useStore();
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [busy, setBusy] = useState(false);
  const presence = remotePresence();

  // Čas na vzdáleném zařízení běží dál – překreslit každou sekundu
  useEffect(() => {
    if (!presence) return;
    const t = window.setInterval(rerender, 1000);
    return () => clearInterval(t);
  }, [!!presence]);

  // Když hraje toto zařízení, lišta by jen mátla
  if (!presence || s.playing) return null;

  const pos = estimatedPosition(presence);
  const pct = presence.duration ? Math.min(100, (pos / presence.duration) * 100) : 0;
  const canTakeOver = s.episodes.has(presence.episodeId);

  const takeOver = async () => {
    setBusy(true);
    try {
      await requestPause(presence.deviceId);
      await playAt(presence.episodeId, pos);
      toast(`Hraje tady. ${presence.deviceName} se pozastaví do ${HEARTBEAT_MS / 1000} s.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="remote-bar">
      <div class="remote-progress" style={{ width: `${pct}%` }} />
      <Artwork src={presence.artworkUrl} size={40} />
      <div class="remote-text">
        <div class="remote-device">
          <span class="remote-dot" /> Přehrává se na zařízení {presence.deviceName}
        </div>
        <div class="remote-title">
          {presence.episodeTitle}
          <span class="remote-time">
            {' '}
            · {formatClock(pos)}
            {presence.duration ? ` / ${formatClock(presence.duration)}` : ''}
          </span>
        </div>
      </div>
      {canTakeOver && (
        <button class="pill-btn remote-take" disabled={busy} onClick={() => void takeOver()} title="Pustit tady od stejného místa a pozastavit na druhém zařízení">
          Převzít
        </button>
      )}
    </div>
  );
}
