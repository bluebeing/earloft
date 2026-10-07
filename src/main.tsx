import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import { registerSW } from 'virtual:pwa-register';
import { init, refreshAll, sync } from './library';
import { restoreLastEpisode } from './player';
import { set, toast, useStore } from './store';
import { CategoriesPage, CategoryPickerHost } from './ui/categories';
import { ActionSheetHost, useRoute } from './ui/common';
import { TabLibrary, TabListen, TabSearch, TabSettings } from './ui/icons';
import { MiniPlayer, NowPlaying } from './ui/player-ui';
import { EpisodePage, Library, ListenNow, NotFound, PodcastPage, Search } from './ui/screens';
import { Login, Settings } from './ui/settings';
import './styles.css';

registerSW({ immediate: true });

const TABS = [
  { path: '', label: 'Poslouchat', Icon: TabListen },
  { path: 'library', label: 'Knihovna', Icon: TabLibrary },
  { path: 'search', label: 'Hledat', Icon: TabSearch },
  { path: 'settings', label: 'Nastavení', Icon: TabSettings },
];

function Screen({ route }: { route: string[] }) {
  const [name, id] = route;
  switch (name ?? '') {
    case '':
      return <ListenNow />;
    case 'library':
      return <Library />;
    case 'search':
      return <Search />;
    case 'settings':
      return <Settings />;
    case 'podcast':
      return <PodcastPage id={id} key={id} />;
    case 'categories':
      return <CategoriesPage />;
    case 'episode':
      return <EpisodePage id={id} key={id} />;
    default:
      return <NotFound />;
  }
}

/** Ke které záložce patří aktuální stránka (detail se zvýrazní pod posledně použitou). */
let lastTab = '';

function App() {
  const s = useStore();
  const route = useRoute();

  useEffect(() => {
    const onUnauthorized = () => set({ authed: false });
    const onToast = (e: Event) => toast((e as CustomEvent<string>).detail);
    window.addEventListener('podcasty:unauthorized', onUnauthorized);
    window.addEventListener('podcasty:toast', onToast);
    return () => {
      window.removeEventListener('podcasty:unauthorized', onUnauthorized);
      window.removeEventListener('podcasty:toast', onToast);
    };
  }, []);

  // Při otevření appky a návratu do ní: synchronizovat a obnovit feedy
  useEffect(() => {
    if (!s.authed || !s.ready) return;
    let lastRefresh = 0;
    const kick = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastRefresh > 15 * 60000) {
        lastRefresh = now;
        void refreshAll().then(restoreLastEpisode);
      } else {
        void sync()
          .then(restoreLastEpisode)
          .catch(() => {});
      }
    };
    kick();
    document.addEventListener('visibilitychange', kick);
    return () => document.removeEventListener('visibilitychange', kick);
  }, [s.authed, s.ready]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.join('/')]);

  if (!s.ready) return null;
  if (!s.authed) return <Login />;

  const tabPath = route[0] ?? '';
  if (TABS.some((t) => t.path === tabPath)) lastTab = tabPath;

  return (
    <>
      <main class={s.currentId ? 'has-mini' : ''}>
        <Screen route={route} />
      </main>
      <div class="bottom-chrome">
        <MiniPlayer />
        <nav class="tabbar">
          {TABS.map(({ path, label, Icon }) => (
            <a href={`#/${path}`} class={lastTab === path ? 'on' : ''}>
              <Icon size={24} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
      </div>
      <NowPlaying />
      <ActionSheetHost />
      <CategoryPickerHost />
      {s.toast && <div class="toast">{s.toast}</div>}
    </>
  );
}

void init().then(() => {
  restoreLastEpisode();
  render(<App />, document.getElementById('app')!);
});
