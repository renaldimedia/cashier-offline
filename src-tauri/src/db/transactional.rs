// src/db/transactional.rs
// Transactional database: one file per month (transactions_YYYY_MM.db)

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use rusqlite::{Connection, params};
use tracing::info;

/// Wraps the SQLite connection for a single month's transactional DB
pub struct TransactionalDb {
    conn: Connection,
    path: PathBuf,
}

impl TransactionalDb {
    pub fn open(path: &Path) -> Result<Self> {
        let is_new = !path.exists();

        let conn = Connection::open(path)
            .with_context(|| format!("Failed to open transactional DB at {:?}", path))?;

        let db = Self {
            conn,
            path: path.to_path_buf(),
        };

        db.configure()?;
        db.run_migrations()?;

        if is_new {
            info!("New monthly transactional DB created: {:?}", db.path);
        } else {
            info!("Opened existing transactional DB: {:?}", db.path);
        }

        Ok(db)
    }

    pub fn path(&self) -> PathBuf {
        self.path.clone()
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    // ──────────────────────────────────────────
    // Invoice number generation
    // Format: INV-YYYYMM-NNNN (per-month sequential)
    // ──────────────────────────────────────────
    pub fn next_invoice_no(&self) -> Result<String> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM transactions",
            [],
            |row| row.get(0),
        )?;

        // Extract YYYY_MM from filename: transactions_2025_01.db → 202501
        let month_tag = self
            .path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.replace("transactions_", "").replace('_', ""))
            .unwrap_or_else(|| {
                let now = chrono::Local::now();
                format!("{:04}{:02}", now.year(), now.month())
            });

        Ok(format!("INV-{}-{:04}", month_tag, count + 1))
    }

    // ──────────────────────────────────────────
    // PRIVATE: Setup
    // ──────────────────────────────────────────

    fn configure(&self) -> Result<()> {
        self.conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA synchronous = NORMAL;
             PRAGMA cache_size = -4000;",
        )?;
        Ok(())
    }

    fn run_migrations(&self) -> Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
               version    TEXT PRIMARY KEY,
               applied_at TEXT NOT NULL
             );",
        )?;

        if !self.migration_applied("V1")? {
            info!("Applying transactional migration V1...");
            let sql = include_str!("migrations/transactional/V1__init.sql");
            self.conn.execute_batch(sql)?;
            self.conn.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, datetime('now'))",
                params!["V1"],
            )?;
            info!("Transactional migration V1 applied.");
        }

        Ok(())
    }

    fn migration_applied(&self, version: &str) -> Result<bool> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
            params![version],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }
}

// Need chrono for year/month fallback
use chrono::Datelike;