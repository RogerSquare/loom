pub mod anthropic;
pub mod ollama_provider;
pub mod sse;

use std::pin::Pin;

use async_trait::async_trait;
use futures::Stream;
use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::ollama::chat::StreamEvent;

/// Unified model info returned by all providers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderModelInfo {
    pub id: String,
    pub name: String,
    pub provider: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameter_size: Option<String>,
}

/// Provider-agnostic message — the universal currency between providers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderMessage {
    pub role: String,
    pub content: String,
}

/// Unified options that each provider maps to its own format.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProviderOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_k: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seed: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop: Option<Vec<String>>,
    /// Ollama-specific: context window size.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_ctx: Option<u32>,
}

/// The core abstraction. Each LLM backend implements this trait.
/// `chat_stream` returns a stream of `StreamEvent` — the same Delta/Done/Error
/// enum the frontend already consumes, so no adapter layer is needed.
#[async_trait]
pub trait Provider: Send + Sync {
    /// Unique identifier for this provider (e.g. "ollama", "anthropic").
    fn id(&self) -> &'static str;

    /// Human-readable display name (e.g. "Ollama (local)", "Anthropic Claude").
    fn display_name(&self) -> &'static str;

    /// Open a streaming chat. Returns a pinned stream of `StreamEvent`s.
    /// The provider is responsible for:
    /// - Formatting messages into its API's expected shape
    /// - Parsing the response stream (NDJSON, SSE, etc.)
    /// - Emitting Delta/Done/Error events
    async fn chat_stream(
        &self,
        client: &reqwest::Client,
        model: &str,
        messages: Vec<ProviderMessage>,
        options: &ProviderOptions,
        api_key: Option<&str>,
    ) -> Result<Pin<Box<dyn Stream<Item = Result<StreamEvent>> + Send>>>;

    /// List available models. Returns empty vec if discovery isn't supported
    /// (e.g. Anthropic has no model listing API — we return a hardcoded list).
    async fn list_models(
        &self,
        client: &reqwest::Client,
        api_key: Option<&str>,
    ) -> Result<Vec<ProviderModelInfo>>;
}
