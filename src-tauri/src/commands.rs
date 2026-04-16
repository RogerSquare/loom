use std::path::PathBuf;

use futures::StreamExt;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::error::{LoomError, Result};
use crate::ollama::{
    self,
    chat::{chat_stream, ChatRequest, Role, StreamEvent, TokenLogprob},
    ModelInfo,
};
use crate::store::{
    io as store_io,
    ops as store_ops,
    schema::{
        Branch, BranchId, Session, SessionFile, SessionId, SessionSummary, Turn, TurnId,
        LOOM_SCHEMA_V1,
    },
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

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn sessions_dir(app: &AppHandle) -> Result<PathBuf> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| LoomError::Ollama(format!("app_data_dir: {e}")))?;
    let dir = base.join("sessions");
    Ok(dir)
}

// ────────────────────────────── Ollama commands ──────────────────────────────

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
                        .send(StreamEvent::Delta {
                            content: m.content,
                            logprobs: c.logprobs,
                        })
                        .map_err(|e| LoomError::Channel(e.to_string()))?;
                }
            }
            Err(e) => {
                let msg = e.to_string();
                let _ = on_chunk.send(StreamEvent::Error { message: msg });
                return Err(e);
            }
        }
    }
    Ok(())
}

// ────────────────────────────── Session commands ─────────────────────────────

#[tauri::command]
pub async fn session_list(app: AppHandle) -> Result<Vec<SessionSummary>> {
    let dir = sessions_dir(&app)?;
    store_io::list_sessions(&dir)
}

#[tauri::command]
pub async fn session_open(app: AppHandle, id: SessionId) -> Result<SessionFile> {
    let dir = sessions_dir(&app)?;
    store_io::load_session(&dir, &id)
}

#[tauri::command]
pub async fn session_save(app: AppHandle, file: SessionFile) -> Result<()> {
    let dir = sessions_dir(&app)?;
    store_io::write_session_atomic(&dir, &file)
}

#[tauri::command]
pub async fn session_delete(app: AppHandle, id: SessionId) -> Result<()> {
    let dir = sessions_dir(&app)?;
    store_io::delete_session(&dir, &id)
}

#[tauri::command]
pub async fn session_create(
    app: AppHandle,
    title: String,
    model: String,
    system_prompt: Option<String>,
) -> Result<SessionFile> {
    let dir = sessions_dir(&app)?;
    let now = now_iso();
    let session_id = SessionId::generate();
    let root_turn_id = TurnId::generate();
    let branch_id = BranchId::generate();

    let root_turn = Turn {
        id: root_turn_id.clone(),
        parent: None,
        role: Role::System,
        content: system_prompt.unwrap_or_else(|| "You are a helpful assistant.".to_string()),
        created_at: now.clone(),
        generated_by: None,
        annotations: vec![],
        swipe_group: None,
        pinned: false,
        thinking: None,
        logprobs: None,
    };

    let main_branch = Branch {
        name: "main".to_string(),
        head: root_turn_id.clone(),
        created_at: now.clone(),
        parent_branch: None,
        forked_at: None,
    };

    let mut file = SessionFile {
        loom_schema: LOOM_SCHEMA_V1,
        session: Session {
            id: session_id,
            title,
            created_at: now,
            model,
            default_options: Default::default(),
            default_endpoint: "http://localhost:11434/api/chat".to_string(),
            context_limit: None,
            default_seed: None,
        },
        turns: Default::default(),
        branches: Default::default(),
        head_branch: branch_id.clone(),
    };
    file.turns.insert(root_turn_id, root_turn);
    file.branches.insert(branch_id, main_branch);

    store_io::write_session_atomic(&dir, &file)?;
    Ok(file)
}

