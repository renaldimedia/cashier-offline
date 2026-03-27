// src/commands/sync.rs
// Sync source CRUD + manual sync trigger

use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::AppState;
use super::ApiResponse;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncSource {
    pub id:               String,
    pub name:             String,
    pub direction:        String,
    pub entity_type:      String,
    pub base_url:         String,
    pub endpoint:         String,
    pub http_method:      String,
    pub auth_type:        String,
    pub is_active:        bool,
    pub sync_interval:    i64,
    pub last_sync_at:     Option<String>,
    pub last_sync_status: Option<String>,
    pub last_sync_msg:    Option<String>,
    pub created_at:       String,
    pub updated_at:       String,
}

#[derive(Debug, Deserialize)]
pub struct CreateSyncSourcePayload {
    pub name:          String,
    pub direction:     String,
    pub entity_type:   String,
    pub base_url:      String,
    pub endpoint:      String,
    pub http_method:   Option<String>,
    pub auth_type:     Option<String>,
    pub api_key:       Option<String>,
    pub jwt_secret:    Option<String>,
    pub extra_headers: Option<String>,
    pub sync_interval: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FieldMapping {
    pub id:            String,
    pub source_id:     String,
    pub api_field:     String,
    pub local_field:   String,
    pub transform:     Option<String>,
    pub default_value: Option<String>,
    pub is_required:   bool,
    pub sort_order:    i64,
}

#[derive(Debug, Deserialize)]
pub struct FieldMappingPayload {
    pub api_field:     String,
    pub local_field:   String,
    pub transform:     Option<String>,
    pub default_value: Option<String>,
    pub is_required:   Option<bool>,
    pub sort_order:    Option<i64>,
}

#[tauri::command]
pub fn cmd_list_sync_sources(state: State<AppState>) -> ApiResponse<Vec<SyncSource>> {
    let _session = match state.session.require_role("superadmin") {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    let db = state.db.master.lock().unwrap();
    let mut stmt = db.conn().prepare(
        "SELECT id,name,direction,entity_type,base_url,endpoint,http_method,
                auth_type,is_active,sync_interval,last_sync_at,last_sync_status,
                last_sync_msg,created_at,updated_at
         FROM sync_sources ORDER BY name ASC"
    ).unwrap();

    let sources: Vec<SyncSource> = stmt
        .query_map([], |row| Ok(SyncSource {
            id:               row.get(0)?,
            name:             row.get(1)?,
            direction:        row.get(2)?,
            entity_type:      row.get(3)?,
            base_url:         row.get(4)?,
            endpoint:         row.get(5)?,
            http_method:      row.get(6)?,
            auth_type:        row.get(7)?,
            is_active:        row.get::<_, i64>(8)? == 1,
            sync_interval:    row.get(9)?,
            last_sync_at:     row.get(10)?,
            last_sync_status: row.get(11)?,
            last_sync_msg:    row.get(12)?,
            created_at:       row.get(13)?,
            updated_at:       row.get(14)?,
        }))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    ApiResponse::ok(sources)
}

#[tauri::command]
pub fn cmd_create_sync_source(
    payload: CreateSyncSourcePayload,
    state: State<AppState>,
) -> ApiResponse<String> {
    let _session = match state.session.require_role("superadmin") {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    let id = format!("sync_{}", Uuid::new_v4().simple());
    let now = chrono::Local::now().to_rfc3339();
    let db = state.db.master.lock().unwrap();

    // In production: encrypt api_key/jwt_secret before storing
    let result = db.conn().execute(
        "INSERT INTO sync_sources
           (id,name,direction,entity_type,base_url,endpoint,http_method,
            auth_type,api_key,jwt_secret,extra_headers,is_active,sync_interval,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,1,?12,?13,?13)",
        rusqlite::params![
            id, payload.name, payload.direction, payload.entity_type,
            payload.base_url, payload.endpoint,
            payload.http_method.unwrap_or_else(|| "GET".into()),
            payload.auth_type.unwrap_or_else(|| "apikey".into()),
            payload.api_key, payload.jwt_secret,
            payload.extra_headers.unwrap_or_else(|| "{}".into()),
            payload.sync_interval.unwrap_or(3600), now
        ],
    );

    match result {
        Ok(_)  => ApiResponse::ok(id),
        Err(e) => ApiResponse::err(format!("Gagal menyimpan sync source: {}", e)),
    }
}

#[tauri::command]
pub fn cmd_update_sync_source(
    id: String,
    is_active: Option<bool>,
    sync_interval: Option<i64>,
    state: State<AppState>,
) -> ApiResponse<()> {
    let _session = match state.session.require_role("superadmin") {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    let db = state.db.master.lock().unwrap();
    let _ = db.conn().execute(
        "UPDATE sync_sources
         SET is_active = COALESCE(?1, is_active),
             sync_interval = COALESCE(?2, sync_interval),
             updated_at = datetime('now')
         WHERE id = ?3",
        rusqlite::params![
            is_active.map(|b| if b { 1i64 } else { 0i64 }),
            sync_interval,
            id
        ],
    );
    ApiResponse::ok(())
}

#[tauri::command]
pub fn cmd_delete_sync_source(id: String, state: State<AppState>) -> ApiResponse<()> {
    let _session = match state.session.require_role("superadmin") {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    let db = state.db.master.lock().unwrap();
    let _ = db.conn().execute("DELETE FROM sync_sources WHERE id = ?1", rusqlite::params![id]);
    ApiResponse::ok(())
}

#[tauri::command]
pub fn cmd_list_field_mappings(
    source_id: String,
    state: State<AppState>,
) -> ApiResponse<Vec<FieldMapping>> {
    let _session = match state.session.require_role("superadmin") {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    let db = state.db.master.lock().unwrap();
    let mut stmt = db.conn().prepare(
        "SELECT id,source_id,api_field,local_field,transform,default_value,is_required,sort_order
         FROM sync_field_mappings WHERE source_id = ?1 ORDER BY sort_order ASC"
    ).unwrap();

    let mappings: Vec<FieldMapping> = stmt
        .query_map(rusqlite::params![source_id], |row| Ok(FieldMapping {
            id:            row.get(0)?,
            source_id:     row.get(1)?,
            api_field:     row.get(2)?,
            local_field:   row.get(3)?,
            transform:     row.get(4)?,
            default_value: row.get(5)?,
            is_required:   row.get::<_, i64>(6)? == 1,
            sort_order:    row.get(7)?,
        }))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    ApiResponse::ok(mappings)
}

/// Replace all field mappings for a source (save as a batch)
#[tauri::command]
pub fn cmd_save_field_mappings(
    source_id: String,
    mappings: Vec<FieldMappingPayload>,
    state: State<AppState>,
) -> ApiResponse<()> {
    let _session = match state.session.require_role("superadmin") {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    let db = state.db.master.lock().unwrap();
    let _ = db.conn().execute(
        "DELETE FROM sync_field_mappings WHERE source_id = ?1",
        rusqlite::params![source_id],
    );

    for (i, m) in mappings.iter().enumerate() {
        let mid = format!("sfm_{}", Uuid::new_v4().simple());
        let _ = db.conn().execute(
            "INSERT INTO sync_field_mappings
               (id,source_id,api_field,local_field,transform,default_value,is_required,sort_order)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            rusqlite::params![
                mid, source_id, m.api_field, m.local_field,
                m.transform, m.default_value,
                m.is_required.unwrap_or(false) as i64,
                m.sort_order.unwrap_or(i as i64)
            ],
        );
    }

    ApiResponse::ok(())
}

/// Trigger a sync manually (will delegate to sync engine in Phase 4)
#[tauri::command]
pub async fn cmd_run_sync(
    source_id: String,
    state: State<'_, AppState>,
) -> Result<ApiResponse<serde_json::Value>, String> {
    let _session = match state.session.require_role("superadmin") {
        Ok(s) => s, Err(e) => return Ok(ApiResponse::err(e.to_string())),
    };

    // TODO Phase 4: delegate to sync::engine::run_sync(source_id, &state)
    Ok(ApiResponse::ok(serde_json::json!({
        "status": "queued",
        "source_id": source_id,
        "message": "Sync engine will be implemented in Phase 4"
    })))
}

#[tauri::command]
pub fn cmd_get_sync_queue_stats(state: State<AppState>) -> ApiResponse<serde_json::Value> {
    let _session = match state.session.require_role("manager") {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    if let Err(e) = state.db.ensure_current_tx_db() {
        return ApiResponse::err(e.to_string());
    }

    let db = state.db.transactional.lock().unwrap();
    let mut stmt = db.conn().prepare(
        "SELECT status, COUNT(*) as cnt FROM sync_queue GROUP BY status"
    ).unwrap();

    let mut stats = serde_json::json!({ "pending":0,"done":0,"failed":0,"syncing":0 });
    let _ = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    }).unwrap().for_each(|r| {
        if let Ok((status, count)) = r {
            stats[status] = serde_json::json!(count);
        }
    });

    ApiResponse::ok(stats)
}