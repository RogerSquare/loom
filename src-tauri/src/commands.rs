use futures::StreamExt;
use tauri::ipc::Channel;

use crate::error::{LoomError, Result};
use crate::ollama::{
    self,
    chat::{chat_stream, ChatRequest, StreamEvent},
    ModelInfo,
};

pub struct LoomState {
    pub http: reqwest::Client,
    pub ollama_base: String,
}

impl LoomState {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("reqwest client build");
        Self {
            http,
            ollama_base: "http://localhost:11434".to_string(),
        }
    }
}

impl Default for LoomState {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
pub async fn ollama_list_models(state: tauri::State<'_, LoomState>) -> Result<Vec<ModelInfo>> {
    ollama::list_models(&state.http, &state.ollama_base).await
}

#[tauri::command]
pub async fn ollama_chat(
    state: tauri::State<'_, LoomState>,
    req: ChatRequest,
    on_chunk: Channel<StreamEvent>,
) -> Result<()> {
    let stream = chat_stream(&state.http, &state.ollama_base, req).await?;
    tokio::pin!(stream);

    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(c) if c.done => {
                let event = StreamEvent::Done {
                    prompt_eval_count: c.prompt_eval_count,
                    eval_count: c.eval_count,
                    prompt_eval_duration_ns: c.prompt_eval_duration,
                    eval_duration_ns: c.eval_duration,
                    total_duration_ns: c.total_duration,
                };
                on_chunk
                    .send(event)
                    .map_err(|e| LoomError::Channel(e.to_string()))?;
            }
            Ok(c) => {
                if let Some(m) = c.message {
                    on_chunk
                        .send(StreamEvent::Delta { content: m.content })
                        .map_err(|e| LoomError::Channel(e.to_string()))?;
                }
            }
            Err(e) => {
                let msg = e.to_string();
                let _ = on_chunk.send(StreamEvent::Error { message: msg.clone() });
                return Err(e);
            }
        }
    }
    Ok(())
}
