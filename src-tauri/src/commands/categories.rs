// src/commands/categories.rs
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;
use crate::AppState;
use super::ApiResponse;

#[derive(Debug, Serialize, Deserialize)]
pub struct Category {
    pub id: String, pub name: String, pub description: String,
    pub sort_order: i64, pub is_active: bool,
    pub created_at: String, pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CategoryPayload { pub name: String, pub description: Option<String>, pub sort_order: Option<i64> }

#[tauri::command]
pub fn cmd_list_categories(state: State<AppState>) -> ApiResponse<Vec<Category>> {
    let _s = match state.session.require_role("cashier") { Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()) };
    let db = state.db.master.lock().unwrap();
    let mut stmt = db.conn().prepare(
        "SELECT id,name,description,sort_order,is_active,created_at,updated_at FROM categories WHERE is_active=1 ORDER BY sort_order,name"
    ).unwrap();
    let cats: Vec<Category> = stmt.query_map([], |row| Ok(Category {
        id: row.get(0)?, name: row.get(1)?,
        description: row.get::<_,Option<String>>(2)?.unwrap_or_default(),
        sort_order: row.get(3)?, is_active: row.get::<_,i64>(4)?==1,
        created_at: row.get(5)?, updated_at: row.get(6)?,
    })).unwrap().filter_map(|r| r.ok()).collect();
    ApiResponse::ok(cats)
}

#[tauri::command]
pub fn cmd_create_category(payload: CategoryPayload, state: State<AppState>) -> ApiResponse<String> {
    let _s = match state.session.require_role("manager") { Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()) };
    let id = format!("cat_{}", Uuid::new_v4().simple());
    let now = chrono::Local::now().to_rfc3339();
    let db = state.db.master.lock().unwrap();
    match db.conn().execute(
        "INSERT INTO categories(id,name,description,sort_order,is_active,created_at,updated_at) VALUES(?1,?2,?3,?4,1,?5,?5)",
        rusqlite::params![id, payload.name, payload.description.unwrap_or_default(), payload.sort_order.unwrap_or(0), now]
    ) {
        Ok(_) => ApiResponse::ok("Berhasil membuat kategori!".to_string()), Err(e) => ApiResponse::err(e.to_string())
    }
}

#[tauri::command]
pub fn cmd_update_category(id: String, payload: CategoryPayload, state: State<AppState>) -> ApiResponse<()> {
    let _s = match state.session.require_role("manager") { Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()) };
    let db = state.db.master.lock().unwrap();
    let _ = db.conn().execute(
        "UPDATE categories SET name=?1,description=?2,sort_order=?3,updated_at=datetime('now') WHERE id=?4",
        rusqlite::params![payload.name, payload.description.unwrap_or_default(), payload.sort_order.unwrap_or(0), id]
    );
    ApiResponse::ok(())
}

#[tauri::command]
pub fn cmd_delete_category(id: String, state: State<AppState>) -> ApiResponse<()> {
    let _s = match state.session.require_role("manager") { Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()) };
    let db = state.db.master.lock().unwrap();
    let _ = db.conn().execute("UPDATE categories SET is_active=0 WHERE id=?1", rusqlite::params![id]);
    ApiResponse::ok(())
}