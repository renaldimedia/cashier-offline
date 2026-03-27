// src/commands/mod.rs
pub mod auth;
pub mod categories;
pub mod customers;
pub mod products;
pub mod settings;
pub mod sync;
pub mod transactions;
pub mod users;

use serde::Serialize;

/// Standard response wrapper for all Tauri commands
#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub message: String,
    pub data: Option<T>,
}

impl<T> ApiResponse<T> {
    pub fn err(msg: String) -> Self {
        Self {
            success: false,
            message: msg,
            data: None,
        }
    }

    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            message: "OK".into(),
            data: Some(data),
        }
    }
}