/// Append a turn under the current head of `branch_id`, advance the branch head
/// to the new turn, persist, and return the updated session.
#[tauri::command]
pub async fn turn_append(
    app: AppHandle,
    session_id: SessionId,
    branch_id: BranchId,
    role: Role,
    content: String,
    generated_by: Option<crate::store::schema::GeneratedBy>,
    logprobs: Option<Vec<TokenLogprob>>,
) -> Result<SessionFile> {
    let dir = sessions_dir(&app)?;
    let mut file = store_io::load_session(&dir, &session_id)?;

    let parent = file
        .branches
        .get(&branch_id)
        .ok_or_else(|| LoomError::Ollama(format!("branch {branch_id} not found")))?
        .head
        .clone();

    let (thinking, cleaned) = if matches!(role, Role::Assistant) {
        store_ops::split_thinking(&content)
    } else {
        (None, content)
    };

    let new_turn = Turn {
        id: TurnId::generate(),
        parent: Some(parent),
        role,
        content: cleaned,
        created_at: now_iso(),
        generated_by,
        annotations: vec![],
        swipe_group: None,
        pinned: false,
        thinking,
        logprobs,
    };
    let new_turn_id = new_turn.id.clone();
    file.turns.insert(new_turn_id.clone(), new_turn);
    file.branches.get_mut(&branch_id).unwrap().head = new_turn_id;

    store_io::write_session_atomic(&dir, &file)?;
    Ok(file)
}

/// Phase-2 branch fork: create a new branch starting from an existing turn.
#[tauri::command]
pub async fn branch_fork(
    app: AppHandle,
    session_id: SessionId,
    from_turn: TurnId,
    name: String,
) -> Result<SessionFile> {
    let dir = sessions_dir(&app)?;
    let mut file = store_io::load_session(&dir, &session_id)?;

    if !file.turns.contains_key(&from_turn) {
        return Err(LoomError::Ollama(format!("turn {from_turn} not found")));
    }

    let parent_branch = Some(file.head_branch.clone());
    let new_branch = Branch {
        name,
        head: from_turn.clone(),
        created_at: now_iso(),
        parent_branch,
        forked_at: Some(from_turn),
    };
    file.branches.insert(BranchId::generate(), new_branch);

    store_io::write_session_atomic(&dir, &file)?;
    Ok(file)
}

/// Phase-4 edit-and-fork. Creates a sibling turn (same parent, same role, new
/// content) + new branch pointing at it, switches head_branch to the new
/// branch. Original turn is not touched.
#[tauri::command]
pub async fn branch_fork_from_edit(
    app: AppHandle,
    session_id: SessionId,
    edited_turn_id: TurnId,
    new_content: String,
) -> Result<SessionFile> {
    let dir = sessions_dir(&app)?;
    let mut file = store_io::load_session(&dir, &session_id)?;
    store_ops::fork_from_edit(&mut file, &edited_turn_id, new_content, now_iso())
        .map_err(LoomError::Ollama)?;
    store_io::write_session_atomic(&dir, &file)?;
    Ok(file)
}

#[tauri::command]
pub async fn branch_checkout(
    app: AppHandle,
    session_id: SessionId,
    branch_id: BranchId,
) -> Result<SessionFile> {
    let dir = sessions_dir(&app)?;
    let mut file = store_io::load_session(&dir, &session_id)?;
    store_ops::checkout(&mut file, &branch_id).map_err(LoomError::Ollama)?;
    store_io::write_session_atomic(&dir, &file)?;
    Ok(file)
}

#[tauri::command]
pub async fn turn_pin(
    app: AppHandle,
    session_id: SessionId,
    turn_id: TurnId,
    pinned: bool,
) -> Result<SessionFile> {
    let dir = sessions_dir(&app)?;
    let mut file = store_io::load_session(&dir, &session_id)?;
    store_ops::set_pinned(&mut file, &turn_id, pinned).map_err(LoomError::Ollama)?;
    store_io::write_session_atomic(&dir, &file)?;
    Ok(file)
}

#[tauri::command]
pub async fn session_set_context_limit(
    app: AppHandle,
    session_id: SessionId,
    limit: Option<u32>,
) -> Result<SessionFile> {
    let dir = sessions_dir(&app)?;
    let mut file = store_io::load_session(&dir, &session_id)?;
    store_ops::set_context_limit(&mut file, limit);
    store_io::write_session_atomic(&dir, &file)?;
    Ok(file)
}
