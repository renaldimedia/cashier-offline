// src/sync/engine.rs
// Sync engine: handles inbound (API → local) and outbound (local → API)

use anyhow::{Context, Result};
use serde_json::Value;
use tracing::{error, info, warn};

use crate::AppState;
use super::mapper::apply_mappings;

/// Run sync for a specific source.
/// Called either manually (from cmd_run_sync) or by background scheduler.
pub async fn run_sync(source_id: &str, state: &AppState) -> Result<SyncResult> {
    // Load source config from master DB
    let source = {
        let db = state.db.master.lock().unwrap();
        load_source(&db.conn(), source_id)?
    };

    if !source.is_active {
        return Ok(SyncResult::skipped("Source not active"));
    }

    let result = match source.direction.as_str() {
        "inbound"  => run_inbound(source, state).await,
        "outbound" => run_outbound(source, state).await,
        other      => Err(anyhow::anyhow!("Unknown direction: {}", other)),
    };

    // Update last_sync_at and status in master DB
    let (status, msg) = match &result {
        Ok(r)  => ("ok".to_string(), r.message.clone()),
        Err(e) => ("error".to_string(), e.to_string()),
    };

    {
        let db = state.db.master.lock().unwrap();
        let _ = db.conn().execute(
            "UPDATE sync_sources
             SET last_sync_at=datetime('now'), last_sync_status=?1, last_sync_msg=?2, updated_at=datetime('now')
             WHERE id=?3",
            rusqlite::params![status, msg, source_id],
        );
    }

    result
}

// ─────────────────────────────────────────────
// INBOUND: API → Local master DB (one-way)
// Used for: products, categories, customers
// ─────────────────────────────────────────────
async fn run_inbound(source: SyncSourceConfig, state: &AppState) -> Result<SyncResult> {
    info!("Inbound sync starting: {} ({})", source.name, source.entity_type);

    let url = format!("{}{}", source.base_url.trim_end_matches('/'), source.endpoint);

    // Build request
    let client = reqwest::Client::new();
    let mut req = match source.http_method.as_str() {
        "POST" => client.post(&url),
        _      => client.get(&url),
    };

    // Auth headers
    req = apply_auth(req, &source);

    // Extra headers (JSON object)
    if let Ok(headers) = serde_json::from_str::<serde_json::Map<String, Value>>(&source.extra_headers) {
        for (k, v) in headers {
            if let Some(val) = v.as_str() {
                req = req.header(&k, val);
            }
        }
    }

    let response = req.send().await.context("HTTP request failed")?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("API returned status {}", response.status()));
    }

    let body: Value = response.json().await.context("Failed to parse API response")?;

    // Load field mappings
    let mappings = {
        let db = state.db.master.lock().unwrap();
        load_mappings(&db.conn(), &source.id)?
    };

    // The API response can be an array or an object with a data/items key.
    // Try common patterns.
    let items = extract_array(&body)?;

    let mut upserted = 0usize;
    let mut errors   = 0usize;

    for item in &items {
        match apply_mappings(item, &mappings) {
            Ok(mapped) => {
                let db = state.db.master.lock().unwrap();
                match upsert_entity(&db.conn(), &source.entity_type, mapped) {
                    Ok(_)  => upserted += 1,
                    Err(e) => { error!("Upsert error: {}", e); errors += 1; }
                }
            }
            Err(e) => {
                warn!("Mapping error for item: {}", e);
                errors += 1;
            }
        }
    }

    info!("Inbound sync done: {} upserted, {} errors", upserted, errors);

    Ok(SyncResult {
        direction: "inbound".into(),
        entity_type: source.entity_type,
        processed: items.len(),
        upserted,
        errors,
        message: format!("OK: {} records synced", upserted),
    })
}

