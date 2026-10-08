import { useState } from 'preact/hooks';
import { api, getToken, setToken } from '../api';
import { activePodcasts, updateSettings } from '../library';
import { exportOpml, importOpml } from '../opml';
import { set, toast, useStore } from '../store';
import { resetLocal, sync } from '../sync';
import { downloadFile, errorMessage } from '../util';
import { Header, Spinner } from './common';

export function Settings() {
  const s = useStore();
  const [importing, setImporting] = useState(false);

  const download = () => downloadFile('podcasty.opml', exportOpml(), 'text/x-opml');

  const onFile = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      await importOpml(await file.text());
    } finally {
      setImporting(false);
      (e.target as HTMLInputElement).value = '';
    }
  };

  const logout = async () => {
    if (!confirm('Odhlásit toto zařízení? Lokální data se smažou, na serveru zůstanou.')) return;
    await resetLocal();
    setToken('');
    set({ authed: false });
  };

  return (
    <div class="screen">
      <Header title="Nastavení" large />

      <h2 class="section-title">Přehrávání</h2>
      <div class="form-group">
        <label class="form-row">
          <span>Skok zpět</span>
          <select value={s.settings.skipBack} onChange={(e) => void updateSettings({ skipBack: Number((e.target as HTMLSelectElement).value) })}>
            {[10, 15, 30].map((v) => (
              <option value={v}>{v} s</option>
            ))}
          </select>
        </label>
        <label class="form-row">
          <span>Skok vpřed</span>
          <select value={s.settings.skipForward} onChange={(e) => void updateSettings({ skipForward: Number((e.target as HTMLSelectElement).value) })}>
            {[15, 30, 45, 60].map((v) => (
              <option value={v}>{v} s</option>
            ))}
          </select>
        </label>
      </div>

      <h2 class="section-title">Synchronizace</h2>
      <div class="form-group">
        <div class="form-row">
          <span>Poslední synchronizace</span>
          <span class="muted">{s.syncing ? 'probíhá…' : s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleTimeString('cs-CZ') : '—'}</span>
        </div>
        <button class="form-row link" onClick={() => void sync().then(() => toast('Synchronizováno'), (e) => toast(errorMessage(e)))}>
          Synchronizovat teď
        </button>
      </div>

      <h2 class="section-title">Knihovna ({activePodcasts().length})</h2>
      <div class="form-group">
        <button class="form-row link" onClick={download}>
          Exportovat OPML
        </button>
        <label class="form-row link">
          {importing ? <Spinner /> : 'Importovat OPML'}
          <input type="file" accept=".opml,.xml,text/xml,text/x-opml" hidden onChange={onFile} />
        </label>
      </div>
      <p class="hint">OPML export obsahuje i adresy soukromých feedů – soubor nikomu neposílej.</p>

      <h2 class="section-title">Zařízení</h2>
      <div class="form-group">
        <button class="form-row link destructive" onClick={logout}>
          Odhlásit toto zařízení
        </button>
      </div>
      <p class="hint center">Earloft · {__APP_VERSION__}</p>
    </div>
  );
}

export function Login() {
  const [value, setValue] = useState(getToken());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setToken(value.trim());
    try {
      await api('/api/ping');
      set({ authed: true });
      void sync().catch(() => {});
    } catch (err) {
      setToken('');
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="login">
      <img src="/icon-192.png" width={96} height={96} alt="" class="login-icon" />
      <h1>Earloft</h1>
      <p>Zadej přístupový token (APP_TOKEN z Cloudflare).</p>
      <form onSubmit={submit}>
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Token"
          value={value}
          onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        />
        <button class="btn primary wide" disabled={busy || !value.trim()}>
          {busy ? 'Ověřuji…' : 'Pokračovat'}
        </button>
      </form>
      {error && <div class="error-box">{error}</div>}
    </div>
  );
}
