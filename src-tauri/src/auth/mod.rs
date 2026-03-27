// src/auth/mod.rs
// Session management for local users (superadmin, manager, cashier)

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

/// User roles
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Superadmin,
    Manager,
    Cashier,
}

impl Role {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "superadmin" => Some(Role::Superadmin),
            "manager"    => Some(Role::Manager),
            "cashier"    => Some(Role::Cashier),
            _            => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Role::Superadmin => "superadmin",
            Role::Manager    => "manager",
            Role::Cashier    => "cashier",
        }
    }

    /// Whether role can manage products/categories
    pub fn can_manage_products(&self) -> bool {
        matches!(self, Role::Superadmin | Role::Manager)
    }

    /// Whether role can void transactions
    pub fn can_void_transaction(&self) -> bool {
        matches!(self, Role::Superadmin | Role::Manager)
    }

    /// Whether role can view reports
    pub fn can_view_reports(&self) -> bool {
        matches!(self, Role::Superadmin | Role::Manager)
    }

    /// Whether role can manage app settings
    pub fn can_manage_settings(&self) -> bool {
        matches!(self, Role::Superadmin)
    }

    /// Whether role can configure sync
    pub fn can_configure_sync(&self) -> bool {
        matches!(self, Role::Superadmin)
    }

    /// Whether role can manage users
    pub fn can_manage_users(&self) -> bool {
        matches!(self, Role::Superadmin)
    }
}

/// An authenticated session (in-memory, not persisted)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub user_id:   String,
    pub username:  String,
    pub full_name: String,
    pub role:      Role,
    pub logged_in_at: String,
}

/// Thread-safe session store
#[derive(Clone, Default)]
pub struct SessionStore(Arc<Mutex<Option<Session>>>);

impl SessionStore {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(None)))
    }

    pub fn set(&self, session: Session) {
        *self.0.lock().unwrap() = Some(session);
    }

    pub fn clear(&self) {
        *self.0.lock().unwrap() = None;
    }

    pub fn get(&self) -> Option<Session> {
        self.0.lock().unwrap().clone()
    }

    pub fn is_authenticated(&self) -> bool {
        self.0.lock().unwrap().is_some()
    }

    /// Returns Err if not logged in or insufficient role
    pub fn require_role(&self, min_role: &str) -> Result<Session, AuthError> {
        let session = self.get().ok_or(AuthError::NotAuthenticated)?;
        let required = Role::from_str(min_role).ok_or(AuthError::InvalidRole)?;

        let allowed = match required {
            Role::Cashier    => true,  // any logged-in user
            Role::Manager    => matches!(session.role, Role::Manager | Role::Superadmin),
            Role::Superadmin => matches!(session.role, Role::Superadmin),
        };

        if allowed {
            Ok(session)
        } else {
            Err(AuthError::Forbidden {
                required: min_role.to_string(),
                actual:   session.role.as_str().to_string(),
            })
        }
    }
}

#[derive(Debug, thiserror::Error, Serialize)]
pub enum AuthError {
    #[error("Not authenticated")]
    NotAuthenticated,
    #[error("Access forbidden: requires {required}, got {actual}")]
    Forbidden { required: String, actual: String },
    #[error("Invalid role")]
    InvalidRole,
}