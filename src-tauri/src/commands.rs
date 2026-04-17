use std::path::PathBuf;
use std::process::Stdio;

use futures::StreamExt;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::error::{LoomError, Result};
use crate::ollama::{
    self,
    chat::{chat_stream, ChatRequest, Message, Options, Role, StreamEvent, TokenLogprob},
    generate::{generate_stream, GenerateRequest},
    templates::{render_template, ChatTemplate},
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
    pub garak_abort: std::sync::Mutex<Option<tokio::task::AbortHandle>>,
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
            garak_abort: std::sync::Mutex::new(None),
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
pub async fn turn_annotate(
    app: AppHandle,
    session_id: SessionId,
    turn_id: TurnId,
    annotations: Vec<String>,
) -> Result<SessionFile> {
    let dir = sessions_dir(&app)?;
    let mut file = store_io::load_session(&dir, &session_id)?;
    store_ops::set_annotations(&mut file, &turn_id, annotations)
        .map_err(LoomError::Ollama)?;
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

// ────────────────────────────── Prompt library ───────────────────────────────

fn prompts_dir(app: &AppHandle) -> Result<PathBuf> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| LoomError::Ollama(format!("app_data_dir: {e}")))?;
    let dir = base.join("prompts");
    Ok(dir)
}

#[derive(Clone, Serialize)]
pub struct PromptEntry {
    pub name: String,
    pub content: String,
}

#[tauri::command]
pub async fn prompt_list(app: AppHandle) -> Result<Vec<PromptEntry>> {
    let dir = prompts_dir(&app)?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(LoomError::Io)? {
        let entry = entry.map_err(LoomError::Io)?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let name = path
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("untitled")
                .to_string();
            let content = std::fs::read_to_string(&path).map_err(LoomError::Io)?;
            out.push(PromptEntry { name, content });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
pub async fn prompt_save(app: AppHandle, name: String, content: String) -> Result<()> {
    let dir = prompts_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(LoomError::Io)?;
    let path = dir.join(format!("{name}.md"));
    std::fs::write(path, content).map_err(LoomError::Io)?;
    Ok(())
}

#[tauri::command]
pub async fn prompt_delete(app: AppHandle, name: String) -> Result<()> {
    let dir = prompts_dir(&app)?;
    let path = dir.join(format!("{name}.md"));
    if path.exists() {
        std::fs::remove_file(path).map_err(LoomError::Io)?;
    }
    Ok(())
}

// ────────────────────────────── Prefill / continue ──────────────────────────

/// Stream an assistant continuation starting from `prefill` text, using
/// `/api/generate` with `raw: true`. Renders the full prompt via the
/// per-family chat template so Ollama doesn't re-wrap the prefill.
///
/// The `prefill` is included in the rendered prompt so the model continues
/// from where it ends. The returned delta events contain ONLY the tokens
/// generated after the prefill — caller should prepend `prefill` when
/// building the final turn content.
#[tauri::command]
pub async fn ollama_continue_from_prefill(
    state: tauri::State<'_, LoomState>,
    model: String,
    messages: Vec<Message>,
    prefill: String,
    options: Option<Options>,
    on_chunk: Channel<StreamEvent>,
) -> Result<()> {
    let family = ChatTemplate::from_model(&model).ok_or_else(|| {
        LoomError::Ollama(format!(
            "model family unknown for prefill: {model} (supported: llama3/llama-3, qwen2.5, mistral/nemo)"
        ))
    })?;

    let prompt = render_template(family, &messages, Some(&prefill));

    let req = GenerateRequest {
        model,
        prompt,
        raw: true,
        stream: true,
        options,
        keep_alive: None,
    };

    let stream = generate_stream(&state.http, &state.ollama_base, req).await?;
    tokio::pin!(stream);

    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(c) if c.done => {
                on_chunk
                    .send(StreamEvent::Done {
                        prompt_eval_count: c.prompt_eval_count,
                        eval_count: c.eval_count,
                        prompt_eval_duration_ns: c.prompt_eval_duration,
                        eval_duration_ns: c.eval_duration,
                        total_duration_ns: c.total_duration,
                    })
                    .map_err(|e| LoomError::Channel(e.to_string()))?;
            }
            Ok(c) => {
                if let Some(text) = c.response {
                    on_chunk
                        .send(StreamEvent::Delta {
                            content: text,
                            logprobs: None,
                        })
                        .map_err(|e| LoomError::Channel(e.to_string()))?;
                }
            }
            Err(e) => {
                let _ = on_chunk.send(StreamEvent::Error {
                    message: e.to_string(),
                });
                return Err(e);
            }
        }
    }
    Ok(())
}

// ────────────────────────────── Garak scan ───────────────────────────────

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GarakEvent {
    Stdout { line: String },
    Stderr { line: String },
    Done { exit_code: i32, report_path: Option<String> },
    Error { message: String },
}

