use crate::error::{LoomError, Result};
use crate::ollama::streaming::NdjsonBuffer;
use futures::{Stream, StreamExt};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub images: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Options {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_k: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_ctx: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_predict: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seed: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<Message>,
    #[serde(default = "default_stream")]
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Options>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_alive: Option<String>,
    /// Enable per-token logprobs in the response (Ollama v0.12.11+).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logprobs: Option<bool>,
    /// How many top alternatives to return per token (0–20). Requires logprobs=true.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_logprobs: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopLogprobEntry {
    pub token: String,
    pub logprob: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bytes: Option<Vec<u32>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenLogprob {
    pub token: String,
    pub logprob: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bytes: Option<Vec<u32>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub top_logprobs: Vec<TopLogprobEntry>,
}

fn default_stream() -> bool {
    true
}

/// One streamed record from /api/chat. Intermediate chunks have `done=false`
/// and carry a partial assistant `message.content`. The final chunk has
/// `done=true` and aggregate usage counters.
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct ChatChunk {
    pub model: String,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub message: Option<Message>,
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
    /// Top-level logprobs array when the request enabled them.
    #[serde(default)]
    pub logprobs: Option<Vec<TokenLogprob>>,
}

/// Normalized event shipped over the Tauri Channel to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StreamEvent {
    Delta {
        content: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        logprobs: Option<Vec<TokenLogprob>>,
    },
    Done {
        prompt_eval_count: Option<u32>,
        eval_count: Option<u32>,
        prompt_eval_duration_ns: Option<u64>,
        eval_duration_ns: Option<u64>,
        total_duration_ns: Option<u64>,
        // Observability fields (feat-loom-043). All Option, populated where the
        // provider surfaces them. Cost is NOT computed here — pricing lookup
        // happens in the caller (see feat-loom-043 phase 3).
        #[serde(skip_serializing_if = "Option::is_none")]
        ttft_ns: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cached_tokens: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        reasoning_tokens: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stop_reason: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        refusal_label: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        provider_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        model_id: Option<String>,
    },
    Error {
        message: String,
    },
}

/// Open a streaming chat request against Ollama's native `/api/chat` endpoint.
/// Returns a stream of parsed `ChatChunk`s. Caller is responsible for deciding
/// delta-vs-done semantics.
pub async fn chat_stream(
    client: &reqwest::Client,
    base_url: &str,
    req: ChatRequest,
) -> Result<impl Stream<Item = Result<ChatChunk>>> {
    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));
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
                        match serde_json::from_str::<ChatChunk>(&line) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_serializes_correctly() {
        let req = ChatRequest {
            model: "llama3.1:8b".to_string(),
            messages: vec![Message {
                role: Role::User,
                content: "hi".to_string(),
                images: None,
            }],
            stream: true,
            options: Some(Options {
                temperature: Some(0.7),
                ..Default::default()
            }),
            format: None,
            keep_alive: None,
            logprobs: None,
            top_logprobs: None,
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["model"], "llama3.1:8b");
        assert_eq!(json["stream"], true);
        assert_eq!(json["messages"][0]["role"], "user");
        assert_eq!(json["messages"][0]["content"], "hi");
        let t = json["options"]["temperature"].as_f64().expect("temperature is a number");
        assert!((t - 0.7).abs() < 1e-6, "temperature {} not close to 0.7", t);
        assert!(json["options"].get("top_p").is_none(), "unset options should be omitted");
        assert!(json.get("format").is_none());
        assert!(json.get("keep_alive").is_none());
    }

    #[test]
    fn response_deserializes_correctly() {
        let delta = r#"{"model":"llama3.1:8b","created_at":"2026-04-16T12:00:00Z","message":{"role":"assistant","content":"Hello"},"done":false}"#;
        let chunk: ChatChunk = serde_json::from_str(delta).unwrap();
        assert!(!chunk.done);
        assert_eq!(chunk.message.as_ref().unwrap().content, "Hello");

        let done = r#"{"model":"llama3.1:8b","created_at":"2026-04-16T12:00:01Z","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","total_duration":1234567,"prompt_eval_count":18,"prompt_eval_duration":100000,"eval_count":9,"eval_duration":1000000}"#;
        let chunk: ChatChunk = serde_json::from_str(done).unwrap();
        assert!(chunk.done);
        assert_eq!(chunk.done_reason.as_deref(), Some("stop"));
        assert_eq!(chunk.prompt_eval_count, Some(18));
        assert_eq!(chunk.eval_count, Some(9));
        assert_eq!(chunk.eval_duration, Some(1000000));
    }
}
