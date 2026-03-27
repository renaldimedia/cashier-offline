// src/commands/customers.rs
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;
use crate::AppState;
use super::ApiResponse;

#[derive(Debug, Serialize)] pub struct Customer {
    pub id: String, pub name: String, pub phone: Option<String>,
    pub email: Option<String>, pub address: String, pub notes: String,
    pub is_active: bool, pub created_at: String, pub updated_at: String,
}
#[derive(Debug, Deserialize)] pub struct CustomerPayload {
    pub name: String, pub phone: Option<String>, pub email: Option<String>,
    pub address: Option<String>, pub notes: Option<String>,
}

#[tauri::command]
pub fn cmd_list_customers(query: Option<String>, state: State<AppState>) -> ApiResponse<Vec<Customer>> {
    let _s = match state.session.require_role("cashier") { Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()) };
    let db = state.db.master.lock().unwrap();
    let pattern = format!("%{}%", query.unwrap_or_default());
    let mut stmt = db.conn().prepare(
        "SELECT id,name,phone,email,address,notes,is_active,created_at,updated_at
         FROM customers WHERE is_active=1 AND (name LIKE ?1 OR phone LIKE ?1) ORDER BY name LIMIT 50"
    ).unwrap();
    let list: Vec<Customer> = stmt.query_map(rusqlite::params![pattern], |row| Ok(Customer {
        id: row.get(0)?, name: row.get(1)?, phone: row.get(2)?, email: row.get(3)?,
        address: row.get::<_,Option<String>>(4)?.unwrap_or_default(),
        notes: row.get::<_,Option<String>>(5)?.unwrap_or_default(),
        is_active: row.get::<_,i64>(6)?==1, created_at: row.get(7)?, updated_at: row.get(8)?,
    })).unwrap().filter_map(|r|r.ok()).collect();
    ApiResponse::ok(list)
}

#[tauri::command]
pub fn cmd_create_customer(payload: CustomerPayload, state: State<AppState>) -> ApiResponse<String> {
    let _s = match state.session.require_role("cashier") { Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()) };
    let id = format!("cus_{}", Uuid::new_v4().simple());
    let now = chrono::Local::now().to_rfc3339();
    let db = state.db.master.lock().unwrap();
    match db.conn().execute(
        "INSERT INTO customers(id,name,phone,email,address,notes,is_active,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,1,?7,?7)",
        rusqlite::params![id, payload.name, payload.phone, payload.email,
            payload.address.unwrap_or_default(), payload.notes.unwrap_or_default(), now]
    ) { Ok(_) => ApiResponse::ok(id), Err(e) => ApiResponse::err(e.to_string()) }
}

#[tauri::command]
pub fn cmd_update_customer(id: String, payload: CustomerPayload, state: State<AppState>) -> ApiResponse<()> {
    let _s = match state.session.require_role("cashier") { Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()) };
    let db = state.db.master.lock().unwrap();
    let _ = db.conn().execute(
        "UPDATE customers SET name=?1,phone=?2,email=?3,address=?4,notes=?5,updated_at=datetime('now') WHERE id=?6",
        rusqlite::params![payload.name, payload.phone, payload.email,
            payload.address.unwrap_or_default(), payload.notes.unwrap_or_default(), id]
    );
    ApiResponse::ok(())
}