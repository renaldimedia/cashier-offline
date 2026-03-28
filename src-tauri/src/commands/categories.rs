// src/commands/categories.rs
use super::ApiResponse;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Deserialize, Default)]
pub struct CategoryQuery {
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
pub struct CategoryPage {
    pub data: Vec<Category>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
    pub total_pages: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub description: String,
    pub sort_order: i64,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CategoryPayload {
    pub name: String,
    pub description: Option<String>,
    pub sort_order: Option<i64>,
}

fn row_to_category(row: &rusqlite::Row) -> rusqlite::Result<Category> {
    // id,name,description,sort_order,is_active,created_at,updated_at
    Ok(Category {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        sort_order: row.get(3)?,
        is_active: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

/// Build the WHERE clause and its positional params from a [TransactionQuery].
/// Returns (where_sql, params_vec) where params are already in order.
///
/// We use a Vec<Box<dyn ToSql>> so every optional filter appends its value
/// right after appending its SQL fragment — keeping index alignment automatic.
fn build_where(q: &CategoryQuery) -> (String, Vec<Box<dyn rusqlite::ToSql>>) {
    let mut clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    let mut idx = 1usize; // SQLite positional param counter

    // ── Search: name LIKE %q% OR sku LIKE %q% OR barcode LIKE %q% ──────────
    if let Some(ref s) = q.search {
        if !s.trim().is_empty() {
            let pattern = format!("%{}%", s.trim());
            clauses.push(format!(
                "(name LIKE ?{idx} OR description LIKE ?{idx})"
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
fn build_order(q: &CategoryQuery) -> String {
    let col = match q.sort_by.as_deref().unwrap_or("sort_order") {
        "name" => "name",
        "description" => "description",
        "sort_order" => "sort_order",
        "total" => "total",

        "created_at" => "created_at",
        "updated_at" => "updated_at",
        _ => "sort_order", // safe default
    };
    let dir = match q.sort_dir.as_deref().unwrap_or("desc") {
        "desc" => "DESC",
        _ => "desc",
    };
    format!("ORDER BY {} {} NULLS LAST", col, dir)
}

#[tauri::command]
pub fn cmd_list_categories(
    query: Option<CategoryQuery>,
    state: State<AppState>,
) -> ApiResponse<CategoryPage> {
    let _s = match state.session.require_role("cashier") {
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
    let count_sql = format!("SELECT COUNT(*) FROM categories p {where_sql}");
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
        "SELECT id,name,description,sort_order,is_active,created_at,updated_at FROM categories 
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
    let rows: Vec<Category> = stmt
        .query_map(all_refs.as_slice(), row_to_category)
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    
    ApiResponse::ok(CategoryPage {
        data: rows,
        total,
        page,
        per_page,
        total_pages,
    })
}

#[tauri::command]
pub fn cmd_create_category(
    payload: CategoryPayload,
    state: State<AppState>,
) -> ApiResponse<String> {
    let _s = match state.session.require_role("manager") {
        Ok(s) => s,
        Err(e) => return ApiResponse::err(e.to_string()),
    };
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
pub fn cmd_update_category(
    id: String,
    payload: CategoryPayload,
    state: State<AppState>,
) -> ApiResponse<()> {
    let _s = match state.session.require_role("manager") {
        Ok(s) => s,
        Err(e) => return ApiResponse::err(e.to_string()),
    };
    let db = state.db.master.lock().unwrap();
    let _ = db.conn().execute(
        "UPDATE categories SET name=?1,description=?2,sort_order=?3,updated_at=datetime('now') WHERE id=?4",
        rusqlite::params![payload.name, payload.description.unwrap_or_default(), payload.sort_order.unwrap_or(0), id]
    );
    ApiResponse::ok(())
}

#[tauri::command]
pub fn cmd_delete_category(id: String, state: State<AppState>) -> ApiResponse<()> {
    let _s = match state.session.require_role("manager") {
        Ok(s) => s,
        Err(e) => return ApiResponse::err(e.to_string()),
    };
    let db = state.db.master.lock().unwrap();
    let _ = db.conn().execute(
        "UPDATE categories SET is_active=0 WHERE id=?1",
        rusqlite::params![id],
    );
    ApiResponse::ok(())
}
