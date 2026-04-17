use std::pin::Pin;

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

        // Convert ChatChunk stream → StreamEvent stream
        let event_stream = stream.map(|chunk_result| {
            chunk_result.map(|c| {
                if c.done {
                    StreamEvent::Done {
                        prompt_eval_count: c.prompt_eval_count,
                        eval_count: c.eval_count,
                        prompt_eval_duration_ns: c.prompt_eval_duration,
                        eval_duration_ns: c.eval_duration,
                        total_duration_ns: c.total_duration,
                    }
                } else if let Some(m) = c.message {
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
