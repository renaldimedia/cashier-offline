// src/db/master.rs
// Master database: products, categories, customers, users, settings, sync config

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use rusqlite::{Connection, params};
use tracing::info;

/// Wraps the SQLite connection for master.db
pub struct MasterDb {
    conn: Connection,
    path: PathBuf,
}

impl MasterDb {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)
            .with_context(|| format!("Failed to open master DB at {:?}", path))?;

        let db = Self {
            conn,
            path: path.to_path_buf(),
        };

        db.configure()?;
        db.run_migrations()?;
        db.seed_default_admin()?;

        info!("Master DB initialized: {:?}", db.path);
        Ok(db)
    }

    pub fn path(&self) -> PathBuf {
        self.path.clone()
    }

    /// Borrow the inner connection for executing queries
    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    // ──────────────────────────────────────────
    // PRIVATE: Setup
    // ──────────────────────────────────────────

    fn configure(&self) -> Result<()> {
        self.conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA synchronous = NORMAL;
             PRAGMA cache_size = -8000;",
        )?;
        Ok(())
    }

    fn run_migrations(&self) -> Result<()> {
        // Create schema_migrations table to track applied migrations
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
               version    TEXT PRIMARY KEY,
               applied_at TEXT NOT NULL
             );",
        )?;

        // Run V1 if not applied
        if !self.migration_applied("V1")? {
            info!("Applying master migration V1...");
            let sql = include_str!("migrations/master/V1__init.sql");
            self.conn.execute_batch(sql)?;
            self.conn.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, datetime('now'))",
                params!["V1"],
            )?;
            info!("Master migration V1 applied.");
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

    /// Seed default admin user with a proper bcrypt hash on first run.
    /// The placeholder hash in SQL is replaced here.
    fn seed_default_admin(&self) -> Result<()> {
        let placeholder = "$2b$12$placeholder_replace_on_first_run";
        let current: String = self.conn.query_row(
            "SELECT password FROM users WHERE id = 'usr_superadmin_default'",
            [],
            |row| row.get(0),
        ).unwrap_or_default();

        if current == placeholder {
            info!("Hashing default superadmin password...");
            let hash = bcrypt::hash("admin123", 12)
                .context("Failed to hash default password")?;
            self.conn.execute(
                "UPDATE users SET password = ?1, updated_at = datetime('now')
                 WHERE id = 'usr_superadmin_default'",
                params![hash],
            )?;
            info!("Default superadmin password set (remember to change it!).");
        }

        Ok(())
    }
}