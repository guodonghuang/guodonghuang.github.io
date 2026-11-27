-- 心喜 · D1 数据库初始化（在 Cloudflare 控制台 D1 里执行）
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  old_price REAL,
  tag TEXT DEFAULT '',
  description TEXT DEFAULT '',
  image TEXT DEFAULT '',
  sort INTEGER DEFAULT 0,
  visible INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS admins (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS upload_files (
  path TEXT PRIMARY KEY,
  content_type TEXT,
  data BLOB NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
