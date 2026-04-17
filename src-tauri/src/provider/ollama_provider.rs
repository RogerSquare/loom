use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use async_trait::async_trait;
use futures::{Stream, StreamExt};

use crate::error::Result;
use crate::ollama::chat::{
    chat_stream, ChatRequest, Message, Options, Role, StreamEvent,
};
use crate::provider::{Provider, ProviderMessage, ProviderModelInfo, ProviderOptions};

pub struct OllamaProvider {
    pub base_url: String,
}

impl OllamaProvider {
    pub fn new(base_url: String) -> Self {
        Self { base_url }
    }
}

fn to_role(s: &str) -> Role {
    match s {
        "system" => Role::System,
        "user" => Role::User,
        "assistant" => Role::Assistant,
        "tool" => Role::Tool,
        _ => Role::User,
    }
}

fn to_ollama_options(opts: &ProviderOptions) -> Option<Options> {
    let o = Options {
        temperature: opts.temperature,
        top_p: opts.top_p,
        top_k: opts.top_k,
        num_ctx: opts.num_ctx,
        num_predict: opts.max_tokens.map(|v| v as i32),
        seed: opts.seed,
        stop: opts.stop.clone(),
    };
    // Return None if all fields are None to keep serialization clean
    if o.temperature.is_none()
        && o.top_p.is_none()
        && o.top_k.is_none()
        && o.num_ctx.is_none()
        && o.num_predict.is_none()
        && o.seed.is_none()
        && o.stop.is_none()
    {
        None
    } else {
        Some(o)
    }
}

#[async_trait]
impl Provider for OllamaProvider {
    fn id(&self) -> &'static str {
        "ollama"
    }

    fn display_name(&self) -> &'static str {
        "Ollama (local)"
    }

    async fn chat_stream(
        &self,
        client: &reqwest::Client,
        model: &str,
        messages: Vec<ProviderMessage>,
        options: &ProviderOptions,
        _api_key: Option<&str>,
    ) -> Result<Pin<Box<dyn Stream<Item = Result<StreamEvent>> + Send>>> {
        let ollama_messages: Vec<Message> = messages
            .into_iter()
            .map(|m| Message {
                role: to_role(&m.role),
                content: m.content,
                images: None,
            })
            .collect();

        let req = ChatRequest {
            model: model.to_string(),
            messages: ollama_messages,
            stream: true,
            options: to_ollama_options(options),
            format: None,
            keep_alive: None,
            logprobs: None,
            top_logprobs: None,
        };

        let stream = chat_stream(client, &self.base_url, req).await?;

        // Wall-clock start + first-token capture. Stored in Arc<Mutex> so the
        // async stream map closure can both read and write across iterations.
        let start = Instant::now();
        let first_token_at: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));
        let model_id = model.to_string();

        let event_stream = stream.map(move |chunk_result| {
            let first_at = Arc::clone(&first_token_at);
            let model_id = model_id.clone();
            chunk_result.map(move |c| {
                if c.done {
                    let ttft_ns = first_at
                        .lock()
                        .ok()
                        .and_then(|g| g.map(|t| t.duration_since(start).as_nanos() as u64));
                    StreamEvent::Done {
                        prompt_eval_count: c.prompt_eval_count,
                        eval_count: c.eval_count,
                        prompt_eval_duration_ns: c.prompt_eval_duration,
                        eval_duration_ns: c.eval_duration,
                        total_duration_ns: c.total_duration,
                        ttft_ns,
                        cached_tokens: None,
                        reasoning_tokens: None,
                        cost_usd: None,
                        stop_reason: c.done_reason.clone(),
                        refusal_label: None,
                        provider_id: Some("ollama".to_string()),
                        model_id: Some(model_id),
                    }
                } else if let Some(m) = c.message {
                    if !m.content.is_empty() {
                        if let Ok(mut slot) = first_at.lock() {
                            if slot.is_none() {
                                *slot = Some(Instant::now());
                            }
                        }
                    }
                    StreamEvent::Delta {
                        content: m.content,
                        logprobs: c.logprobs,
                    }
                } else {
                    StreamEvent::Delta {
                        content: String::new(),
                        logprobs: None,
                    }
                }
            })
        });

        Ok(Box::pin(event_stream))
    }

    async fn list_models(
        &self,
        client: &reqwest::Client,
        _api_key: Option<&str>,
    ) -> Result<Vec<ProviderModelInfo>> {
        let models = crate::ollama::list_models(client, &self.base_url).await?;
        Ok(models
            .into_iter()
            .map(|m| ProviderModelInfo {
                id: m.name.clone(),
                name: m.name,
                provider: "ollama".to_string(),
                parameter_size: m.details.and_then(|d| d.parameter_size),
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn role_mapping() {
        assert!(matches!(to_role("system"), Role::System));
        assert!(matches!(to_role("user"), Role::User));
        assert!(matches!(to_role("assistant"), Role::Assistant));
        assert!(matches!(to_role("tool"), Role::Tool));
        assert!(matches!(to_role("unknown"), Role::User));
    }

    #[test]
    fn empty_options_returns_none() {
        let opts = ProviderOptions::default();
        assert!(to_ollama_options(&opts).is_none());
    }

    #[test]
    fn partial_options_returns_some() {
        let opts = ProviderOptions {
            temperature: Some(0.7),
            ..Default::default()
        };
        let o = to_ollama_options(&opts).unwrap();
        assert!((o.temperature.unwrap() - 0.7).abs() < 1e-6);
        assert!(o.top_p.is_none());
    }
}
