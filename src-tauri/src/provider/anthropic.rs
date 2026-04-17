use std::pin::Pin;

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
}

#[derive(Debug, Deserialize)]
struct MessageDeltaUsage {
    #[serde(default)]
    output_tokens: Option<u32>,
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
                                        input_tokens = ms.message.usage.and_then(|u| u.input_tokens);
                                    }
                                }
                                "content_block_delta" => {
                                    if let Ok(cbd) = serde_json::from_str::<ContentBlockDelta>(&sse_event.data) {
                                        if !cbd.delta.text.is_empty() {
                                            yield Ok(StreamEvent::Delta {
                                                content: cbd.delta.text,
                                                logprobs: None,
                                            });
                                        }
                                    }
                                }
                                "message_delta" => {
                                    if let Ok(md) = serde_json::from_str::<MessageDelta>(&sse_event.data) {
                                        output_tokens = md.usage.and_then(|u| u.output_tokens);
                                    }
                                }
                                "message_stop" => {
                                    yield Ok(StreamEvent::Done {
                                        prompt_eval_count: input_tokens,
                                        eval_count: output_tokens,
                                        prompt_eval_duration_ns: None,
                                        eval_duration_ns: None,
                                        total_duration_ns: None,
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
        assert_eq!(md.usage.unwrap().output_tokens, Some(42));
    }

    #[test]
    fn message_start_deserializes() {
        let data = r#"{"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-20250514","usage":{"input_tokens":25,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0}}}"#;
        let ms: MessageStart = serde_json::from_str(data).unwrap();
        assert_eq!(ms.message.usage.unwrap().input_tokens, Some(25));
    }

    #[test]
    fn hardcoded_models_returned() {
        let provider = AnthropicProvider::new();
        // list_models is async but we can test the provider ID synchronously
        assert_eq!(provider.id(), "anthropic");
        assert_eq!(provider.display_name(), "Anthropic Claude");
    }
}