/// Extract the path of a generated Garak HTML report from one of its log
/// lines. Garak prints variants like:
///   "report closed :) /path/to/run.report.html"
///   "report stored at /path/to/run.report.html"
///   "reporting to /path/to/run.report.jsonl"
/// Returns the first `.report.html` path seen in the line, if any.
fn parse_report_path(line: &str) -> Option<String> {
    // Find last .report.html occurrence
    let needle = ".report.html";
    let end = line.rfind(needle)?;
    let after = end + needle.len();
    // Walk backwards to the start of the path token
    let bytes = line.as_bytes();
    let mut start = end;
    while start > 0 {
        let b = bytes[start - 1];
        if b == b' ' || b == b'\t' || b == b'\'' || b == b'"' || b == b'(' {
            break;
        }
        start -= 1;
    }
    Some(line[start..after].to_string())
}

#[tauri::command]
pub async fn garak_scan(
    state: tauri::State<'_, LoomState>,
    model: String,
    probes: Option<String>,
    generations: Option<u32>,
    on_event: Channel<GarakEvent>,
) -> Result<()> {
    let probe_arg = probes.unwrap_or_else(|| "latentinjection".to_string());
    let generations = generations.unwrap_or(3);

    let chan = on_event.clone();
    let task = tokio::spawn(async move {
        garak_scan_inner(&model, &probe_arg, generations, &chan).await
    });

    {
        let mut lock = state.garak_abort.lock().unwrap();
        *lock = Some(task.abort_handle());
    }

    match task.await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            let _ = on_event.send(GarakEvent::Error { message: e.to_string() });
        }
        Err(_) => {
            let _ = on_event.send(GarakEvent::Done {
                exit_code: -1,
                report_path: None,
            });
            let _ = on_event.send(GarakEvent::Error {
                message: "scan cancelled".to_string(),
            });
        }
    }

    {
        let mut lock = state.garak_abort.lock().unwrap();
        *lock = None;
    }
    Ok(())
}

async fn garak_scan_inner(
    model: &str,
    probe_arg: &str,
    generations: u32,
    on_event: &Channel<GarakEvent>,
) -> Result<()> {
    let mut cmd = tokio::process::Command::new("garak");
    cmd.args([
        "--model_type",
        "ollama",
        "--model_name",
        model,
        "--probes",
        probe_arg,
        "--generations",
        &generations.to_string(),
    ])
    .env("PYTHONIOENCODING", "utf-8")
    .env("PYTHONUNBUFFERED", "1")
    .env("TQDM_DISABLE", "1")
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let msg = "garak binary not found on PATH. Install with: pipx install garak".to_string();
            let _ = on_event.send(GarakEvent::Error { message: msg.clone() });
            return Err(LoomError::Ollama(msg));
        }
        Err(e) => {
            let _ = on_event.send(GarakEvent::Error { message: e.to_string() });
            return Err(LoomError::Io(e));
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let stdout_chan = on_event.clone();
    let stdout_task = tokio::spawn(async move {
        let mut report_path: Option<String> = None;
        if let Some(s) = stdout {
            let mut lines = BufReader::new(s).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if report_path.is_none() {
                    report_path = parse_report_path(&line);
                }
                let _ = stdout_chan.send(GarakEvent::Stdout { line });
            }
        }
        report_path
    });

    let stderr_chan = on_event.clone();
    let stderr_task = tokio::spawn(async move {
        let mut report_path: Option<String> = None;
        if let Some(s) = stderr {
            let mut lines = BufReader::new(s).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if report_path.is_none() {
                    report_path = parse_report_path(&line);
                }
                let _ = stderr_chan.send(GarakEvent::Stderr { line });
            }
        }
        report_path
    });

    let status = child.wait().await.map_err(LoomError::Io)?;
    let out_path = stdout_task.await.ok().flatten();
    let err_path = stderr_task.await.ok().flatten();
    let report_path = out_path.or(err_path);

    on_event
        .send(GarakEvent::Done {
            exit_code: status.code().unwrap_or(-1),
            report_path,
        })
        .map_err(|e| LoomError::Channel(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn garak_cancel(state: tauri::State<'_, LoomState>) -> Result<()> {
    let handle = {
        let mut lock = state.garak_abort.lock().unwrap();
        lock.take()
    };
    if let Some(h) = handle {
        h.abort();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_report_path_extracts_html() {
        let line = "2026-04-16 report closed :) /home/u/.local/share/garak/runs/42.report.html";
        assert_eq!(
            parse_report_path(line).as_deref(),
            Some("/home/u/.local/share/garak/runs/42.report.html"),
        );
    }

    #[test]
    fn parse_report_path_handles_quoted() {
        let line = "report stored at '/tmp/x.report.html'";
        assert_eq!(
            parse_report_path(line).as_deref(),
            Some("/tmp/x.report.html"),
        );
    }

    #[test]
    fn parse_report_path_none_for_plain_line() {
        assert!(parse_report_path("probing jailbreak.1").is_none());
    }
}
