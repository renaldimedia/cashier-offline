// src/db/mod.rs
// Database manager: coordinates master.db and transactional_YYYY_MM.db

pub mod master;
pub mod transactional;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use anyhow::Result;
use chrono::Datelike;
use tracing::{info, warn};

pub use master::MasterDb;
pub use transactional::TransactionalDb;

/// Holds both DB handles. Wrapped in Arc for sharing across Tauri commands.
#[derive(Clone)]
pub struct DbManager {
    pub master: Arc<Mutex<MasterDb>>,
    pub transactional: Arc<Mutex<TransactionalDb>>,
    pub data_dir: PathBuf,
}

impl DbManager {
    /// Initialize both databases. Creates directories and files as needed.
    pub fn init(data_dir: PathBuf) -> Result<Self> {
        let db_dir = data_dir.join("db");
        let tx_dir = db_dir.join("transactions");

        std::fs::create_dir_all(&db_dir)?;
        std::fs::create_dir_all(&tx_dir)?;

        let master_path = db_dir.join("master.db");
        info!("Opening master DB: {:?}", master_path);
        let master = MasterDb::open(&master_path)?;

        let tx_path = current_tx_db_path(&tx_dir);
        info!("Opening transactional DB: {:?}", tx_path);
        let transactional = TransactionalDb::open(&tx_path)?;

        Ok(Self {
            master: Arc::new(Mutex::new(master)),
            transactional: Arc::new(Mutex::new(transactional)),
            data_dir,
        })
    }

    /// Called at the start of each command that needs transactional DB.
    /// Checks if we've rolled over to a new month and opens new file if needed.
    pub fn ensure_current_tx_db(&self) -> Result<()> {
        let tx_dir = self.data_dir.join("db").join("transactions");
        let expected_path = current_tx_db_path(&tx_dir);

        let mut tx = self.transactional.lock().unwrap();
        if tx.path() != expected_path {
            warn!("Month rollover detected — opening new transactional DB: {:?}", expected_path);
            *tx = TransactionalDb::open(&expected_path)?;
        }
        Ok(())
    }
}

/// Returns path like: {dir}/transactions_2025_01.db
pub fn current_tx_db_path(tx_dir: &PathBuf) -> PathBuf {
    let now = chrono::Local::now();
    let filename = format!("transactions_{:04}_{:02}.db", now.year(), now.month());
    tx_dir.join(filename)
}

/// Returns paths for all existing transactional DB files, sorted ascending
pub fn list_tx_db_files(tx_dir: &PathBuf) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(tx_dir)
        .unwrap_or_else(|_| panic!("Cannot read tx_dir {:?}", tx_dir))
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension().map(|e| e == "db").unwrap_or(false)
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with("transactions_"))
                    .unwrap_or(false)
        })
        .collect();

    files.sort();
    files
}