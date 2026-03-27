// src/commands/transactions.rs

use serde::{Deserialize, Serialize};
use tauri::State;
use tracing::info;
use uuid::Uuid;

use crate::AppState;
use super::ApiResponse;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TransactionItem {
    pub product_id:      String,
    pub product_sku:     String,
    pub product_name:    String,
    pub qty:             i64,
    pub unit:            String,
    pub unit_price:      f64,
    pub discount_pct:    f64,
    pub discount_amount: f64,
    pub total:           f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Payment {
    pub method:       String,
    pub amount:       f64,
    pub change_amount: f64,
    pub reference_no: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Transaction {
    pub id:              String,
    pub invoice_no:      String,
    pub cashier_id:      String,
    pub cashier_name:    String,
    pub customer_id:     Option<String>,
    pub customer_name:   Option<String>,
    pub subtotal:        f64,
    pub discount_amount: f64,
    pub tax_amount:      f64,
    pub total:           f64,
    pub paid_amount:     f64,
    pub change_amount:   f64,
    pub status:          String,
    pub notes:           String,
    pub created_at:      String,
    pub items:           Vec<TransactionItem>,
    pub payments:        Vec<Payment>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTransactionPayload {
    pub customer_id:     Option<String>,
    pub customer_name:   Option<String>,
    pub discount_amount: Option<f64>,
    pub tax_rate:        Option<f64>,
    pub notes:           Option<String>,
    pub items:           Vec<TransactionItemPayload>,
    pub payments:        Vec<Payment>,
}

#[derive(Debug, Deserialize)]
pub struct TransactionItemPayload {
    pub product_id:   String,
    pub qty:          i64,
    pub unit_price:   f64,
    pub discount_pct: Option<f64>,
}

#[tauri::command]
pub fn cmd_create_transaction(
    payload: CreateTransactionPayload,
    state: State<AppState>,
) -> ApiResponse<Transaction> {
    let session = match state.session.require_role("cashier") {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    // Ensure we're on the right monthly DB
    if let Err(e) = state.db.ensure_current_tx_db() {
        return ApiResponse::err(format!("DB rotation error: {}", e));
    }

    let tx_db = state.db.transactional.lock().unwrap();
    let master_db = state.db.master.lock().unwrap();

    let tx_id = format!("tx_{}", Uuid::new_v4().simple());
    let invoice_no = match tx_db.next_invoice_no() {
        Ok(n) => n, Err(e) => return ApiResponse::err(e.to_string()),
    };
    let now = chrono::Local::now().to_rfc3339();

    // Calculate totals
    let mut subtotal = 0f64;
    let mut enriched_items: Vec<TransactionItem> = Vec::new();

    for item in &payload.items {
        // Fetch product info (snapshot at time of sale)
        let product = master_db.conn().query_row(
            "SELECT sku, name, unit FROM products WHERE id = ?1",
            rusqlite::params![item.product_id],
            |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            )),
        );

        let (sku, name, unit) = match product {
            Ok(p) => p,
            Err(_) => return ApiResponse::err(format!("Produk {} tidak ditemukan", item.product_id)),
        };

        let disc_pct = item.discount_pct.unwrap_or(0.0);
        let disc_amount = item.unit_price * (disc_pct / 100.0) * item.qty as f64;
        let line_total = (item.unit_price * item.qty as f64) - disc_amount;
        subtotal += line_total;

        enriched_items.push(TransactionItem {
            product_id: item.product_id.clone(),
            product_sku: sku,
            product_name: name,
            qty: item.qty,
            unit,
            unit_price: item.unit_price,
            discount_pct: disc_pct,
            discount_amount: disc_amount,
            total: line_total,
        });
    }

    let discount_amount = payload.discount_amount.unwrap_or(0.0);
    let tax_rate = payload.tax_rate.unwrap_or(0.0);
    let after_discount = subtotal - discount_amount;
    let tax_amount = after_discount * (tax_rate / 100.0);
    let total = after_discount + tax_amount;
    let paid_amount: f64 = payload.payments.iter().map(|p| p.amount).sum();
    let change_amount = paid_amount - total;

    let notes = payload.notes.clone().unwrap_or_default();

    // Insert transaction
    let result = tx_db.conn().execute(
        "INSERT INTO transactions
           (id,invoice_no,cashier_id,cashier_name,customer_id,customer_name,
            subtotal,discount_amount,tax_amount,total,paid_amount,change_amount,
            status,notes,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'completed',?13,?14,?14)",
        rusqlite::params![
            tx_id, invoice_no,
            session.user_id, session.full_name,
            payload.customer_id, payload.customer_name,
            subtotal, discount_amount, tax_amount, total,
            paid_amount, change_amount,
            payload.notes.unwrap_or_default(), now
        ],
    );

    if let Err(e) = result {
        return ApiResponse::err(format!("Gagal menyimpan transaksi: {}", e));
    }

    // Insert items
    for item in &enriched_items {
        let item_id = format!("txi_{}", Uuid::new_v4().simple());
        let _ = tx_db.conn().execute(
            "INSERT INTO transaction_items
               (id,transaction_id,product_id,product_sku,product_name,
                qty,unit,unit_price,discount_pct,discount_amount,total)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            rusqlite::params![
                item_id, tx_id, item.product_id, item.product_sku, item.product_name,
                item.qty, item.unit, item.unit_price, item.discount_pct,
                item.discount_amount, item.total
            ],
        );

        // Update stock in master DB
        let _ = master_db.conn().execute(
            "UPDATE products SET stock = stock - ?1, updated_at = datetime('now')
             WHERE id = ?2",
            rusqlite::params![item.qty, item.product_id],
        );
    }

    // Insert payments
    for pay in &payload.payments {
        let pay_id = format!("pay_{}", Uuid::new_v4().simple());
        let _ = tx_db.conn().execute(
            "INSERT INTO payments (id,transaction_id,method,amount,change_amount,reference_no,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            rusqlite::params![
                pay_id, tx_id, pay.method, pay.amount,
                pay.change_amount, pay.reference_no, now
            ],
        );
    }

    info!("Transaction created: {} ({})", invoice_no, tx_id);
    ApiResponse::ok(Transaction {
        id: tx_id.clone(),
        invoice_no,
        cashier_id: session.user_id,
        cashier_name: session.full_name,
        customer_id: payload.customer_id,
        customer_name: payload.customer_name,
        subtotal,
        discount_amount,
        tax_amount,
        total,
        paid_amount,
        change_amount,
        status: "completed".into(),
        notes: notes,
        created_at: now,
        items: enriched_items,
        payments: payload.payments,
    })
}

#[tauri::command]
pub fn cmd_list_transactions(
    limit: Option<i64>,
    offset: Option<i64>,
    state: State<AppState>,
) -> ApiResponse<Vec<serde_json::Value>> {
    let _session = match state.session.require_role("cashier") {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    if let Err(e) = state.db.ensure_current_tx_db() {
        return ApiResponse::err(e.to_string());
    }

    let db = state.db.transactional.lock().unwrap();
    let mut stmt = db.conn().prepare(
        "SELECT id, invoice_no, cashier_name, customer_name, total, status, created_at
         FROM transactions ORDER BY created_at DESC LIMIT ?1 OFFSET ?2"
    ).unwrap();

    let rows: Vec<serde_json::Value> = stmt
        .query_map(
            rusqlite::params![limit.unwrap_or(50), offset.unwrap_or(0)],
            |row| {
                Ok(serde_json::json!({
                    "id":            row.get::<_, String>(0)?,
                    "invoice_no":    row.get::<_, String>(1)?,
                    "cashier_name":  row.get::<_, String>(2)?,
                    "customer_name": row.get::<_, Option<String>>(3)?,
                    "total":         row.get::<_, f64>(4)?,
                    "status":        row.get::<_, String>(5)?,
                    "created_at":    row.get::<_, String>(6)?,
                }))
            },
        )
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    ApiResponse::ok(rows)
}

#[tauri::command]
pub fn cmd_get_transaction(id: String, state: State<AppState>) -> ApiResponse<serde_json::Value> {
    let _session = match state.session.require_role("cashier") {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    if let Err(e) = state.db.ensure_current_tx_db() {
        return ApiResponse::err(e.to_string());
    }

    let db = state.db.transactional.lock().unwrap();

    let tx = db.conn().query_row(
        "SELECT id,invoice_no,cashier_id,cashier_name,customer_id,customer_name,
                subtotal,discount_amount,tax_amount,total,paid_amount,change_amount,
                status,notes,created_at
         FROM transactions WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok(serde_json::json!({
            "id":             row.get::<_, String>(0)?,
            "invoice_no":     row.get::<_, String>(1)?,
            "cashier_id":     row.get::<_, String>(2)?,
            "cashier_name":   row.get::<_, String>(3)?,
            "customer_id":    row.get::<_, Option<String>>(4)?,
            "customer_name":  row.get::<_, Option<String>>(5)?,
            "subtotal":       row.get::<_, f64>(6)?,
            "discount_amount": row.get::<_, f64>(7)?,
            "tax_amount":     row.get::<_, f64>(8)?,
            "total":          row.get::<_, f64>(9)?,
            "paid_amount":    row.get::<_, f64>(10)?,
            "change_amount":  row.get::<_, f64>(11)?,
            "status":         row.get::<_, String>(12)?,
            "notes":          row.get::<_, String>(13)?,
            "created_at":     row.get::<_, String>(14)?,
        })),
    );

    match tx {
        Ok(t) => ApiResponse::ok(t),
        Err(_) => ApiResponse::err("Transaksi tidak ditemukan".to_string()),
    }
}

#[tauri::command]
pub fn cmd_void_transaction(
    id: String,
    reason: String,
    state: State<AppState>,
) -> ApiResponse<()> {
    let session = match state.session.require_role("manager") {
        Ok(s) => s, Err(e) => return ApiResponse::err(e.to_string()),
    };

    if let Err(e) = state.db.ensure_current_tx_db() {
        return ApiResponse::err(e.to_string());
    }

    let db = state.db.transactional.lock().unwrap();
    match db.conn().execute(
        "UPDATE transactions
         SET status='void', void_reason=?1, voided_by=?2, voided_at=datetime('now'), updated_at=datetime('now')
         WHERE id=?3 AND status='completed'",
        rusqlite::params![reason, session.user_id, id],
    ) {
        Ok(n) if n > 0 => { info!("Transaction {} voided by {}", id, session.username); ApiResponse::ok(()) }
        Ok(_) => ApiResponse::err("Transaksi tidak ditemukan atau sudah di-void".to_string()),
        Err(e) => ApiResponse::err(e.to_string()),
    }
}

/// Lists all available monthly DB files
#[tauri::command]
pub fn cmd_list_tx_months(state: State<AppState>) -> ApiResponse<Vec<String>> {
    let tx_dir = state.data_dir.join("db").join("transactions");
    let files = crate::db::list_tx_db_files(&tx_dir);
    let months: Vec<String> = files
        .iter()
        .filter_map(|p| p.file_stem()?.to_str().map(|s| s.to_string()))
        .collect();
    ApiResponse::ok(months)
}