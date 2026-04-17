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
    /// Rolling turn-count limit applied to outbound chat requests.
    /// None = unlimited (legacy behavior). Pinned turns + the root system
    /// turn are always included regardless of this value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_limit: Option<u32>,
    /// Seed pre-filled into the Composer when this session is opened.
    /// None = random each send (current behavior).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_seed: Option<i64>,
    /// User-defined tags for session organization and filtering.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// LLM provider for this session (e.g. "ollama", "anthropic").
    /// Defaults to "ollama" for backward compatibility with existing sessions.
    #[serde(default = "default_provider")]
    pub provider: String,
}

fn default_provider() -> String {
    "ollama".to_string()
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
    /// Wall-clock time from request send to first content token (nanoseconds).
    /// Provider-agnostic; populated via Instant::now() on the Rust side even
    /// when the API itself does not report it.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub ttft_ns: Option<u64>,
    /// Prompt-cache tokens (read + write combined). None when the provider
    /// has no prompt-cache concept (e.g. Ollama).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub cached_tokens: Option<u32>,
    /// Extended-thinking / reasoning token count. Separate from eval_count.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub reasoning_tokens: Option<u32>,
    /// Derived cost for this turn in USD. None when the model is absent from
    /// the pricing table (e.g. local Ollama models).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub cost_usd: Option<f64>,
    /// Raw stop-reason string from the provider (done_reason / stop_reason /
    /// finish_reason). Stored verbatim; no unified taxonomy.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub stop_reason: Option<String>,
    /// Raw refusal / safety label string from the provider (e.g. Anthropic's
    /// "refusal" stop_reason, OpenAI's choices[0].message.refusal). Null when
    /// the response was not flagged.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub refusal_label: Option<String>,
    /// Provider that produced this turn (e.g. "ollama", "anthropic", "openai").
    /// Redundant with GeneratedBy.endpoint but denormalized here for cheap UI
    /// lookup and branch roll-ups.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub provider_id: Option<String>,
    /// Model id used for this turn (e.g. "claude-opus-4-7"). Redundant with
    /// GeneratedBy.model but denormalized here for the same reason.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub model_id: Option<String>,
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
    #[serde(default, skip_serializing_if = "is_false")]
    pub pinned: bool,
    /// Reasoning/thinking text extracted from `<think>...</think>` blocks
    /// emitted by reasoning-capable models (qwq, DeepSeek-R1 family).
    /// Stored separately so the displayed response body stays clean.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    /// Per-token logprobs captured when the chat request enabled them.
    /// Only populated for assistant turns and only when `options.logprobs`
    /// was true at send time. Large (~8× token count); opt-in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logprobs: Option<Vec<crate::ollama::chat::TokenLogprob>>,
}

fn is_false(b: &bool) -> bool {
    !*b
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
    pub tags: Vec<String>,
    pub provider: String,
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

    #[test]
    fn response_meta_legacy_shape_deserializes_with_new_fields_none() {
        // Old on-disk ResponseMeta had only the 5 original fields; session
        // files written before observability extension must still load.
        let legacy = r#"{
            "prompt_eval_count": 12,
            "eval_count": 34,
            "prompt_eval_duration_ns": 100,
            "eval_duration_ns": 200,
            "total_duration_ns": 300
        }"#;
        let meta: ResponseMeta = serde_json::from_str(legacy).unwrap();
        assert_eq!(meta.prompt_eval_count, Some(12));
        assert_eq!(meta.eval_count, Some(34));
        assert!(meta.ttft_ns.is_none());
        assert!(meta.cached_tokens.is_none());
        assert!(meta.reasoning_tokens.is_none());
        assert!(meta.cost_usd.is_none());
        assert!(meta.stop_reason.is_none());
        assert!(meta.refusal_label.is_none());
        assert!(meta.provider_id.is_none());
        assert!(meta.model_id.is_none());
    }

    #[test]
    fn response_meta_full_shape_round_trips() {
        let meta = ResponseMeta {
            prompt_eval_count: Some(100),
            eval_count: Some(50),
            prompt_eval_duration_ns: Some(1_000_000),
            eval_duration_ns: Some(2_000_000),
            total_duration_ns: Some(3_000_000),
            ttft_ns: Some(250_000),
            cached_tokens: Some(20),
            reasoning_tokens: Some(10),
            cost_usd: Some(0.0042),
            stop_reason: Some("end_turn".to_string()),
            refusal_label: None,
            provider_id: Some("anthropic".to_string()),
            model_id: Some("claude-opus-4-7".to_string()),
        };
        let json = serde_json::to_string(&meta).unwrap();
        let back: ResponseMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(back.prompt_eval_count, meta.prompt_eval_count);
        assert_eq!(back.ttft_ns, meta.ttft_ns);
        assert_eq!(back.cost_usd, meta.cost_usd);
        assert_eq!(back.provider_id, meta.provider_id);
        assert_eq!(back.model_id, meta.model_id);
        assert_eq!(back.stop_reason, meta.stop_reason);
    }

    #[test]
    fn response_meta_empty_shape_deserializes() {
        // Explicit "all None" case — earliest sessions may have no ResponseMeta.
        let meta: ResponseMeta = serde_json::from_str("{}").unwrap();
        assert!(meta.prompt_eval_count.is_none());
        assert!(meta.ttft_ns.is_none());
        assert!(meta.cost_usd.is_none());
    }
}
