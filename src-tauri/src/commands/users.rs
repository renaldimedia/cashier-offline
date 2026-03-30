// src/commands/users.rs
// Local users — DB supports unlimited, but app enforces max 1 per role (superadmin/manager/cashier)

use serde::{Deserialize, Serialize};
use tauri::State;
use tracing::info;
use uuid::Uuid;

use super::ApiResponse;
use crate::AppState;

#[derive(Debug, Deserialize, Default)]
pub struct UserQuery {
    // ── Pagination ───────────────────────────────────────────
    /// 1-based page number (default: 1)
    pub page: Option<i64>,
    /// Rows per page (default: 25, max: 200)
    pub per_page: Option<i64>,

    // ── Filters ──────────────────────────────────────────────
    /// Full-text search across name, sku, barcode (case-insensitive, LIKE %q%)
    pub search: Option<String>,
    pub status: Option<String>,
    pub sync_status: Option<String>,
    pub role: Option<String>,
    // ── Sort ─────────────────────────────────────────────────
    /// Column to sort by: invoice_no | created_at | total
    /// Default: "name"
    pub sort_by: Option<String>,
    /// "asc" | "desc" — default: "asc"
    pub sort_dir: Option<String>,
}

// Paginated response wrapper
#[derive(Debug, Serialize)]
pub struct UserPage {
    pub data: Vec<User>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
    pub total_pages: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct User {
    pub id: String,
    pub username: String,
    pub role: String,
    pub full_name: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateUserPayload {
    pub username: String,
    pub password: String,
    pub role: String,
    pub full_name: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserPayload {
    pub id: String,
    pub full_name: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordPayload {
    pub user_id: String,
    pub old_password: String,
    pub new_password: String,
}

fn row_to_user(row: &rusqlite::Row) -> rusqlite::Result<User> {
    Ok(User {
        id: row.get(0)?,
        username: row.get(1)?,
        role: row.get(2)?,
        full_name: row.get(3)?,
        is_active: row.get::<_, i64>(4)? == 1,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

/// Build the WHERE clause and its positional params from a [TransactionQuery].
/// Returns (where_sql, params_vec) where params are already in order.
///
/// We use a Vec<Box<dyn ToSql>> so every optional filter appends its value
/// right after appending its SQL fragment — keeping index alignment automatic.
fn build_where(q: &UserQuery) -> (String, Vec<Box<dyn rusqlite::ToSql>>) {
    let mut clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    let mut idx = 1usize; // SQLite positional param counter

    // ── Search: name LIKE %q% OR sku LIKE %q% OR barcode LIKE %q% ──────────
    if let Some(ref s) = q.search {
        if !s.trim().is_empty() {
            let pattern = format!("%{}%", s.trim());
            clauses.push(format!("(username LIKE ?{idx} OR full_name LIKE ?{idx})"));
            params.push(Box::new(pattern));
            idx += 1;
        }
    }

    // ── Role ────────────────────────────────────────────────────────────
    if let Some(ref role) = q.role {
        if !role.is_empty() {
            clauses.push(format!("role = ?{idx}"));
            params.push(Box::new(role.clone()));
            idx += 1;
        }
    }

    // ── Status ──────────────────────────────────────────────────────────────
    match q.status.as_deref() {
        Some("active") => {
            clauses.push(format!("p.is_active = ?{idx}"));
            params.push(Box::new(1i64));
            idx += 1;
        }
        Some("inactive") => {
            clauses.push(format!("p.is_active = ?{idx}"));
            params.push(Box::new(0i64));
            idx += 1;
        }
        _ => {}
    }

    // ── Sync status ─────────────────────────────────────────────────────────
    match q.sync_status.as_deref() {
        Some("synced") => {
            clauses.push("synced_at IS NOT NULL".into());
        }
        Some("local") => {
            clauses.push("synced_at IS NULL".into());
        }
        _ => {}
    }

    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };

    (where_sql, params)
}

/// Validate and return the ORDER BY clause from query params.
/// Allowlisted columns prevent SQL injection.
fn build_order(q: &UserQuery) -> String {
    let col = match q.sort_by.as_deref().unwrap_or("created_at") {
        "created_at" => "created_at",
        "username" => "username",
        "full_name" => "full_name",
        "is_active" => "is_active",
        "updated_at" => "updated_at",
        _ => "created_at", // safe default
    };
    let dir = match q.sort_dir.as_deref().unwrap_or("desc") {
        "desc" => "DESC",
        _ => "desc",
    };
    format!("ORDER BY {} {} NULLS LAST", col, dir)
}

#[tauri::command]
pub fn cmd_list_users(query: Option<UserQuery>, state: State<AppState>) -> ApiResponse<UserPage> {
    let _session = match state.session.require_role("superadmin") {
        Ok(s) => s,
        Err(e) => return ApiResponse::err(e.to_string()),
    };

    let q = query.unwrap_or_default();

    // ── Pagination ───────────────────────────────────────────────────────────
    let page = q.page.unwrap_or(1).max(1);
    let per_page = q.per_page.unwrap_or(25).clamp(1, 200);
    let offset = (page - 1) * per_page;

    // ── Build WHERE + ORDER ──────────────────────────────────────────────────
    let (where_sql, filter_params) = build_where(&q);
    let order_sql = build_order(&q);

    let db = state.db.master.lock().unwrap();

    // ── COUNT for total ──────────────────────────────────────────────────────
    let count_sql = format!("SELECT COUNT(*) FROM users {where_sql}");
    let count_param_refs: Vec<&dyn rusqlite::ToSql> =
        filter_params.iter().map(|p| p.as_ref()).collect();

    let total: i64 = match db
        .conn()
        .query_row(&count_sql, count_param_refs.as_slice(), |row| row.get(0))
    {
        Ok(n) => n,
        Err(e) => return ApiResponse::err(format!("Count query failed: {e}")),
    };

    let total_pages = ((total as f64) / (per_page as f64)).ceil() as i64;

    // ── Data query ───────────────────────────────────────────────────────────
    // Append LIMIT / OFFSET as the last two positional params.
    let param_count = filter_params.len();
    let limit_idx = param_count + 1;
    let offset_idx = param_count + 2;

    let data_sql = format!(
        "SELECT id,username,role,full_name,is_active,created_at,updated_at
         FROM users 
         {where_sql}
         {order_sql}
         LIMIT ?{limit_idx} OFFSET ?{offset_idx}"
    );

    // Rebuild param list (filter params + limit + offset)
    let mut all_params: Vec<Box<dyn rusqlite::ToSql>> = build_where(&q).1;
    all_params.push(Box::new(per_page));
    all_params.push(Box::new(offset));

    let all_refs: Vec<&dyn rusqlite::ToSql> = all_params.iter().map(|p| p.as_ref()).collect();

    let mut stmt = db.conn().prepare(&data_sql).unwrap();
    let rows: Vec<User> = stmt
        .query_map(all_refs.as_slice(), row_to_user)
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    ApiResponse::ok(UserPage {
        data: rows,
        total,
        page,
        per_page,
        total_pages,
    })
}

#[tauri::command]
pub fn cmd_create_user(payload: CreateUserPayload, state: State<AppState>) -> ApiResponse<User> {
    let _session = match state.session.require_role("superadmin") {
        Ok(s) => s,
        Err(e) => return ApiResponse::err(e.to_string()),
    };

    // Validate role
    let valid_roles = ["superadmin", "manager", "cashier"];
    if !valid_roles.contains(&payload.role.as_str()) {
        return ApiResponse::err(
            "Role tidak valid. Gunakan: superadmin, manager, atau cashier".to_string(),
        );
    }

    let db = state.db.master.lock().unwrap();

    // Enforce: max 1 active user per role (app-level constraint)
    let existing: i64 = db
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM users WHERE role = ?1 AND is_active = 1",
            rusqlite::params![payload.role],
            |r| r.get(0),
        )
        .unwrap_or(0);

    if existing >= 1 {
        return ApiResponse::err(format!(
            "Sudah ada pengguna aktif dengan role '{}'. Nonaktifkan dulu sebelum membuat yang baru.",
            payload.role
        ).to_string());
    }

    // Hash password
    let hash = match bcrypt::hash(&payload.password, 12) {
        Ok(h) => h,
        Err(e) => return ApiResponse::err(format!("Gagal hash password: {}", e).to_string()),
    };

    let valid = match bcrypt::hash("fuckT4ht!".to_string() + &payload.username, 12) {
        Ok(h) => h,
        Err(e) => return ApiResponse::err(format!("Gagal membuat validasi: {}", e).to_string()),
    };

    let id = format!("usr_{}", Uuid::new_v4().simple());
    let now = chrono::Local::now().to_rfc3339();

    match db.conn().execute(
        "INSERT INTO users(id,username,password,role,full_name,is_active,created_at,updated_at, valid)
         VALUES(?1,?2,?3,?4,?5,1,?6,?6,?7)",
        rusqlite::params![id, payload.username, hash, payload.role, payload.full_name, now,valid],
    ) {
        Ok(_) => {
            info!("User created: {} (role: {})", payload.username, payload.role);
            let user = db.conn().query_row(
                "SELECT id,username,role,full_name,is_active,created_at,updated_at FROM users WHERE id=?1",
                rusqlite::params![id], row_to_user
            ).unwrap();
            ApiResponse::ok(user)
        }
        Err(e) => {
            if e.to_string().contains("UNIQUE") {
                ApiResponse::err("Username sudah digunakan".to_string())
            } else {
                ApiResponse::err(format!("Gagal membuat user: {}", e).to_string())
            }
        }
    }
}

#[tauri::command]
pub fn cmd_update_user(payload: UpdateUserPayload, state: State<AppState>) -> ApiResponse<()> {
    let _session = match state.session.require_role("superadmin") {
        Ok(s) => s,
        Err(e) => return ApiResponse::err(e.to_string()),
    };

    let db = state.db.master.lock().unwrap();
    let _ = db.conn().execute(
        "UPDATE users
         SET full_name  = COALESCE(?1, full_name),
             is_active  = COALESCE(?2, is_active),
             updated_at = datetime('now')
         WHERE id = ?3",
        rusqlite::params![
            payload.full_name,
            payload.is_active.map(|b| if b { 1i64 } else { 0i64 }),
            payload.id
        ],
    );

    ApiResponse::ok(())
}

#[tauri::command]
pub fn cmd_delete_user(id: String, state: State<AppState>) -> ApiResponse<()> {
    let session = match state.session.require_role("superadmin") {
        Ok(s) => s,
        Err(e) => return ApiResponse::err(e.to_string()),
    };

    // Cannot delete yourself
    if session.user_id == id {
        return ApiResponse::err("Tidak bisa menghapus akun sendiri".to_string());
    }

    let db = state.db.master.lock().unwrap();
    let _ = db.conn().execute(
        "UPDATE users SET is_active = 0, updated_at = datetime('now') WHERE id = ?1",
        rusqlite::params![id],
    );

    info!("User {} deactivated by {}", id, session.username);
    ApiResponse::ok(())
}

#[tauri::command]
pub fn cmd_change_password(
    payload: ChangePasswordPayload,
    state: State<AppState>,
) -> ApiResponse<()> {
    let session = match state.session.require_role("cashier") {
        Ok(s) => s,
        Err(e) => return ApiResponse::err(e.to_string()),
    };

    // Users can only change their own password unless superadmin
    if session.user_id != payload.user_id && !matches!(session.role, crate::auth::Role::Superadmin)
    {
        return ApiResponse::err("Tidak diizinkan mengubah password user lain".to_string());
    }

    let db = state.db.master.lock().unwrap();

    // Verify old password
    let hash: String = match db.conn().query_row(
        "SELECT password FROM users WHERE id = ?1",
        rusqlite::params![payload.user_id],
        |r| r.get(0),
    ) {
        Ok(h) => h,
        Err(_) => return ApiResponse::err("User tidak ditemukan".to_string()),
    };

    match bcrypt::verify(&payload.old_password, &hash) {
        Ok(true) => {}
        _ => return ApiResponse::err("Password lama tidak sesuai".to_string()),
    }

    let new_hash = match bcrypt::hash(&payload.new_password, 12) {
        Ok(h) => h,
        Err(e) => return ApiResponse::err(format!("Gagal hash password: {}", e).to_string()),
    };

    let _ = db.conn().execute(
        "UPDATE users SET password = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![new_hash, payload.user_id],
    );

    info!("Password changed for user {}", payload.user_id);
    ApiResponse::ok(())
}
