//! `/api/generate` client with `raw: true` — used for assistant-message
//! prefill ("put words in the model's mouth"). Native `/api/chat` trailing-
//! assistant prefill is model-dependent and unreliable (ollama/ollama#6778),
//! so we render the prompt ourselves via the per-family template registry
//! and ship it as a `raw` prompt.

use futures::{Stream, StreamExt};
use serde::{Deserialize, Serialize};

use crate::error::{LoomError, Result};
use crate::ollama::chat::Options;
use crate::ollama::streaming::NdjsonBuffer;

#[derive(Debug, Clone, Serialize)]
pub struct GenerateRequest {
    pub model: String,
    pub prompt: String,
    #[serde(default)]
    pub raw: bool,
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Options>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_alive: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct GenerateChunk {
    pub model: String,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub response: Option<String>,
    pub done: bool,
    #[serde(default)]
    pub done_reason: Option<String>,
    #[serde(default)]
    pub prompt_eval_count: Option<u32>,
    #[serde(default)]
    pub eval_count: Option<u32>,
    #[serde(default)]
    pub prompt_eval_duration: Option<u64>,
    #[serde(default)]
    pub eval_duration: Option<u64>,
    #[serde(default)]
    pub total_duration: Option<u64>,
}

pub async fn generate_stream(
    client: &reqwest::Client,
    base_url: &str,
    req: GenerateRequest,
) -> Result<impl Stream<Item = Result<GenerateChunk>>> {
    let url = format!("{}/api/generate", base_url.trim_end_matches('/'));
    let resp = client
        .post(url)
        .json(&req)
        .send()
        .await?
        .error_for_status()?;

    let byte_stream = resp.bytes_stream();
    let mut buf = NdjsonBuffer::new();

    Ok(async_stream::stream! {
        let mut stream = byte_stream;
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    for line in buf.push(&bytes) {
                        match serde_json::from_str::<GenerateChunk>(&line) {
                            Ok(parsed) => yield Ok(parsed),
                            Err(e) => yield Err(LoomError::Json(e)),
                        }
                    }
                }
                Err(e) => yield Err(LoomError::Http(e)),
            }
        }
    })
}
