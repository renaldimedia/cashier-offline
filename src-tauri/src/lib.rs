// src/lib.rs
// Tauri application: state setup + command registration

mod auth;
mod commands;
mod db;
mod logger;
mod sync;

use std::path::PathBuf;

use anyhow::Result;
use tauri::Manager;
use tracing::info;

use auth::SessionStore;
use db::DbManager;

/// Global application state shared across all Tauri commands
pub struct AppState {
    pub db:      DbManager,
    pub session: SessionStore,
    pub data_dir: PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Determine data directory
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");

            std::fs::create_dir_all(&data_dir)?;

            // Initialize logger (guard must live for process lifetime)
            let _log_guard = logger::init_logger(&data_dir)
                .expect("Failed to initialize logger");

            info!("POS App starting. Data dir: {:?}", data_dir);

            // Initialize databases
            let db = DbManager::init(data_dir.clone())
                .expect("Failed to initialize databases");

            let state = AppState {
                db,
                session: SessionStore::new(),
                data_dir,
            };

            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Auth
            commands::auth::cmd_login,
            commands::auth::cmd_logout,
            commands::auth::cmd_get_session,
            // Users
            commands::users::cmd_list_users,
            commands::users::cmd_create_user,
            commands::users::cmd_update_user,
            commands::users::cmd_delete_user,
            commands::users::cmd_change_password,
            // Products
            commands::products::cmd_list_products,
            commands::products::cmd_get_product,
            commands::products::cmd_create_product,
            commands::products::cmd_update_product,
            commands::products::cmd_delete_product,
            commands::products::cmd_search_products,
            // Categories
            commands::categories::cmd_list_categories,
            commands::categories::cmd_create_category,
            commands::categories::cmd_update_category,
            commands::categories::cmd_delete_category,
            // Customers
            commands::customers::cmd_list_customers,
            commands::customers::cmd_create_customer,
            commands::customers::cmd_update_customer,
            // Transactions
            commands::transactions::cmd_create_transaction,
            commands::transactions::cmd_get_transaction,
            commands::transactions::cmd_list_transactions,
            commands::transactions::cmd_void_transaction,
            commands::transactions::cmd_void_transactions,
            commands::transactions::cmd_list_tx_months,
            // Settings
            commands::settings::cmd_get_settings,
            commands::settings::cmd_get_setting,
            commands::settings::cmd_update_setting,
            // Sync
            commands::sync::cmd_list_sync_sources,
            commands::sync::cmd_create_sync_source,
            commands::sync::cmd_update_sync_source,
            commands::sync::cmd_delete_sync_source,
            commands::sync::cmd_list_field_mappings,
            commands::sync::cmd_save_field_mappings,
            commands::sync::cmd_run_sync,
            commands::sync::cmd_get_sync_queue_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}