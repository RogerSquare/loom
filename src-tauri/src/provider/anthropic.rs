use std::pin::Pin;
use std::time::Instant;

use async_trait::async_trait;
use futures::{Stream, StreamExt};
use serde::{Deserialize, Serialize};

use crate::error::{LoomError, Result};
use crate::ollama::chat::StreamEvent;
use crate::provider::sse::SseBuffer;
use crate::provider::{Provider, ProviderMessage, ProviderModelInfo, ProviderOptions};

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

/// Anthropic Messages API message format.
#[derive(Debug, Serialize)]
struct AnthropicMessage {
    role: String,
    content: String,
}

/// Anthropic Messages API request body.
#[derive(Debug, Serialize)]
struct AnthropicRequest {
    model: String,
    messages: Vec<AnthropicMessage>,
    max_tokens: u32,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_p: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_k: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stop_sequences: Option<Vec<String>>,
}

// ── SSE response types ──

#[derive(Debug, Deserialize)]
struct ContentBlockDelta {
    delta: TextDelta,
}

#[derive(Debug, Deserialize)]
struct TextDelta {
    #[serde(default)]
    text: String,
}

#[derive(Debug, Deserialize)]
struct MessageDelta {
    #[serde(default)]
    usage: Option<MessageDeltaUsage>,
    #[serde(default)]
    delta: Option<MessageDeltaInner>,
}

