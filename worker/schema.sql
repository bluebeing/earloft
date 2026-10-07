-- Odběry podcastů (u soukromých feedů obsahuje feed_url tajný token)
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  feed_url TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  artwork_url TEXT,
  source TEXT NOT NULL DEFAULT 'rss',
  apple_id TEXT,
  is_private INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  server_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subs_server_ts ON subscriptions(server_ts);

-- Stav poslechu epizod; updated_at = čas klienta (last-write-wins), server_ts = čas přijetí (pro inkrementální sync)
CREATE TABLE IF NOT EXISTS episode_state (
  episode_id TEXT PRIMARY KEY,
  podcast_id TEXT NOT NULL,
  position_s REAL NOT NULL DEFAULT 0,
  duration_s REAL,
  played INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  server_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_state_server_ts ON episode_state(server_ts);

-- Fronta, nastavení apod. jako JSON
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  server_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kv_server_ts ON kv(server_ts);
