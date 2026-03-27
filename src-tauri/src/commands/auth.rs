// src/commands/auth.rs

use serde::{Deserialize, Serialize};
use tauri::State;
use tracing::{info, warn};

use crate::auth::Session;
use crate::AppState;
use super::ApiResponse;

#[derive(Debug, Deserialize)]
pub struct LoginPayload {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResult {
    pub session: Session,
}

#[tauri::command]
pub fn cmd_login(
    payload: LoginPayload,
    state: State<AppState>,
) -> Result<ApiResponse<LoginResult>, String> {
    let db = state.db.master.lock().unwrap();

    // Fetch user by username
    let result = db.conn().query_row(
        "SELECT id, username, password, role, full_name
         FROM users WHERE username = ?1 AND is_active = 1",
        rusqlite::params![payload.username],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        },
    );

    match result {
        Ok((id, username, hash, role, full_name)) => {
            // Verify password
            match bcrypt::verify(&payload.password, &hash) {
                Ok(true) => {
                    let role_enum = crate::auth::Role::from_str(&role)
                        .ok_or("Invalid role in database")?;

                    let session = Session {
                        user_id:      id,
                        username:     username.clone(),
                        full_name,
                        role:         role_enum,
                        logged_in_at: chrono::Local::now().to_rfc3339(),
                    };

                    state.session.set(session.clone());
                    info!("User '{}' logged in (role: {})", username, role);

                    Ok(ApiResponse::ok(LoginResult { session }))
                }
                Ok(false) | Err(_) => {
                    warn!("Failed login attempt for username '{}'", payload.username);
                    Ok(ApiResponse::err("Username atau password salah".to_string()))
                }
            }
        }
        Err(_) => {
            warn!("Login attempt for unknown user '{}'", payload.username);
            Ok(ApiResponse::err("Username atau password salah".to_string()))
        }
    }
}

#[tauri::command]
pub fn cmd_logout(state: State<AppState>) -> ApiResponse<()> {
    if let Some(s) = state.session.get() {
        info!("User '{}' logged out", s.username);
    }
    state.session.clear();
    ApiResponse::ok(())
}

#[tauri::command]
pub fn cmd_get_session(state: State<AppState>) -> ApiResponse<Session> {
    match state.session.get() {
        Some(s) => ApiResponse::ok(s),
        None    => ApiResponse::err("Not authenticated".to_string()),
    }
}