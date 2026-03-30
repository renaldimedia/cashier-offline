// src/commands/customers.rs
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;
use crate::{AppState};
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


#[derive(Debug, Deserialize, Default)]
pub struct CustomerQuery {
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
    // ── Sort ─────────────────────────────────────────────────
    /// Column to sort by: invoice_no | created_at | total
    /// Default: "name"
    pub sort_by: Option<String>,
    /// "asc" | "desc" — default: "asc"
    pub sort_dir: Option<String>,
}

// Paginated response wrapper
#[derive(Debug, Serialize)]
pub struct CustomerPage {
    pub data: Vec<Customer>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
    pub total_pages: i64,
}


fn row_to_customer(row: &rusqlite::Row) -> rusqlite::Result<Customer> {
    // id,name,phone,email,address,notes,is_active,created_at,updated_at
    Ok(Customer {
        id: row.get(0)?,
        name: row.get(1)?,
        phone: row.get(2)?,
        email: row.get(3)?,
        address: row.get(4)?,
        notes: row.get(5)?,
        is_active: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

/// Build the WHERE clause and its positional params from a [TransactionQuery].
/// Returns (where_sql, params_vec) where params are already in order.
///
/// We use a Vec<Box<dyn ToSql>> so every optional filter appends its value
/// right after appending its SQL fragment — keeping index alignment automatic.
fn build_where(q: &CustomerQuery) -> (String, Vec<Box<dyn rusqlite::ToSql>>) {
    let mut clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    let mut idx = 1usize; // SQLite positional param counter

    // ── Search: name LIKE %q% OR sku LIKE %q% OR barcode LIKE %q% ──────────
    if let Some(ref s) = q.search {
        if !s.trim().is_empty() {
            let pattern = format!("%{}%", s.trim());
            clauses.push(format!(
                "(name LIKE ?{idx} OR phone LIKE ?{idx} OR email LIKE ?{idx} OR address LIKE ?{idx} OR notes LIKE ?{idx})"
            ));
            params.push(Box::new(pattern));
            idx += 1;
        }
    }

    // ── Status ──────────────────────────────────────────────────────────────
    match q.status.as_deref() {
        Some("active")   => { clauses.push(format!("p.is_active = ?{idx}")); params.push(Box::new(1i64)); idx += 1; }
        Some("inactive") => { clauses.push(format!("p.is_active = ?{idx}")); params.push(Box::new(0i64)); idx += 1; }
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
fn build_order(q: &CustomerQuery) -> String {
    let col = match q.sort_by.as_deref().unwrap_or("created_at") {

        "name" => "name",
        "phone" => "phone",
        "email" => "email",
        "address" => "address",
        "notes" => "notes",
        "is_active" => "is_active",
        "created_at" => "created_at",
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
pub fn cmd_list_customers(query: Option<CustomerQuery>, state: State<AppState>) -> ApiResponse<CustomerPage> {
    let _s = match state.session.require_role("cashier") { Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()) };

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
    let count_sql = format!("SELECT COUNT(*) FROM customers {where_sql}");
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
        "SELECT id,name,phone,email,address,notes,is_active,created_at,updated_at
         FROM customers
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
    let rows: Vec<Customer> = stmt
        .query_map(all_refs.as_slice(), row_to_customer)
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    
    ApiResponse::ok(CustomerPage {
        data: rows,
        total,
        page,
        per_page,
        total_pages,
    })
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