#![allow(dead_code)]
//! Stub for Phase 7. `/api/generate` with `raw: true` is how Loom will implement
//! reliable assistant-message prefill (Ollama's native /api/chat trailing-
//! assistant message is model-dependent and undocumented; see GH ollama/ollama#6778).
//!
//! The shape is declared here so downstream modules can refer to it, but the
//! client is not wired until Phase 7 where a per-model template registry is
//! needed to render the raw prompt correctly.

use serde::Serialize;

use crate::ollama::chat::Options;

#[derive(Debug, Clone, Serialize)]
pub struct GenerateRequest {
    pub model: String,
    pub prompt: String,
    #[serde(default)]
    pub raw: bool,
    #[serde(default = "default_stream")]
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Options>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_alive: Option<String>,
}

fn default_stream() -> bool {
    true
}
