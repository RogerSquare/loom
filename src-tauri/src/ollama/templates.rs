#![allow(dead_code)]
//! Per-model chat-template registry. Wiring lands in Phase 7; Phase 1 ships
//! the registry + round-trip tests so the renderer is verified before the
//! call site exists.
//!
//! Used (in Phase 7) to render a full raw prompt that we POST to `/api/generate`
//! with `raw: true` to bypass Ollama's internal chat template — the only
//! reliable way to do assistant-message prefill ("put words in the model's
//! mouth") on Ollama. See research task feat-loom-001.
//!
//! Registered templates are verified against each model family's reference
//! `tokenizer_config.json` / Ollama Modelfile `TEMPLATE`. Phase 1 only ships
//! the registry + round-trip tests; Phase 7 wires them into `/api/generate`.

use crate::ollama::chat::{Message, Role};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatTemplate {
    Llama3,
    Qwen25,
    Mistral,
}

impl ChatTemplate {
    /// Best-effort inference from an Ollama model tag like `llama3.1:8b`.
    pub fn from_model(model: &str) -> Option<Self> {
        let lower = model.to_ascii_lowercase();
        if lower.contains("llama3") || lower.contains("llama-3") {
            Some(Self::Llama3)
        } else if lower.contains("qwen2.5") || lower.contains("qwen-2.5") || lower.contains("qwen2_5") {
            Some(Self::Qwen25)
        } else if lower.contains("mistral") || lower.contains("nemo") {
            Some(Self::Mistral)
        } else {
            None
        }
    }
}

/// Render messages to a raw prompt string matching the target family's chat
/// template. The output ends with the assistant header but **no** trailing
/// EOT/EOS token, leaving generation to continue from the model's perspective.
///
/// `prefill`, when `Some`, is spliced into the assistant turn so the model
/// continues from that text rather than starting fresh.
pub fn render_template(
    template: ChatTemplate,
    messages: &[Message],
    prefill: Option<&str>,
) -> String {
    match template {
        ChatTemplate::Llama3 => render_llama3(messages, prefill),
        ChatTemplate::Qwen25 => render_qwen25(messages, prefill),
        ChatTemplate::Mistral => render_mistral(messages, prefill),
    }
}

fn role_str(r: &Role) -> &'static str {
    match r {
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
        Role::Tool => "tool",
    }
}

/// Llama-3.x Instruct template (matches the official Meta reference).
fn render_llama3(messages: &[Message], prefill: Option<&str>) -> String {
    let mut out = String::from("<|begin_of_text|>");
    for m in messages {
        out.push_str(&format!(
            "<|start_header_id|>{}<|end_header_id|>\n\n{}<|eot_id|>",
            role_str(&m.role),
            m.content
        ));
    }
    out.push_str("<|start_header_id|>assistant<|end_header_id|>\n\n");
    if let Some(p) = prefill {
        out.push_str(p);
    }
    out
}

/// Qwen-2.5 ChatML template.
fn render_qwen25(messages: &[Message], prefill: Option<&str>) -> String {
    let mut out = String::new();
    for m in messages {
        out.push_str(&format!("<|im_start|>{}\n{}<|im_end|>\n", role_str(&m.role), m.content));
    }
    out.push_str("<|im_start|>assistant\n");
    if let Some(p) = prefill {
        out.push_str(p);
    }
    out
}

/// Mistral v7 Instruct template. System messages go into [SYSTEM_PROMPT];
/// user turns in [INST]; assistant turns are free text before </s>.
fn render_mistral(messages: &[Message], prefill: Option<&str>) -> String {
    let mut out = String::from("<s>");
    let mut pending_inst: Vec<&str> = Vec::new();
    for m in messages {
        match m.role {
            Role::System => {
                out.push_str(&format!("[SYSTEM_PROMPT]{}[/SYSTEM_PROMPT]", m.content));
            }
            Role::User => {
                pending_inst.push(m.content.as_str());
            }
            Role::Assistant => {
                if !pending_inst.is_empty() {
                    out.push_str(&format!("[INST]{}[/INST]", pending_inst.join("\n\n")));
                    pending_inst.clear();
                }
                out.push_str(&m.content);
                out.push_str("</s>");
            }
            Role::Tool => {
                pending_inst.push(m.content.as_str());
            }
        }
    }
    if !pending_inst.is_empty() {
        out.push_str(&format!("[INST]{}[/INST]", pending_inst.join("\n\n")));
    }
    if let Some(p) = prefill {
        out.push_str(p);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(role: Role, content: &str) -> Message {
        Message { role, content: content.to_string(), images: None }
    }

    #[test]
    fn llama3_round_trip() {
        let msgs = vec![
            msg(Role::System, "You are helpful."),
            msg(Role::User, "What is 2+2?"),
        ];
        let out = render_llama3(&msgs, None);
        let expected = "<|begin_of_text|>\
            <|start_header_id|>system<|end_header_id|>\n\nYou are helpful.<|eot_id|>\
            <|start_header_id|>user<|end_header_id|>\n\nWhat is 2+2?<|eot_id|>\
            <|start_header_id|>assistant<|end_header_id|>\n\n";
        assert_eq!(out, expected);
    }

    #[test]
    fn llama3_prefill_continues_assistant_turn() {
        let msgs = vec![msg(Role::User, "Hi")];
        let out = render_llama3(&msgs, Some("Sure — "));
        assert!(out.ends_with("<|start_header_id|>assistant<|end_header_id|>\n\nSure — "));
    }

    #[test]
    fn qwen25_round_trip() {
        let msgs = vec![
            msg(Role::System, "You are helpful."),
            msg(Role::User, "What is 2+2?"),
        ];
        let out = render_qwen25(&msgs, None);
        let expected = "<|im_start|>system\nYou are helpful.<|im_end|>\n\
                        <|im_start|>user\nWhat is 2+2?<|im_end|>\n\
                        <|im_start|>assistant\n";
        assert_eq!(out, expected);
    }

    #[test]
    fn mistral_round_trip() {
        let msgs = vec![
            msg(Role::System, "You are helpful."),
            msg(Role::User, "What is 2+2?"),
        ];
        let out = render_mistral(&msgs, None);
        let expected = "<s>[SYSTEM_PROMPT]You are helpful.[/SYSTEM_PROMPT][INST]What is 2+2?[/INST]";
        assert_eq!(out, expected);
    }

    #[test]
    fn mistral_alternates_turns() {
        let msgs = vec![
            msg(Role::User, "Hi"),
            msg(Role::Assistant, "Hello!"),
            msg(Role::User, "Bye"),
        ];
        let out = render_mistral(&msgs, None);
        assert_eq!(out, "<s>[INST]Hi[/INST]Hello!</s>[INST]Bye[/INST]");
    }

    #[test]
    fn template_inferred_from_model_tag() {
        assert_eq!(ChatTemplate::from_model("llama3.1:8b"), Some(ChatTemplate::Llama3));
        assert_eq!(ChatTemplate::from_model("llama-3-instruct"), Some(ChatTemplate::Llama3));
        assert_eq!(ChatTemplate::from_model("qwen2.5:7b"), Some(ChatTemplate::Qwen25));
        assert_eq!(ChatTemplate::from_model("mistral-nemo:12b"), Some(ChatTemplate::Mistral));
        assert_eq!(ChatTemplate::from_model("gemma2:9b"), None);
    }
}
