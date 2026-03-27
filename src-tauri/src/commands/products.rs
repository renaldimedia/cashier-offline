// src/commands/products.rs

use serde::{Deserialize, Serialize};
use tauri::State;
use tracing::{info, debug, error};
use uuid::Uuid;

use crate::AppState;
use super::ApiResponse;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Product {
    pub id:          String,
    pub sku:         String,
    pub barcode:     Option<String>,
    pub name:        String,
    pub description: String,
    pub category_id: Option<String>,
    pub price:       f64,
    pub cost:        f64,
    pub stock:       i64,
    pub stock_min:   i64,
    pub unit:        String,
    pub image_path:  Option<String>,
    pub is_active:   bool,
    pub ext_id:      Option<String>,
    pub synced_at:   Option<String>,
    pub created_at:  String,
    pub updated_at:  String,
}

#[derive(Debug, Deserialize)]
pub struct CreateProductPayload {
    pub sku:         String,
    pub barcode:     Option<String>,
    pub name:        String,
    pub description: Option<String>,
    pub category_id: Option<String>,
    pub price:       f64,
    pub cost:        Option<f64>,
    pub stock:       Option<i64>,
    pub stock_min:   Option<i64>,
    pub unit:        Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProductPayload {
    pub id:          String,
    pub sku:         Option<String>,
    pub barcode:     Option<String>,
    pub name:        Option<String>,
    pub description: Option<String>,
    pub category_id: Option<String>,
    pub price:       Option<f64>,
    pub cost:        Option<f64>,
    pub stock:       Option<i64>,
    pub stock_min:   Option<i64>,
    pub unit:        Option<String>,
    pub is_active:   Option<bool>,
}

fn row_to_product(row: &rusqlite::Row) -> rusqlite::Result<Product> {
    Ok(Product {
        id:          row.get(0)?,
        sku:         row.get(1)?,
        barcode:     row.get(2)?,
        name:        row.get(3)?,
        description: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
        category_id: row.get(5)?,
        price:       row.get(6)?,
        cost:        row.get(7)?,
        stock:       row.get(8)?,
        stock_min:   row.get(9)?,
        unit:        row.get(10)?,
        image_path:  row.get(11)?,
        is_active:   row.get::<_, i64>(12)? == 1,
        ext_id:      row.get(13)?,
        synced_at:   row.get(14)?,
        created_at:  row.get(15)?,
        updated_at:  row.get(16)?,
    })
}

#[tauri::command]
pub fn cmd_list_products(
    active_only: Option<bool>,
    state: State<AppState>,
) -> ApiResponse<Vec<Product>> {
    let _session = match state.session.require_role("cashier") {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    let db = state.db.master.lock().unwrap();
    let filter = if active_only.unwrap_or(true) { "WHERE p.is_active = 1" } else { "" };
    let sql = format!(
        "SELECT id,sku,barcode,name,description,category_id,price,cost,
                stock,stock_min,unit,image_path,is_active,ext_id,synced_at,
                created_at,updated_at
         FROM products p {} ORDER BY name ASC", filter
    );

    let mut stmt = match db.conn().prepare(&sql) {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    let products: Vec<Product> = stmt
        .query_map([], row_to_product)
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    ApiResponse::ok(products)
}

#[tauri::command]
pub fn cmd_get_product(id: String, state: State<AppState>) -> ApiResponse<Product> {
    let _session = match state.session.require_role("cashier") {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    let db = state.db.master.lock().unwrap();
    let result = db.conn().query_row(
        "SELECT id,sku,barcode,name,description,category_id,price,cost,
                stock,stock_min,unit,image_path,is_active,ext_id,synced_at,
                created_at,updated_at
         FROM products WHERE id = ?1",
        rusqlite::params![id],
        row_to_product,
    );

    match result {
        Ok(p)  => ApiResponse::ok(p),
        Err(_) => ApiResponse::err("Produk tidak ditemukan".to_string()),
    }
}

#[tauri::command]
pub fn cmd_search_products(query: String, state: State<AppState>) -> ApiResponse<Vec<Product>> {
    let _session = match state.session.require_role("cashier") {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    let db = state.db.master.lock().unwrap();
    let pattern = format!("%{}%", query);

    let mut stmt = db.conn().prepare(
        "SELECT id,sku,barcode,name,description,category_id,price,cost,
                stock,stock_min,unit,image_path,is_active,ext_id,synced_at,
                created_at,updated_at
         FROM products
         WHERE is_active = 1
           AND (name LIKE ?1 OR sku LIKE ?1 OR barcode = ?2)
         ORDER BY name ASC LIMIT 50",
    ).unwrap();

    let products: Vec<Product> = stmt
        .query_map(rusqlite::params![pattern, query], row_to_product)
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    ApiResponse::ok(products)
}
#[tauri::command]
pub fn cmd_create_product(
    payload: CreateProductPayload,
    state: State<AppState>,
) -> ApiResponse<Product> {
    let _session = match state.session.require_role("manager") {
        Ok(s) => s,
        Err(e) => return ApiResponse::err(e.to_string()),
    };

    let id = format!("prd_{}", uuid::Uuid::new_v4().simple());
    let now = chrono::Local::now().to_rfc3339();

    let exec_result = {
        let db = state.db.master.lock().unwrap();

        db.conn().execute(
            "INSERT INTO products
               (id,sku,barcode,name,description,category_id,price,cost,stock,stock_min,unit,is_active,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,1,?12,?12)",
            rusqlite::params![
                id,
                payload.sku,
                payload.barcode,
                payload.name,
                payload.description.unwrap_or_default(),
                payload.category_id,
                payload.price,
                payload.cost.unwrap_or(0.0),
                payload.stock.unwrap_or(0),
                payload.stock_min.unwrap_or(0),
                payload.unit.unwrap_or_else(|| "pcs".into()),
                now
            ],
        )
    };

    match exec_result {
        Ok(_) => {
            info!(
                "Product created successfully: id={}, name={}",
                id, payload.name
            );
            cmd_get_product(id, state)
        }
        Err(e) => {
            // 🔥 log lebih detail
            error!(
                "FAILED create product | id={} | name={} | error={}",
                id,
                payload.name,
                e
            );

            // optional: debug payload (hati-hati kalau sensitif)
            debug!(
                "Payload create product: sku={:?}, barcode={:?}, category_id={:?}",
                payload.sku,
                payload.barcode,
                payload.category_id
            );

            ApiResponse::err(format!("Gagal membuat produk: {}", e))
        }
    }
}
#[tauri::command]
pub fn cmd_update_product(
    payload: UpdateProductPayload,
    state: State<AppState>,
) -> ApiResponse<Product> {
    let _session = match state.session.require_role("manager") {
        Ok(s) => s,
        Err(e) => return ApiResponse::err(e.to_string()),
    };

    let now = chrono::Local::now().to_rfc3339();

    // Build dynamic update
    let mut sets = vec!["updated_at = ?1".to_string()];
    let mut idx = 2usize;

    macro_rules! add_field {
        ($opt:expr, $col:literal) => {
            if $opt.is_some() {
                sets.push(format!("{} = ?{}", $col, idx));
                idx += 1;
            }
        };
    }

    add_field!(payload.sku, "sku");
    add_field!(payload.barcode, "barcode");
    add_field!(payload.name, "name");
    add_field!(payload.description, "description");
    add_field!(payload.category_id, "category_id");
    add_field!(payload.price, "price");
    add_field!(payload.cost, "cost");
    add_field!(payload.stock, "stock");
    add_field!(payload.stock_min, "stock_min");
    add_field!(payload.unit, "unit");
    add_field!(payload.is_active, "is_active");

    let id_placeholder = format!("?{}", idx);

    let sql = format!(
        "UPDATE products SET {} WHERE id = {}",
        sets.join(", "),
        id_placeholder
    );

    // 🔥 scope block biar db & stmt auto drop
    let exec_result = {
        let db = state.db.master.lock().unwrap();

        let mut stmt = db.conn().prepare(&sql).unwrap();

        let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(now)];

        macro_rules! push_param {
            ($opt:expr) => {
                if let Some(v) = $opt {
                    params.push(Box::new(v));
                }
            };
        }

        push_param!(payload.sku);
        push_param!(payload.barcode);
        push_param!(payload.name);
        push_param!(payload.description);
        push_param!(payload.category_id.clone());
        push_param!(payload.price);
        push_param!(payload.cost);
        push_param!(payload.stock);
        push_param!(payload.stock_min);
        push_param!(payload.unit);
        push_param!(payload.is_active.map(|b| if b { 1i64 } else { 0i64 }));

        params.push(Box::new(payload.id.clone()));

        let params_refs: Vec<&dyn rusqlite::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();

        stmt.execute(params_refs.as_slice())
    }; // ✅ db & stmt drop di sini (lock release)

    if let Err(e) = exec_result {
        return ApiResponse::err(format!("Gagal update produk: {}", e));
    }

    // 🔥 sekarang aman (lock sudah dilepas)
    cmd_get_product(payload.id, state)
}

#[tauri::command]
pub fn cmd_delete_product(id: String, state: State<AppState>) -> ApiResponse<()> {
    let _session = match state.session.require_role("superadmin") {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    let db = state.db.master.lock().unwrap();
    // Soft delete
    match db.conn().execute(
        "UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?1",
        rusqlite::params![id],
    ) {
        Ok(_) => { info!("Product soft-deleted: {}", id); ApiResponse::ok(()) }
        Err(e) => ApiResponse::err(e.to_string()),
    }
}