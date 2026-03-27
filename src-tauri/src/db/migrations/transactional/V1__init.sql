-- ============================================================
-- Transactional DB Migration V1 — Initial Schema
-- File: transactions_YYYY_MM.db  (new file created each month)
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────
-- TRANSACTIONS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id              TEXT    PRIMARY KEY,
  invoice_no      TEXT    UNIQUE NOT NULL,  -- e.g. INV-202501-0001
  cashier_id      TEXT    NOT NULL,         -- ref to master.users.id (no FK across files)
  cashier_name    TEXT    NOT NULL,         -- snapshot
  customer_id     TEXT,
  customer_name   TEXT,
  subtotal        REAL    NOT NULL DEFAULT 0,
  discount_amount REAL    NOT NULL DEFAULT 0,
  tax_amount      REAL    NOT NULL DEFAULT 0,
  total           REAL    NOT NULL DEFAULT 0,
  paid_amount     REAL    NOT NULL DEFAULT 0,
  change_amount   REAL    NOT NULL DEFAULT 0,
  status          TEXT    NOT NULL DEFAULT 'completed'
                          CHECK(status IN ('completed', 'void', 'pending')),
  void_reason     TEXT,
  voided_by       TEXT,
  voided_at       TEXT,
  notes           TEXT    DEFAULT '',
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_invoice    ON transactions(invoice_no);
CREATE INDEX IF NOT EXISTS idx_tx_cashier    ON transactions(cashier_id);
CREATE INDEX IF NOT EXISTS idx_tx_status     ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_tx_created    ON transactions(created_at);

-- ─────────────────────────────────────────
-- TRANSACTION ITEMS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_items (
  id              TEXT    PRIMARY KEY,
  transaction_id  TEXT    NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  product_id      TEXT    NOT NULL,        -- ref to master (no FK across files)
  product_sku     TEXT    NOT NULL,        -- snapshot
  product_name    TEXT    NOT NULL,        -- snapshot
  qty             INTEGER NOT NULL DEFAULT 1,
  unit            TEXT    NOT NULL DEFAULT 'pcs',
  unit_price      REAL    NOT NULL DEFAULT 0,
  discount_pct    REAL    NOT NULL DEFAULT 0,
  discount_amount REAL    NOT NULL DEFAULT 0,
  total           REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_items_tx_id   ON transaction_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_items_product ON transaction_items(product_id);

-- ─────────────────────────────────────────
-- PAYMENTS
-- A transaction can have multiple payments (split payment)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id              TEXT    PRIMARY KEY,
  transaction_id  TEXT    NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  method          TEXT    NOT NULL CHECK(method IN ('cash','card','qris','transfer','other')),
  amount          REAL    NOT NULL DEFAULT 0,
  change_amount   REAL    NOT NULL DEFAULT 0,
  reference_no    TEXT,                    -- card/transfer ref number
  notes           TEXT    DEFAULT '',
  created_at      TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_tx ON payments(transaction_id);

-- ─────────────────────────────────────────
-- SYNC QUEUE
-- Outbound: app → external API
-- Items queued here then dispatched by sync engine
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_queue (
  id              TEXT    PRIMARY KEY,
  entity_type     TEXT    NOT NULL,        -- 'transaction'
  entity_id       TEXT    NOT NULL,        -- transaction.id
  source_id       TEXT    NOT NULL,        -- sync_sources.id (from master.db)
  payload         TEXT    NOT NULL,        -- JSON blob to send
  status          TEXT    NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('pending','syncing','done','failed','skipped')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  last_error      TEXT,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  synced_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_sq_status    ON sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_sq_entity    ON sync_queue(entity_id);
CREATE INDEX IF NOT EXISTS idx_sq_source    ON sync_queue(source_id);

-- ─────────────────────────────────────────
-- DB META (schema versioning per file)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS db_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO db_meta (key, value) VALUES
  ('schema_version', '1'),
  ('created_at',     datetime('now'));