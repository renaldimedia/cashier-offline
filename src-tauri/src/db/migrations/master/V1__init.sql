-- ============================================================
-- Master DB Migration V1 — Initial Schema
-- File: master.db
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────
-- USERS
-- 3 role types: superadmin, manager, cashier
-- DB supports unlimited users, but the app
-- enforces max 1 per role for the local instance
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          TEXT    PRIMARY KEY,
  username    TEXT    UNIQUE NOT NULL,
  password    TEXT    NOT NULL,          -- bcrypt hash
  role        TEXT    NOT NULL CHECK(role IN ('superadmin', 'manager', 'cashier')),
  full_name   TEXT    NOT NULL DEFAULT '',
  pin         TEXT,                      -- optional 4-6 digit PIN (hashed)
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

-- ─────────────────────────────────────────
-- CATEGORIES
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  description TEXT    DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  ext_id      TEXT,                      -- external API id (for sync matching)
  synced_at   TEXT,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_categories_ext_id ON categories(ext_id);
CREATE INDEX IF NOT EXISTS idx_categories_active ON categories(is_active);

-- ─────────────────────────────────────────
-- PRODUCTS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id            TEXT    PRIMARY KEY,
  sku           TEXT    UNIQUE NOT NULL,
  barcode       TEXT,
  name          TEXT    NOT NULL,
  description   TEXT    DEFAULT '',
  category_id   TEXT    REFERENCES categories(id) ON DELETE SET NULL,
  price         REAL    NOT NULL DEFAULT 0,
  cost          REAL    NOT NULL DEFAULT 0,
  stock         INTEGER NOT NULL DEFAULT 0,
  stock_min     INTEGER NOT NULL DEFAULT 0,  -- alert threshold
  unit          TEXT    NOT NULL DEFAULT 'pcs',
  image_path    TEXT,                        -- local file path
  is_active     INTEGER NOT NULL DEFAULT 1,
  ext_id        TEXT,
  synced_at     TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_sku     ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_ext_id  ON products(ext_id);
CREATE INDEX IF NOT EXISTS idx_products_active  ON products(is_active);

-- ─────────────────────────────────────────
-- CUSTOMERS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  phone       TEXT,
  email       TEXT,
  address     TEXT    DEFAULT '',
  notes       TEXT    DEFAULT '',
  is_active   INTEGER NOT NULL DEFAULT 1,
  ext_id      TEXT,
  synced_at   TEXT,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_phone  ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_ext_id ON customers(ext_id);

-- ─────────────────────────────────────────
-- SETTINGS
-- Key-value store for all app configuration
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT    PRIMARY KEY,
  value       TEXT    NOT NULL,
  value_type  TEXT    NOT NULL DEFAULT 'string' CHECK(value_type IN ('string','number','boolean','json')),
  description TEXT    DEFAULT '',
  is_public   INTEGER NOT NULL DEFAULT 1,  -- 0 = superadmin only
  updated_at  TEXT    NOT NULL
);

-- ─────────────────────────────────────────
-- SYNC SOURCES
-- Configurable sync endpoints (multiple allowed)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_sources (
  id              TEXT    PRIMARY KEY,
  name            TEXT    NOT NULL,
  direction       TEXT    NOT NULL CHECK(direction IN ('inbound', 'outbound')),
  entity_type     TEXT    NOT NULL CHECK(entity_type IN ('products','categories','customers','transactions')),
  base_url        TEXT    NOT NULL,
  endpoint        TEXT    NOT NULL,
  http_method     TEXT    NOT NULL DEFAULT 'GET' CHECK(http_method IN ('GET','POST')),
  auth_type       TEXT    NOT NULL DEFAULT 'apikey' CHECK(auth_type IN ('apikey','jwt','none')),
  api_key         TEXT,              -- AES-GCM encrypted
  jwt_secret      TEXT,              -- AES-GCM encrypted
  extra_headers   TEXT    DEFAULT '{}',  -- JSON object
  is_active       INTEGER NOT NULL DEFAULT 1,
  sync_interval   INTEGER NOT NULL DEFAULT 3600, -- seconds, 0 = manual only
  last_sync_at    TEXT,
  last_sync_status TEXT,             -- 'ok' | 'error' | null
  last_sync_msg   TEXT,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
);

-- ─────────────────────────────────────────
-- SYNC FIELD MAPPINGS
-- Maps API response fields → local DB fields
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_field_mappings (
  id            TEXT    PRIMARY KEY,
  source_id     TEXT    NOT NULL REFERENCES sync_sources(id) ON DELETE CASCADE,
  api_field     TEXT    NOT NULL,    -- dot-notation: "data.product_name"
  local_field   TEXT    NOT NULL,    -- local column name: "name"
  transform     TEXT,                -- 'uppercase' | 'lowercase' | 'trim' | null
  default_value TEXT,
  is_required   INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mappings_source ON sync_field_mappings(source_id);

-- ─────────────────────────────────────────
-- DEFAULT DATA SEED
-- ─────────────────────────────────────────

-- Default settings
INSERT OR IGNORE INTO settings (key, value, value_type, description, updated_at) VALUES
  ('store_name',         'My POS Store',   'string',  'Nama toko',                            datetime('now')),
  ('store_address',      '',               'string',  'Alamat toko',                           datetime('now')),
  ('store_phone',        '',               'string',  'Telepon toko',                          datetime('now')),
  ('currency_symbol',    'Rp',             'string',  'Simbol mata uang',                      datetime('now')),
  ('currency_code',      'IDR',            'string',  'Kode mata uang',                        datetime('now')),
  ('tax_rate',           '0',              'number',  'Tarif pajak (%)',                       datetime('now')),
  ('receipt_footer',     'Terima kasih!',  'string',  'Footer struk',                          datetime('now')),
  ('low_stock_alert',    'true',           'boolean', 'Notifikasi stok rendah',                datetime('now')),
  ('auto_sync_enabled',  'false',          'boolean', 'Aktifkan sinkronisasi otomatis',        datetime('now')),
  ('db_version',         '1',              'number',  'Versi skema database master',           datetime('now'));

-- Default superadmin user (password: admin123 — MUST be changed)
-- password hash for 'admin123' using bcrypt cost 12
INSERT OR IGNORE INTO users (id, username, password, role, full_name, is_active, created_at, updated_at)
VALUES (
  'usr_superadmin_default',
  'superadmin',
  '$2b$12$placeholder_replace_on_first_run',  -- replaced at app init
  'superadmin',
  'Super Administrator',
  1,
  datetime('now'),
  datetime('now')
);