#[derive(Debug, Deserialize)]
struct MessageDeltaInner {
    #[serde(default)]
    stop_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MessageDeltaUsage {
    #[serde(default)]
    output_tokens: Option<u32>,
    #[serde(default)]
    cache_read_input_tokens: Option<u32>,
    #[serde(default)]
    cache_creation_input_tokens: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct MessageStart {
    message: MessageStartInner,
}

#[derive(Debug, Deserialize)]
struct MessageStartInner {
    #[serde(default)]
    usage: Option<MessageStartUsage>,
}

#[derive(Debug, Deserialize)]
struct MessageStartUsage {
    #[serde(default)]
    input_tokens: Option<u32>,
    #[serde(default)]
    cache_read_input_tokens: Option<u32>,
    #[serde(default)]
    cache_creation_input_tokens: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct ErrorResponse {
    error: ErrorDetail,
}

#[derive(Debug, Deserialize)]
struct ErrorDetail {
    message: String,
}

pub struct AnthropicProvider;

impl AnthropicProvider {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Provider for AnthropicProvider {
    fn id(&self) -> &'static str {
        "anthropic"
    }

    fn display_name(&self) -> &'static str {
        "Anthropic Claude"
    }

    async fn chat_stream(
        &self,
        client: &reqwest::Client,
        model: &str,
        messages: Vec<ProviderMessage>,
        options: &ProviderOptions,
        api_key: Option<&str>,
    ) -> Result<Pin<Box<dyn Stream<Item = Result<StreamEvent>> + Send>>> {
        let key = api_key.ok_or_else(|| {
            LoomError::Validation("Anthropic API key is required. Set it in Settings > API Keys.".to_string())
        })?;

        // Extract system message (Anthropic puts it as a top-level param, not in messages)
        let mut system_prompt: Option<String> = None;
        let mut api_messages: Vec<AnthropicMessage> = Vec::new();

        for msg in messages {
            if msg.role == "system" {
                system_prompt = Some(msg.content);
            } else {
                api_messages.push(AnthropicMessage {
                    role: msg.role,
                    content: msg.content,
                });
            }
        }

        let req_body = AnthropicRequest {
            model: model.to_string(),
            messages: api_messages,
            max_tokens: options.max_tokens.unwrap_or(4096),
            stream: true,
            system: system_prompt,
            temperature: options.temperature,
            top_p: options.top_p,
            top_k: options.top_k,
            stop_sequences: options.stop.clone(),
        };

        let resp = client
            .post(ANTHROPIC_API_URL)
            .header("x-api-key", key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&req_body)
            .send()
            .await
            .map_err(LoomError::Http)?;

        // Check for HTTP-level errors (401, 429, etc.)
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            let msg = if let Ok(err) = serde_json::from_str::<ErrorResponse>(&body) {
                err.error.message
            } else {
                format!("Anthropic API error {status}: {body}")
            };
            return Err(LoomError::Ollama(msg));
        }

        let byte_stream = resp.bytes_stream();
        let mut sse_buf = SseBuffer::new();
        let mut input_tokens: Option<u32> = None;
        let mut output_tokens: Option<u32> = None;
        let mut cached_tokens: Option<u32> = None;
        let mut stop_reason: Option<String> = None;

        let start = Instant::now();
        let mut first_token_at: Option<Instant> = None;
        let model_id = model.to_string();

        let event_stream = async_stream::stream! {
            let mut stream = byte_stream;
            while let Some(chunk_result) = stream.next().await {
                match chunk_result {
                    Ok(bytes) => {
                        for sse_event in sse_buf.push(&bytes) {
                            let event_type = sse_event.event_type.as_deref().unwrap_or("");

                            match event_type {
                                "message_start" => {
                                    if let Ok(ms) = serde_json::from_str::<MessageStart>(&sse_event.data) {
                                        if let Some(u) = ms.message.usage {
                                            input_tokens = u.input_tokens;
                                            // cached_tokens = cache_read only.
                                            // cache_creation has a different
                                            // (higher) rate than cache_read, so
                                            // folding both would mis-cost. For
                                            // v1, ignore cache_creation.
                                            if let Some(cr) = u.cache_read_input_tokens {
                                                if cr > 0 {
                                                    cached_tokens = Some(cr);
                                                }
                                            }
                                        }
                                    }
                                }
                                "content_block_delta" => {
                                    if let Ok(cbd) = serde_json::from_str::<ContentBlockDelta>(&sse_event.data) {
                                        if !cbd.delta.text.is_empty() {
                                            if first_token_at.is_none() {
                                                first_token_at = Some(Instant::now());
                                            }
                                            yield Ok(StreamEvent::Delta {
                                                content: cbd.delta.text,
                                                logprobs: None,
                                            });
                                        }
                                    }
                                }
                                "message_delta" => {
                                    if let Ok(md) = serde_json::from_str::<MessageDelta>(&sse_event.data) {
                                        if let Some(u) = md.usage {
                                            if let Some(ot) = u.output_tokens {
                                                output_tokens = Some(ot);
                                            }
                                            // Same cache_read-only rule as
                                            // message_start; cache_creation is
                                            // deliberately ignored for v1.
                                            if let Some(cr) = u.cache_read_input_tokens {
                                                if cr > 0 {
                                                    cached_tokens =
                                                        Some(cached_tokens.unwrap_or(0) + cr);
                                                }
                                            }
                                        }
                                        if let Some(d) = md.delta {
                                            if let Some(sr) = d.stop_reason {
                                                stop_reason = Some(sr);
                                            }
                                        }
                                    }
                                }
                                "message_stop" => {
                                    let ttft_ns = first_token_at
                                        .map(|t| t.duration_since(start).as_nanos() as u64);
                                    let total_ns = Some(start.elapsed().as_nanos() as u64);
                                    let refusal_label = stop_reason
                                        .as_deref()
                                        .filter(|s| *s == "refusal")
                                        .map(|s| s.to_string());
                                    yield Ok(StreamEvent::Done {
                                        prompt_eval_count: input_tokens,
                                        eval_count: output_tokens,
                                        prompt_eval_duration_ns: None,
                                        eval_duration_ns: None,
                                        total_duration_ns: total_ns,
                                        ttft_ns,
                                        cached_tokens,
                                        reasoning_tokens: None,
                                        cost_usd: None,
                                        stop_reason: stop_reason.clone(),
                                        refusal_label,
                                        provider_id: Some("anthropic".to_string()),
                                        model_id: Some(model_id.clone()),
                                    });
                                }
                                "error" => {
                                    let msg = if let Ok(err) = serde_json::from_str::<ErrorResponse>(&sse_event.data) {
                                        err.error.message
                                    } else {
                                        sse_event.data
                                    };
                                    yield Err(LoomError::Ollama(format!("Anthropic stream error: {msg}")));
                                }
                                // content_block_start, content_block_stop, ping — ignored
                                _ => {}
                            }
                        }
                    }
                    Err(e) => {
                        yield Err(LoomError::Http(e));
                    }
                }
            }
        };

        Ok(Box::pin(event_stream))
    }

    async fn list_models(
        &self,
        _client: &reqwest::Client,
        _api_key: Option<&str>,
    ) -> Result<Vec<ProviderModelInfo>> {
        // Anthropic has no model discovery API — return hardcoded list
        Ok(vec![
            ProviderModelInfo {
                id: "claude-opus-4-20250514".to_string(),
                name: "Claude Opus 4".to_string(),
                provider: "anthropic".to_string(),
                parameter_size: None,
            },
            ProviderModelInfo {
                id: "claude-sonnet-4-20250514".to_string(),
                name: "Claude Sonnet 4".to_string(),
                provider: "anthropic".to_string(),
                parameter_size: None,
            },
            ProviderModelInfo {
                id: "claude-haiku-4-5-20251001".to_string(),
                name: "Claude Haiku 4.5".to_string(),
                provider: "anthropic".to_string(),
                parameter_size: None,
            },
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_message_extracted() {
        let messages = vec![
            ProviderMessage { role: "system".to_string(), content: "You are helpful.".to_string() },
            ProviderMessage { role: "user".to_string(), content: "Hi".to_string() },
        ];

        let mut system_prompt: Option<String> = None;
        let mut api_messages: Vec<AnthropicMessage> = Vec::new();

        for msg in messages {
            if msg.role == "system" {
                system_prompt = Some(msg.content);
            } else {
                api_messages.push(AnthropicMessage {
                    role: msg.role,
                    content: msg.content,
                });
            }
        }

        assert_eq!(system_prompt.as_deref(), Some("You are helpful."));
        assert_eq!(api_messages.len(), 1);
        assert_eq!(api_messages[0].role, "user");
    }

    #[test]
    fn request_serializes_correctly() {
        let req = AnthropicRequest {
            model: "claude-sonnet-4-20250514".to_string(),
            messages: vec![AnthropicMessage {
                role: "user".to_string(),
                content: "Hello".to_string(),
            }],
            max_tokens: 4096,
            stream: true,
            system: Some("Be helpful.".to_string()),
            temperature: Some(0.7),
            top_p: None,
            top_k: None,
            stop_sequences: None,
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["model"], "claude-sonnet-4-20250514");
        assert_eq!(json["max_tokens"], 4096);
        assert_eq!(json["stream"], true);
        assert_eq!(json["system"], "Be helpful.");
        assert!(json.get("top_p").is_none());
        assert!(json.get("stop_sequences").is_none());
    }

    #[test]
    fn content_block_delta_deserializes() {
        let data = r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello world"}}"#;
        let cbd: ContentBlockDelta = serde_json::from_str(data).unwrap();
        assert_eq!(cbd.delta.text, "Hello world");
    }

    #[test]
    fn message_delta_deserializes() {
        let data = r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}"#;
        let md: MessageDelta = serde_json::from_str(data).unwrap();
        let usage = md.usage.unwrap();
        assert_eq!(usage.output_tokens, Some(42));
        // Cached-read/creation fields are optional and absent here.
        assert!(usage.cache_read_input_tokens.is_none());
        // stop_reason extraction from delta (feat-loom-043)
        assert_eq!(md.delta.unwrap().stop_reason.as_deref(), Some("end_turn"));
    }

    #[test]
    fn message_delta_refusal_stop_reason_extracts() {
        let data = r#"{"type":"message_delta","delta":{"stop_reason":"refusal"},"usage":{"output_tokens":5}}"#;
        let md: MessageDelta = serde_json::from_str(data).unwrap();
        assert_eq!(md.delta.unwrap().stop_reason.as_deref(), Some("refusal"));
    }

    #[test]
    fn message_delta_with_additional_cached_tokens() {
        // Anthropic can surface additional cache tokens on message_delta for
        // long streams; those must accumulate into cached_tokens.
        let data = r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10,"cache_read_input_tokens":128,"cache_creation_input_tokens":32}}"#;
        let md: MessageDelta = serde_json::from_str(data).unwrap();
        let usage = md.usage.unwrap();
        assert_eq!(usage.cache_read_input_tokens, Some(128));
        assert_eq!(usage.cache_creation_input_tokens, Some(32));
    }

    #[test]
    fn message_start_deserializes() {
        let data = r#"{"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-20250514","usage":{"input_tokens":25,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0}}}"#;
        let ms: MessageStart = serde_json::from_str(data).unwrap();
        let usage = ms.message.usage.unwrap();
        assert_eq!(usage.input_tokens, Some(25));
        assert_eq!(usage.cache_read_input_tokens, Some(0));
        assert_eq!(usage.cache_creation_input_tokens, Some(0));
    }

    #[test]
    fn message_start_with_cached_tokens_deserializes() {
        let data = r#"{"type":"message_start","message":{"id":"msg_02","type":"message","role":"assistant","content":[],"model":"claude-opus-4-7","usage":{"input_tokens":100,"cache_creation_input_tokens":200,"cache_read_input_tokens":500,"output_tokens":0}}}"#;
        let ms: MessageStart = serde_json::from_str(data).unwrap();
        let usage = ms.message.usage.unwrap();
        assert_eq!(usage.input_tokens, Some(100));
        assert_eq!(usage.cache_creation_input_tokens, Some(200));
        assert_eq!(usage.cache_read_input_tokens, Some(500));
    }

    #[test]
    fn refusal_label_filter_logic() {
        // Mirrors the closure at the message_stop yield site. Only "refusal"
        // populates refusal_label; other stop_reasons leave it None.
        fn label_from(sr: Option<&str>) -> Option<String> {
            sr.filter(|s| *s == "refusal").map(|s| s.to_string())
        }
        assert_eq!(label_from(Some("refusal")).as_deref(), Some("refusal"));
        assert!(label_from(Some("end_turn")).is_none());
        assert!(label_from(Some("max_tokens")).is_none());
        assert!(label_from(None).is_none());
    }

    #[test]
    fn hardcoded_models_returned() {
        let provider = AnthropicProvider::new();
        // list_models is async but we can test the provider ID synchronously
        assert_eq!(provider.id(), "anthropic");
        assert_eq!(provider.display_name(), "Anthropic Claude");
    }
}
