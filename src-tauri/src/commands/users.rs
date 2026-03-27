// src/commands/users.rs
// Local users — DB supports unlimited, but app enforces max 1 per role (superadmin/manager/cashier)

use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;
use tracing::info;

use crate::AppState;
use super::ApiResponse;

#[derive(Debug, Serialize, Clone)]
pub struct User {
    pub id:         String,
    pub username:   String,
    pub role:       String,
    pub full_name:  String,
    pub is_active:  bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateUserPayload {
    pub username:  String,
    pub password:  String,
    pub role:      String,
    pub full_name: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserPayload {
    pub id:        String,
    pub full_name: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordPayload {
    pub user_id:      String,
    pub old_password: String,
    pub new_password: String,
}

fn row_to_user(row: &rusqlite::Row) -> rusqlite::Result<User> {
    Ok(User {
        id:         row.get(0)?,
        username:   row.get(1)?,
        role:       row.get(2)?,
        full_name:  row.get(3)?,
        is_active:  row.get::<_, i64>(4)? == 1,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

#[tauri::command]
pub fn cmd_list_users(state: State<AppState>) -> ApiResponse<Vec<User>> {
    let _session = match state.session.require_role("superadmin") {
        Ok(s) => s, Err(e) => return ApiResponse::<Vec<User>>::err(e.to_string()),
    };

    let db = state.db.master.lock().unwrap();
    let mut stmt = db.conn().prepare(
        "SELECT id,username,role,full_name,is_active,created_at,updated_at
         FROM users ORDER BY role, username"
    ).unwrap();

    let users: Vec<User> = stmt
        .query_map([], row_to_user)
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    ApiResponse::ok(users)
}

#[tauri::command]
pub fn cmd_create_user(
    payload: CreateUserPayload,
    state: State<AppState>,
) -> ApiResponse<User> {
    let _session = match state.session.require_role("superadmin") {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    // Validate role
    let valid_roles = ["superadmin", "manager", "cashier"];
    if !valid_roles.contains(&payload.role.as_str()) {
        return ApiResponse::err("Role tidak valid. Gunakan: superadmin, manager, atau cashier".to_string());
    }

    let db = state.db.master.lock().unwrap();

    // Enforce: max 1 active user per role (app-level constraint)
    let existing: i64 = db.conn().query_row(
        "SELECT COUNT(*) FROM users WHERE role = ?1 AND is_active = 1",
        rusqlite::params![payload.role],
        |r| r.get(0),
    ).unwrap_or(0);

    if existing >= 1 {
        return ApiResponse::err(format!(
            "Sudah ada pengguna aktif dengan role '{}'. Nonaktifkan dulu sebelum membuat yang baru.",
            payload.role
        ).to_string());
    }

    // Hash password
    let hash = match bcrypt::hash(&payload.password, 12) {
        Ok(h)  => h,
        Err(e) => return ApiResponse::err(format!("Gagal hash password: {}", e).to_string()),
    };

    let id = format!("usr_{}", Uuid::new_v4().simple());
    let now = chrono::Local::now().to_rfc3339();

    match db.conn().execute(
        "INSERT INTO users(id,username,password,role,full_name,is_active,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,1,?6,?6)",
        rusqlite::params![id, payload.username, hash, payload.role, payload.full_name, now],
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
pub fn cmd_update_user(
    payload: UpdateUserPayload,
    state: State<AppState>,
) -> ApiResponse<()> {
    let _session = match state.session.require_role("superadmin") {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
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
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
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
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    // Users can only change their own password unless superadmin
    if session.user_id != payload.user_id
        && !matches!(session.role, crate::auth::Role::Superadmin)
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
        Ok(h)  => h,
        Err(_) => return ApiResponse::err("User tidak ditemukan".to_string()),
    };

    match bcrypt::verify(&payload.old_password, &hash) {
        Ok(true) => {}
        _ => return ApiResponse::err("Password lama tidak sesuai".to_string()),
    }

    let new_hash = match bcrypt::hash(&payload.new_password, 12) {
        Ok(h)  => h,
        Err(e) => return ApiResponse::err(format!("Gagal hash password: {}", e).to_string()),
    };

    let _ = db.conn().execute(
        "UPDATE users SET password = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![new_hash, payload.user_id],
    );

    info!("Password changed for user {}", payload.user_id);
    ApiResponse::ok(())
}