// ─────────────────────────────────────────────
// OUTBOUND: Local → API (one-way)
// Reads from sync_queue in current transactional DB
// ─────────────────────────────────────────────
async fn run_outbound(source: SyncSourceConfig, state: &AppState) -> Result<SyncResult> {
    info!("Outbound sync starting: {} ({})", source.name, source.entity_type);

    state.db.ensure_current_tx_db()?;

    // ✅ FIX: pakai intermediate variable biar iterator selesai di dalam scope
    let pending_items: Vec<(String, String)> = {
        let db = state.db.transactional.lock().unwrap();

        let mut stmt = db.conn().prepare(
            "SELECT id, payload FROM sync_queue
             WHERE source_id = ?1 AND status = 'pending' AND attempts < max_attempts
             ORDER BY created_at ASC LIMIT 50"
        )?;

        let mapped = stmt.query_map(rusqlite::params![source.id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let result: Vec<(String, String)> =
            mapped.filter_map(|r| r.ok()).collect();

        result
    };

    if pending_items.is_empty() {
        return Ok(SyncResult::skipped("No pending items in queue"));
    }

    let url = format!("{}{}", source.base_url.trim_end_matches('/'), source.endpoint);
    let client = reqwest::Client::new();

    let mut done   = 0usize;
    let mut failed = 0usize;

    for (queue_id, payload_str) in &pending_items {
        // Mark as syncing
        {
            let db = state.db.transactional.lock().unwrap();
            let _ = db.conn().execute(
                "UPDATE sync_queue SET status='syncing', attempts=attempts+1, updated_at=datetime('now') WHERE id=?1",
                rusqlite::params![queue_id],
            );
        }

        let payload: Value = match serde_json::from_str(payload_str) {
            Ok(v)  => v,
            Err(e) => {
                mark_failed(state, queue_id, &e.to_string());
                failed += 1;
                continue;
            }
        };

        let mut req = match source.http_method.as_str() {
            "GET" => client.get(&url),
            _     => client.post(&url),
        };
        req = apply_auth(req, &source).json(&payload);

        match req.send().await {
            Ok(resp) if resp.status().is_success() => {
                let db = state.db.transactional.lock().unwrap();
                let _ = db.conn().execute(
                    "UPDATE sync_queue SET status='done', synced_at=datetime('now'), updated_at=datetime('now') WHERE id=?1",
                    rusqlite::params![queue_id],
                );
                done += 1;
            }
            Ok(resp) => {
                let msg = format!("HTTP {}", resp.status());
                mark_failed(state, queue_id, &msg);
                failed += 1;
            }
            Err(e) => {
                mark_failed(state, queue_id, &e.to_string());
                failed += 1;
            }
        }
    }

    info!("Outbound sync done: {} sent, {} failed", done, failed);

    Ok(SyncResult {
        direction:   "outbound".into(),
        entity_type: source.entity_type,
        processed:   pending_items.len(),
        upserted:    done,
        errors:      failed,
        message:     format!("OK: {} sent, {} failed", done, failed),
    })
}
// ─────────────────────────────────────────────
// Upsert helpers
// ─────────────────────────────────────────────

fn upsert_entity(
    conn: &rusqlite::Connection,
    entity_type: &str,
    mapped: std::collections::HashMap<String, Value>,
) -> Result<()> {
    let now = chrono::Local::now().to_rfc3339();

    match entity_type {
        "products" => {
            let ext_id = mapped.get("ext_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing ext_id"))?
                .to_string();

            let name  = get_str(&mapped, "name")?;
            let sku   = get_str(&mapped, "sku").unwrap_or_else(|_| ext_id.clone());
            let price = mapped.get("price").and_then(|v| v.as_f64()).unwrap_or(0.0);

            conn.execute(
                "INSERT INTO products(id,sku,name,price,cost,stock,unit,is_active,ext_id,synced_at,created_at,updated_at)
                 VALUES(?,?,?,?,0,0,'pcs',1,?,datetime('now'),?,?)
                 ON CONFLICT(ext_id) DO UPDATE SET
                   name=excluded.name, sku=excluded.sku, price=excluded.price,
                   synced_at=datetime('now'), updated_at=excluded.updated_at
                 WHERE ext_id IS NOT NULL",
                rusqlite::params![
                    format!("prd_{}", uuid::Uuid::new_v4().simple()),
                    sku, name, price, ext_id, now, now
                ],
            ).map(|_| ()).context("Upsert product failed")
        }

        "categories" => {
            let ext_id = get_str(&mapped, "ext_id")?;
            let name   = get_str(&mapped, "name")?;

            conn.execute(
                "INSERT INTO categories(id,name,description,sort_order,is_active,ext_id,synced_at,created_at,updated_at)
                 VALUES(?,?,'',0,1,?,datetime('now'),?,?)
                 ON CONFLICT(ext_id) DO UPDATE SET
                   name=excluded.name, synced_at=datetime('now'), updated_at=excluded.updated_at
                 WHERE ext_id IS NOT NULL",
                rusqlite::params![
                    format!("cat_{}", uuid::Uuid::new_v4().simple()),
                    name, ext_id, now, now
                ],
            ).map(|_| ()).context("Upsert category failed")
        }

        "customers" => {
            let ext_id = get_str(&mapped, "ext_id")?;
            let name   = get_str(&mapped, "name")?;
            let phone  = mapped.get("phone").and_then(|v| v.as_str()).unwrap_or("").to_string();

            conn.execute(
                "INSERT INTO customers(id,name,phone,address,notes,is_active,ext_id,synced_at,created_at,updated_at)
                 VALUES(?,?,?,'','',1,?,datetime('now'),?,?)
                 ON CONFLICT(ext_id) DO UPDATE SET
                   name=excluded.name, phone=excluded.phone,
                   synced_at=datetime('now'), updated_at=excluded.updated_at
                 WHERE ext_id IS NOT NULL",
                rusqlite::params![
                    format!("cus_{}", uuid::Uuid::new_v4().simple()),
                    name, phone, ext_id, now, now
                ],
            ).map(|_| ()).context("Upsert customer failed")
        }

        other => Err(anyhow::anyhow!("Unknown entity type: {}", other)),
    }
}

// ─────────────────────────────────────────────
// Auth helper
// ─────────────────────────────────────────────
fn apply_auth(req: reqwest::RequestBuilder, source: &SyncSourceConfig) -> reqwest::RequestBuilder {
    match source.auth_type.as_str() {
        "apikey" => {
            if let Some(key) = &source.api_key {
                req.header("X-API-Key", key)
                   .header("Authorization", format!("Bearer {}", key))
            } else { req }
        }
        "jwt" => {
            if let Some(secret) = &source.jwt_secret {
                // Simple JWT header; real impl would generate a signed token
                req.header("Authorization", format!("Bearer {}", secret))
            } else { req }
        }
        _ => req,
    }
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
fn extract_array(body: &Value) -> Result<Vec<Value>> {
    if let Some(arr) = body.as_array() {
        return Ok(arr.clone());
    }
    // Try common response envelope patterns
    for key in &["data", "items", "results", "records", "list"] {
        if let Some(arr) = body.get(key).and_then(|v| v.as_array()) {
            return Ok(arr.clone());
        }
    }
    // Single object — wrap in vec
    Ok(vec![body.clone()])
}

fn get_str(map: &std::collections::HashMap<String, Value>, key: &str) -> Result<String> {
    map.get(key)
       .and_then(|v| v.as_str())
       .map(|s| s.to_string())
       .ok_or_else(|| anyhow::anyhow!("Missing required field: {}", key))
}

fn mark_failed(state: &AppState, queue_id: &str, error: &str) {
    let db = state.db.transactional.lock().unwrap();
    let _ = db.conn().execute(
        "UPDATE sync_queue
         SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
             last_error = ?1,
             updated_at = datetime('now')
         WHERE id = ?2",
        rusqlite::params![error, queue_id],
    );
}

fn load_source(conn: &rusqlite::Connection, source_id: &str) -> Result<SyncSourceConfig> {
    conn.query_row(
        "SELECT id,name,direction,entity_type,base_url,endpoint,http_method,
                auth_type,api_key,jwt_secret,extra_headers,is_active
         FROM sync_sources WHERE id = ?1",
        rusqlite::params![source_id],
        |row| Ok(SyncSourceConfig {
            id:            row.get(0)?,
            name:          row.get(1)?,
            direction:     row.get(2)?,
            entity_type:   row.get(3)?,
            base_url:      row.get(4)?,
            endpoint:      row.get(5)?,
            http_method:   row.get(6)?,
            auth_type:     row.get(7)?,
            api_key:       row.get(8)?,
            jwt_secret:    row.get(9)?,
            extra_headers: row.get::<_, Option<String>>(10)?.unwrap_or_else(|| "{}".into()),
            is_active:     row.get::<_, i64>(11)? == 1,
        }),
    ).context("Sync source not found")
}

fn load_mappings(
    conn: &rusqlite::Connection,
    source_id: &str,
) -> Result<Vec<super::mapper::FieldMapping>> {
    let mut stmt = conn.prepare(
        "SELECT api_field, local_field, transform, default_value, is_required
         FROM sync_field_mappings WHERE source_id = ?1 ORDER BY sort_order"
    )?;

    let mappings = stmt
        .query_map(rusqlite::params![source_id], |row| {
            Ok(super::mapper::FieldMapping {
                api_field:     row.get(0)?,
                local_field:   row.get(1)?,
                transform:     row.get(2)?,
                default_value: row.get(3)?,
                is_required:   row.get::<_, i64>(4)? == 1,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(mappings)
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
pub struct SyncResult {
    pub direction:   String,
    pub entity_type: String,
    pub processed:   usize,
    pub upserted:    usize,
    pub errors:      usize,
    pub message:     String,
}

impl SyncResult {
    fn skipped(msg: &str) -> Self {
        Self {
            direction:   String::new(),
            entity_type: String::new(),
            processed:   0,
            upserted:    0,
            errors:      0,
            message:     msg.to_string(),
        }
    }
}

struct SyncSourceConfig {
    id:            String,
    name:          String,
    direction:     String,
    entity_type:   String,
    base_url:      String,
    endpoint:      String,
    http_method:   String,
    auth_type:     String,
    api_key:       Option<String>,
    jwt_secret:    Option<String>,
    extra_headers: String,
    is_active:     bool,
}