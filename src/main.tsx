import { render } from 'preact';
import { useEffect, useLayoutEffect } from 'preact/hooks';
import { registerSW } from 'virtual:pwa-register';
import { init, refreshAll, sync } from './library';
import { restoreLastEpisode, skipBack, skipForward, togglePlay } from './player';
import { set, state, toast, useStore } from './store';
import { CategoriesPage, CategoryPickerHost } from './ui/categories';
import { ActionSheetHost, Artwork, scrollTargetFor, scroller, useIsDesktop, useRoute } from './ui/common';
import { TabCalendar, TabLibrary, TabListen, TabSearch, TabSettings } from './ui/icons';
import { Overview } from './ui/overview';
import { DesktopPlayer, MiniPlayer, NowPlaying } from './ui/player-ui';
import { EpisodePage, Library, ListenNow, NotFound, PodcastPage, Search } from './ui/screens';
import { Login, Settings } from './ui/settings';
import './styles.css';
import './desktop.css';

registerSW({ immediate: true });

const TABS = [
  { path: '', label: 'Poslouchat', Icon: TabListen },
  { path: 'library', label: 'Knihovna', Icon: TabLibrary },
  { path: 'overview', label: 'Přehled', Icon: TabCalendar },
  { path: 'search', label: 'Hledat', Icon: TabSearch },
  { path: 'settings', label: 'Nastavení', Icon: TabSettings },
];

function Screen({ route }: { route: string[] }) {
  const [name, id] = route;
  switch (name ?? '') {
    case '':
      return <ListenNow />;
    case 'library':
      return <Library catParam={id} />;
    case 'search':
      return <Search />;
    case 'overview':
      return <Overview />;
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

/** Boční panel na počítači: navigace + rychlý přístup ke kategoriím. */
function Sidebar() {
  const s = useStore();
  let libCat: string | null = null;
  try {
    libCat = localStorage.getItem('podcasty.cat.library');
  } catch {
    /* ignore */
  }
  const activeCat = lastTab === 'library' ? (libCat ?? s.categories[0]?.id) : null;
  return (
    <aside class="sidebar">
      <div class="sb-brand">
        <img src="/icon-192.png" width={30} height={30} alt="" />
        <span>Posluchárna</span>
      </div>
      <nav class="sb-nav">
        {TABS.map(({ path, label, Icon }) => (
          <a href={`#/${path}`} class={lastTab === path ? 'on' : ''}>
            <Icon size={20} />
            <span>{label}</span>
          </a>
        ))}
      </nav>
      {s.categories.length > 0 && (
        <>
          <div class="sb-heading">Kategorie</div>
          <nav class="sb-nav sb-cats">
            {[...s.categories, { id: '__none', name: 'Bez kategorie', podcastIds: [] }].map((c) => {
              const first = c.podcastIds.map((id) => s.podcasts.get(id)).find((p) => p && !p.deleted);
              return (
                <a href={`#/library/${c.id}`} class={activeCat === c.id ? 'on' : ''}>
                  {first ? <Artwork src={first.artworkUrl} size={20} /> : <span class="sb-dot" />}
                  <span>{c.name}</span>
                </a>
              );
            })}
          </nav>
        </>
      )}
      <div class="sb-hint">Mezerník přehrát/pauza · ← → posun</div>
    </aside>
  );
}

/** Klávesové zkratky (hlavně pro počítač). */
function useShortcuts() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target;
      if ((t instanceof Element && t.closest('input, textarea, select, [contenteditable]')) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape' && state.nowPlayingOpen) return set({ nowPlayingOpen: false });
      if (!state.currentId) return;
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        skipBack();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        skipForward();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
}

function App() {
  const s = useStore();
  const { route, hash, dir } = useRoute();
  const desktop = useIsDesktop();
  useShortcuts();

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

  // Po přechodu: zpět → kde jsi byl, vpřed → nahoru
  useLayoutEffect(() => {
    scroller()?.scrollTo(0, scrollTargetFor(hash, dir));
  }, [hash]);

  if (!s.ready) return null;
  if (!s.authed) return <Login />;

  const tabPath = route[0] ?? '';
  if (TABS.some((t) => t.path === tabPath)) lastTab = tabPath;

  return (
    <>
      <div class="shell">
        {desktop && <Sidebar />}
        <main class={s.currentId ? 'has-mini' : ''}>
          <div class={`page page-${dir}`} key={hash}>
            <Screen route={route} />
          </div>
        </main>
      </div>
      <div class="bottom-chrome">
        {desktop ? <DesktopPlayer /> : <MiniPlayer />}
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
      {s.toast && (
        <div class="toast" key={s.toast}>
          {s.toast}
        </div>
      )}
    </>
  );
}

void init().then(() => {
  restoreLastEpisode();
  render(<App />, document.getElementById('app')!);
});
