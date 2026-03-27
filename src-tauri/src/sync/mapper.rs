// src/sync/mapper.rs
// Applies field mappings (api_field → local_field) with optional transforms.
// Supports dot-notation for nested API responses: "data.product.name"

use std::collections::HashMap;
use anyhow::{Context, Result};
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct FieldMapping {
    pub api_field:     String,       // dot-notation: "product_name" or "data.name"
    pub local_field:   String,       // local column: "name"
    pub transform:     Option<String>, // "uppercase" | "lowercase" | "trim" | "to_number"
    pub default_value: Option<String>,
    pub is_required:   bool,
}

/// Apply a list of mappings to one API item, returning a HashMap<local_field, Value>
pub fn apply_mappings(
    item: &Value,
    mappings: &[FieldMapping],
) -> Result<HashMap<String, Value>> {
    let mut result: HashMap<String, Value> = HashMap::new();

    for mapping in mappings {
        // Extract value using dot-notation path
        let raw_value = get_nested(item, &mapping.api_field);

        let value = match raw_value {
            Some(v) => apply_transform(v, mapping.transform.as_deref()),
            None => {
                if let Some(default) = &mapping.default_value {
                    Value::String(default.clone())
                } else if mapping.is_required {
                    return Err(anyhow::anyhow!(
                        "Required field '{}' not found in API response",
                        mapping.api_field
                    ));
                } else {
                    Value::Null
                }
            }
        };

        result.insert(mapping.local_field.clone(), value);
    }

    Ok(result)
}

/// Navigate nested JSON with dot-notation: "a.b.c" → obj["a"]["b"]["c"]
fn get_nested<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for part in path.split('.') {
        current = current.get(part)?;
    }
    // Null is treated as missing
    if current.is_null() { None } else { Some(current) }
}

/// Apply transform to a value
fn apply_transform(value: &Value, transform: Option<&str>) -> Value {
    match transform {
        None => value.clone(),

        Some("uppercase") => {
            if let Some(s) = value.as_str() {
                Value::String(s.to_uppercase())
            } else { value.clone() }
        }

        Some("lowercase") => {
            if let Some(s) = value.as_str() {
                Value::String(s.to_lowercase())
            } else { value.clone() }
        }

        Some("trim") => {
            if let Some(s) = value.as_str() {
                Value::String(s.trim().to_string())
            } else { value.clone() }
        }

        Some("to_number") => {
            if let Some(s) = value.as_str() {
                s.parse::<f64>()
                    .map(|n| serde_json::json!(n))
                    .unwrap_or_else(|_| value.clone())
            } else { value.clone() }
        }

        Some("to_boolean") => {
            match value {
                Value::Bool(_) => value.clone(),
                Value::String(s) => {
                    Value::Bool(matches!(s.to_lowercase().as_str(), "true" | "1" | "yes" | "active"))
                }
                Value::Number(n) => Value::Bool(n.as_i64().unwrap_or(0) != 0),
                _ => Value::Bool(false),
            }
        }

        Some("to_string") => {
            Value::String(match value {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            })
        }

        Some(unknown) => {
            tracing::warn!("Unknown transform: '{}', skipping", unknown);
            value.clone()
        }
    }
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_basic_mapping() {
        let item = json!({ "product_name": "Test Item", "harga": 15000.0 });
        let mappings = vec![
            FieldMapping { api_field: "product_name".into(), local_field: "name".into(),
                transform: None, default_value: None, is_required: true },
            FieldMapping { api_field: "harga".into(), local_field: "price".into(),
                transform: None, default_value: None, is_required: true },
        ];
        let result = apply_mappings(&item, &mappings).unwrap();
        assert_eq!(result["name"], json!("Test Item"));
        assert_eq!(result["price"], json!(15000.0));
    }

    #[test]
    fn test_nested_dot_notation() {
        let item = json!({ "data": { "product": { "name": "Nested Item" } } });
        let mappings = vec![
            FieldMapping { api_field: "data.product.name".into(), local_field: "name".into(),
                transform: None, default_value: None, is_required: true },
        ];
        let result = apply_mappings(&item, &mappings).unwrap();
        assert_eq!(result["name"], json!("Nested Item"));
    }

    #[test]
    fn test_uppercase_transform() {
        let item = json!({ "sku": "abc-123" });
        let mappings = vec![
            FieldMapping { api_field: "sku".into(), local_field: "sku".into(),
                transform: Some("uppercase".into()), default_value: None, is_required: false },
        ];
        let result = apply_mappings(&item, &mappings).unwrap();
        assert_eq!(result["sku"], json!("ABC-123"));
    }

    #[test]
    fn test_default_value() {
        let item = json!({});
        let mappings = vec![
            FieldMapping { api_field: "unit".into(), local_field: "unit".into(),
                transform: None, default_value: Some("pcs".into()), is_required: false },
        ];
        let result = apply_mappings(&item, &mappings).unwrap();
        assert_eq!(result["unit"], json!("pcs"));
    }

    #[test]
    fn test_required_missing_fails() {
        let item = json!({});
        let mappings = vec![
            FieldMapping { api_field: "name".into(), local_field: "name".into(),
                transform: None, default_value: None, is_required: true },
        ];
        assert!(apply_mappings(&item, &mappings).is_err());
    }
}