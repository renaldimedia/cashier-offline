// src/commands/settings.rs

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;
use super::ApiResponse;

#[derive(Debug, Serialize)]
pub struct Setting {
    pub key:         String,
    pub value:       String,
    pub value_type:  String,
    pub description: String,
    pub is_public:   bool,
    pub updated_at:  String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSettingPayload {
    pub key:   String,
    pub value: String,
}

#[tauri::command]
pub fn cmd_get_settings(state: State<AppState>) -> ApiResponse<Vec<Setting>> {
    let session = match state.session.require_role("cashier") {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    let db = state.db.master.lock().unwrap();

    // Non-superadmin only gets public settings
    let sql = if session.role == crate::auth::Role::Superadmin {
        "SELECT key,value,value_type,description,is_public,updated_at FROM settings ORDER BY key"
    } else {
        "SELECT key,value,value_type,description,is_public,updated_at FROM settings WHERE is_public = 1 ORDER BY key"
    };

    let mut stmt = db.conn().prepare(sql).unwrap();
    let settings: Vec<Setting> = stmt
        .query_map([], |row| Ok(Setting {
            key:         row.get(0)?,
            value:       row.get(1)?,
            value_type:  row.get(2)?,
            description: row.get(3)?,
            is_public:   row.get::<_, i64>(4)? == 1,
            updated_at:  row.get(5)?,
        }))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    ApiResponse::ok(settings)
}

#[tauri::command]
pub fn cmd_get_setting(key: String, state: State<AppState>) -> ApiResponse<String> {
    let _session = match state.session.require_role("cashier") {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    let db = state.db.master.lock().unwrap();
    match db.conn().query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get::<_, String>(0),
    ) {
        Ok(v)  => ApiResponse::ok(v),
        Err(_) => ApiResponse::err(format!("Setting '{}' tidak ditemukan", key).to_string()),
    }
}

#[tauri::command]
pub fn cmd_update_setting(
    payload: UpdateSettingPayload,
    state: State<AppState>,
) -> ApiResponse<()> {
    let _session = match state.session.require_role("superadmin") {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    let db = state.db.master.lock().unwrap();
    match db.conn().execute(
        "UPDATE settings SET value = ?1, updated_at = datetime('now') WHERE key = ?2",
        rusqlite::params![payload.value, payload.key],
    ) {
        Ok(n) if n > 0 => ApiResponse::ok(()),
        Ok(_) => {
            // Key doesn't exist yet — insert new
            let _ = db.conn().execute(
                "INSERT INTO settings (key,value,value_type,description,updated_at)
                 VALUES (?1,?2,'string','',datetime('now'))",
                rusqlite::params![payload.key, payload.value],
            );
            ApiResponse::ok(())
        }
        Err(e) => ApiResponse::err(e.to_string()),
    }
}