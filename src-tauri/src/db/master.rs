// src/db/master.rs
// Master database: products, categories, customers, users, settings, sync config

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
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
        let placeholder1 = "$2b$12$placeholder_replace_on_first_run";
        let placeholder2 = "<hash_valid_placeholder_replace_on_first_run>";

        let (current_pass, current_valid, current_user): (String, String, String) = self
            .conn
            .query_row(
                "SELECT password, valid, username FROM users WHERE id = 'usr_superadmin_default'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap_or_default();

        let mut need_update = false;

        let new_password = if current_pass == placeholder1 {
            need_update = true;
            Some(bcrypt::hash("admin123", 12).context("Failed to hash default password")?)
        } else {
            None
        };

        let new_valid = if current_valid == placeholder2 {
            need_update = true;


            let combined = format!("fuckT4ht!{}", current_user);

            Some(bcrypt::hash(combined, 12).context("Failed to hash valid field")?)
        } else {
            None
        };

        if need_update {
            info!("Updating default superadmin placeholders...");

            self.conn.execute(
                "UPDATE users
             SET password = COALESCE(?1, password),
                 valid    = COALESCE(?2, valid),
                 updated_at = datetime('now')
             WHERE id = 'usr_superadmin_default'",
                params![new_password, new_valid],
            )?;

            info!("Default superadmin placeholders replaced.");
        }

        Ok(())
    }
}
