const migrations = [
  // Migration 1: Core schema
  (db) => {
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE sites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        domain TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, domain)
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        site_id INTEGER NOT NULL,
        visitor_id TEXT NOT NULL,
        started_at TEXT DEFAULT (datetime('now')),
        last_activity TEXT DEFAULT (datetime('now')),
        entry_page TEXT,
        exit_page TEXT,
        referrer TEXT,
        referrer_domain TEXT,
        utm_source TEXT,
        utm_medium TEXT,
        utm_campaign TEXT,
        utm_term TEXT,
        utm_content TEXT,
        country TEXT,
        city TEXT,
        continent TEXT,
        browser TEXT,
        browser_version TEXT,
        os TEXT,
        os_version TEXT,
        device_type TEXT,
        screen_width INTEGER,
        screen_height INTEGER,
        page_count INTEGER DEFAULT 1,
        is_bounce INTEGER DEFAULT 1,
        duration INTEGER DEFAULT 0,
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
      );

      CREATE TABLE page_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        pathname TEXT NOT NULL,
        hostname TEXT,
        querystring TEXT,
        referrer TEXT,
        timestamp TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE conversions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id INTEGER NOT NULL,
        session_id TEXT,
        visitor_id TEXT,
        stripe_event_id TEXT UNIQUE,
        stripe_customer_id TEXT,
        stripe_customer_email TEXT,
        payment_intent_id TEXT,
        amount INTEGER NOT NULL,
        currency TEXT DEFAULT 'usd',
        status TEXT NOT NULL,
        utm_source TEXT,
        utm_medium TEXT,
        utm_campaign TEXT,
        referrer_domain TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
      );

      CREATE TABLE daily_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        visitors INTEGER DEFAULT 0,
        sessions INTEGER DEFAULT 0,
        page_views INTEGER DEFAULT 0,
        bounces INTEGER DEFAULT 0,
        avg_duration REAL DEFAULT 0,
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
        UNIQUE(site_id, date)
      );

      CREATE INDEX idx_sessions_site_started ON sessions(site_id, started_at);
      CREATE INDEX idx_sessions_visitor ON sessions(visitor_id);
      CREATE INDEX idx_sessions_referrer ON sessions(site_id, referrer_domain);
      CREATE INDEX idx_sessions_utm ON sessions(site_id, utm_source, utm_medium, utm_campaign);
      CREATE INDEX idx_sessions_country ON sessions(site_id, country);
      CREATE INDEX idx_sessions_browser ON sessions(site_id, browser);
      CREATE INDEX idx_sessions_os ON sessions(site_id, os);

      CREATE INDEX idx_page_views_site_time ON page_views(site_id, timestamp);
      CREATE INDEX idx_page_views_session ON page_views(session_id);
      CREATE INDEX idx_page_views_pathname ON page_views(site_id, pathname);

      CREATE INDEX idx_conversions_site ON conversions(site_id, created_at);
      CREATE INDEX idx_conversions_visitor ON conversions(visitor_id);
      CREATE INDEX idx_conversions_session ON conversions(session_id);

      CREATE INDEX idx_daily_stats_site_date ON daily_stats(site_id, date);
    `);
  },
  // Migration 2: Per-site Stripe keys
  (db) => {
    db.exec(`
      ALTER TABLE sites ADD COLUMN stripe_secret_key TEXT;
      ALTER TABLE sites ADD COLUMN stripe_webhook_secret TEXT;
    `);
  },
];

export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const applied = db.prepare('SELECT id FROM _migrations ORDER BY id').all();
  const appliedIds = new Set(applied.map((r) => r.id));

  for (let i = 0; i < migrations.length; i++) {
    if (!appliedIds.has(i + 1)) {
      migrations[i](db);
      db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(i + 1);
    }
  }
}
