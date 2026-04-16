use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::ollama::chat::{Options, Role};

pub const LOOM_SCHEMA_V1: u32 = 1;

macro_rules! newtype_id {
    ($name:ident) => {
        #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub struct $name(pub String);

        #[allow(dead_code)]
        impl $name {
            pub fn new(s: impl Into<String>) -> Self {
                Self(s.into())
            }

            pub fn generate() -> Self {
                Self(ulid::Ulid::new().to_string())
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(&self.0)
            }
        }
    };
}

newtype_id!(SessionId);
newtype_id!(TurnId);
newtype_id!(BranchId);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: SessionId,
    pub title: String,
    pub created_at: String,
    pub model: String,
    #[serde(default)]
    pub default_options: Options,
    pub default_endpoint: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ResponseMeta {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub prompt_eval_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub eval_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub prompt_eval_duration_ns: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub eval_duration_ns: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub total_duration_ns: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedBy {
    pub endpoint: String,
    pub model: String,
    #[serde(default)]
    pub options: Options,
    #[serde(default)]
    pub request_body: serde_json::Value,
    #[serde(default)]
    pub response_meta: ResponseMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Turn {
    pub id: TurnId,
    pub parent: Option<TurnId>,
    pub role: Role,
    pub content: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub generated_by: Option<GeneratedBy>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub annotations: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub swipe_group: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Branch {
    pub name: String,
    pub head: TurnId,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub parent_branch: Option<BranchId>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub forked_at: Option<TurnId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionFile {
    pub loom_schema: u32,
    pub session: Session,
    pub turns: BTreeMap<TurnId, Turn>,
    pub branches: BTreeMap<BranchId, Branch>,
    pub head_branch: BranchId,
}

/// Slim session summary for the sidebar list — avoids loading full turn history.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSummary {
    pub id: SessionId,
    pub title: String,
    pub created_at: String,
    pub model: String,
    pub turn_count: usize,
    pub branch_count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_generated_unique() {
        let a = TurnId::generate();
        let b = TurnId::generate();
        assert_ne!(a, b);
        assert_eq!(a.as_str().len(), 26);
    }

    #[test]
    fn ids_round_trip_through_serde() {
        let id = TurnId::new("t_00000000000000000000000000");
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(json, "\"t_00000000000000000000000000\"");
        let back: TurnId = serde_json::from_str(&json).unwrap();
        assert_eq!(back, id);
    }
}
