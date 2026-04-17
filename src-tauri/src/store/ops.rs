//! Pure mutations on `SessionFile` — testable without filesystem I/O.

use crate::ollama::chat::Role;
use crate::store::schema::{Branch, BranchId, SessionFile, Turn, TurnId};

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ForkResult {
    pub new_turn_id: TurnId,
    pub new_branch_id: BranchId,
}

/// Fork from an existing turn with a new content payload. Creates a sibling
/// turn (same parent, same role) and a new branch pointing at it. Existing
/// turns are never mutated.
pub fn fork_from_edit(
    file: &mut SessionFile,
    edited_turn_id: &TurnId,
    new_content: String,
    created_at: String,
) -> Result<ForkResult, String> {
    let orig = file
        .turns
        .get(edited_turn_id)
        .ok_or_else(|| format!("turn {edited_turn_id} not found"))?
        .clone();

    let new_turn_id = TurnId::generate();
    let new_turn = Turn {
        id: new_turn_id.clone(),
        parent: orig.parent.clone(),
        role: orig.role.clone(),
        content: new_content,
        created_at: created_at.clone(),
        generated_by: None,
        annotations: vec!["edit".to_string()],
        swipe_group: None,
        pinned: false,
        thinking: None,
        logprobs: None,
    };

    let new_branch_id = BranchId::generate();
    let short = &new_turn_id.as_str()[..new_turn_id.as_str().len().min(8)];
    let new_branch = Branch {
        name: format!(
            "{}-{}",
            short_role_label(&orig.role),
            short.to_ascii_lowercase()
        ),
        head: new_turn_id.clone(),
        created_at,
        parent_branch: Some(file.head_branch.clone()),
        forked_at: orig.parent.clone(),
    };

    file.turns.insert(new_turn_id.clone(), new_turn);
    file.branches.insert(new_branch_id.clone(), new_branch);
    file.head_branch = new_branch_id.clone();

    Ok(ForkResult {
        new_turn_id,
        new_branch_id,
    })
}

fn short_role_label(role: &Role) -> &'static str {
    match role {
        Role::System => "sys",
        Role::User => "user",
        Role::Assistant => "ast",
        Role::Tool => "tool",
    }
}

pub fn checkout(file: &mut SessionFile, branch_id: &BranchId) -> Result<(), String> {
    if !file.branches.contains_key(branch_id) {
        return Err(format!("branch {branch_id} not found"));
    }
    file.head_branch = branch_id.clone();
    Ok(())
}

/// Toggle the pinned flag on a turn. Pin is metadata, not content, so this
/// mutates the turn in place — the "always-fork" rule applies to content edits,
/// not to metadata like pin state.
pub fn set_pinned(
    file: &mut SessionFile,
    turn_id: &TurnId,
    pinned: bool,
) -> Result<(), String> {
    let t = file
        .turns
        .get_mut(turn_id)
        .ok_or_else(|| format!("turn {turn_id} not found"))?;
    t.pinned = pinned;
    Ok(())
}

pub fn set_context_limit(file: &mut SessionFile, limit: Option<u32>) {
    file.session.context_limit = limit;
}

pub fn set_annotations(
    file: &mut SessionFile,
    turn_id: &TurnId,
    annotations: Vec<String>,
) -> Result<(), String> {
    let t = file
        .turns
        .get_mut(turn_id)
        .ok_or_else(|| format!("turn {turn_id} not found"))?;
    t.annotations = annotations;
    Ok(())
}

/// Split an assistant response into (reasoning, clean_content).
/// Recognizes `<think>...</think>` blocks (DeepSeek-R1 / qwq convention).
/// Multiple blocks are joined with a blank line. Unclosed `<think>` blocks
/// are treated as reasoning through end of input. No blocks → (None, text).
pub fn split_thinking(text: &str) -> (Option<String>, String) {
    let open = "<think>";
    let close = "</think>";

    if !text.contains(open) {
        return (None, text.to_string());
    }

    let mut thoughts: Vec<String> = Vec::new();
    let mut clean = String::new();
    let mut rest = text;

    while let Some(open_idx) = rest.find(open) {
        clean.push_str(&rest[..open_idx]);
        let after_open = &rest[open_idx + open.len()..];
        if let Some(close_idx) = after_open.find(close) {
            thoughts.push(after_open[..close_idx].trim().to_string());
            rest = &after_open[close_idx + close.len()..];
        } else {
            // Unclosed: rest of text is reasoning.
            thoughts.push(after_open.trim().to_string());
            rest = "";
            break;
        }
    }
    clean.push_str(rest);

    let thinking = if thoughts.is_empty() {
        None
    } else {
        Some(thoughts.join("\n\n"))
    };
    (thinking, clean.trim_start_matches('\n').to_string())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::ollama::chat::Options;
    use crate::store::schema::{Session, SessionFile, SessionId, LOOM_SCHEMA_V1};
    use crate::store::validator::validate;

    fn mk_turn(id: &str, parent: Option<&str>, role: Role, content: &str) -> Turn {
        Turn {
            id: TurnId::new(id),
            parent: parent.map(TurnId::new),
            role,
            content: content.to_string(),
            created_at: "2026-04-16T12:00:00Z".to_string(),
            generated_by: None,
            annotations: vec![],
            swipe_group: None,
            pinned: false,
            thinking: None,
            logprobs: None,
        }
    }

    fn base_session() -> SessionFile {
        let mut turns = BTreeMap::new();
        turns.insert(TurnId::new("t1"), mk_turn("t1", None, Role::System, "sys"));
        turns.insert(
            TurnId::new("t2"),
            mk_turn("t2", Some("t1"), Role::User, "ask"),
        );
        turns.insert(
            TurnId::new("t3"),
            mk_turn("t3", Some("t2"), Role::Assistant, "reply"),
        );

        let mut branches = BTreeMap::new();
        branches.insert(
            BranchId::new("b_main"),
            Branch {
                name: "main".to_string(),
                head: TurnId::new("t3"),
                created_at: "2026-04-16T12:00:00Z".to_string(),
                parent_branch: None,
                forked_at: None,
            },
        );

        SessionFile {
            loom_schema: LOOM_SCHEMA_V1,
            session: Session {
                id: SessionId::new("sess_0"),
                title: "t".to_string(),
                created_at: "2026-04-16T12:00:00Z".to_string(),
                model: "llama3.1:8b".to_string(),
                default_options: Options::default(),
                default_endpoint: "http://localhost:11434/api/chat".to_string(),
                context_limit: None,
                default_seed: None,
                tags: vec![],
                provider: "ollama".to_string(),
            },
            turns,
            branches,
            head_branch: BranchId::new("b_main"),
        }
    }

    #[test]
    fn fork_from_edit_creates_new_turn_not_mutation() {
        let mut file = base_session();
        let orig_t2 = file.turns.get(&TurnId::new("t2")).unwrap().clone();

        let result = fork_from_edit(
            &mut file,
            &TurnId::new("t2"),
            "edited question".to_string(),
            "2026-04-16T13:00:00Z".to_string(),
        )
        .unwrap();

        // original turn is byte-identical
        let t2_after = file.turns.get(&TurnId::new("t2")).unwrap();
        assert_eq!(t2_after.content, orig_t2.content);
        assert_eq!(t2_after.id, orig_t2.id);

        // new turn has same parent as original (sibling), same role, new content
        let new_turn = file.turns.get(&result.new_turn_id).unwrap();
        assert_eq!(new_turn.parent, orig_t2.parent);
        assert!(matches!(new_turn.role, Role::User));
        assert_eq!(new_turn.content, "edited question");

        // new branch points at new turn
        let new_branch = file.branches.get(&result.new_branch_id).unwrap();
        assert_eq!(new_branch.head, result.new_turn_id);
        assert_eq!(new_branch.forked_at, orig_t2.parent);

        // head_branch advanced to new branch
        assert_eq!(file.head_branch, result.new_branch_id);

        // file still passes the validator
        validate(&file).expect("post-fork file is valid");
    }

    #[test]
    fn fork_preserves_invariants_across_repeated_forks() {
        let mut file = base_session();
        let mut ts = 13;
        // Fork from t2 three times → three sibling user turns, three new branches
        for _ in 0..3 {
            let iso = format!("2026-04-16T{ts:02}:00:00Z");
            fork_from_edit(&mut file, &TurnId::new("t2"), "alt".to_string(), iso).unwrap();
            ts += 1;
        }
        // Fork from t3 twice → sibling assistant turns on separate branches
        for _ in 0..2 {
            let iso = format!("2026-04-16T{ts:02}:00:00Z");
            fork_from_edit(&mut file, &TurnId::new("t3"), "alt reply".to_string(), iso)
                .unwrap();
            ts += 1;
        }
        assert_eq!(file.turns.len(), 3 + 3 + 2);
        assert_eq!(file.branches.len(), 1 + 3 + 2);
        validate(&file).expect("5 forks keep the file valid");
    }

    #[test]
    fn fork_of_missing_turn_errors() {
        let mut file = base_session();
        let err = fork_from_edit(
            &mut file,
            &TurnId::new("not-a-real-turn"),
            "x".to_string(),
            "2026-04-16T13:00:00Z".to_string(),
        );
        assert!(err.is_err());
    }

    #[test]
    fn checkout_switches_head() {
        let mut file = base_session();
        // Add a second branch and check out to it
        fork_from_edit(
            &mut file,
            &TurnId::new("t2"),
            "alt".to_string(),
            "2026-04-16T13:00:00Z".to_string(),
        )
        .unwrap();
        // We're now on the fork branch; check out back to main
        checkout(&mut file, &BranchId::new("b_main")).unwrap();
        assert_eq!(file.head_branch, BranchId::new("b_main"));
    }

    #[test]
    fn checkout_of_missing_branch_errors() {
        let mut file = base_session();
        let err = checkout(&mut file, &BranchId::new("b_nope"));
        assert!(err.is_err());
    }

    #[test]
    fn set_pinned_toggles_flag_in_place() {
        let mut file = base_session();
        let original_content = file.turns.get(&TurnId::new("t2")).unwrap().content.clone();

        set_pinned(&mut file, &TurnId::new("t2"), true).unwrap();
        assert!(file.turns.get(&TurnId::new("t2")).unwrap().pinned);
        assert_eq!(
            file.turns.get(&TurnId::new("t2")).unwrap().content,
            original_content,
            "content must not change when pinning"
        );

        set_pinned(&mut file, &TurnId::new("t2"), false).unwrap();
        assert!(!file.turns.get(&TurnId::new("t2")).unwrap().pinned);
    }

    #[test]
    fn set_pinned_rejects_missing_turn() {
        let mut file = base_session();
        let err = set_pinned(&mut file, &TurnId::new("t_nope"), true);
        assert!(err.is_err());
    }

    #[test]
    fn split_thinking_no_block_returns_none() {
        let (t, c) = split_thinking("just a plain response.");
        assert_eq!(t, None);
        assert_eq!(c, "just a plain response.");
    }

    #[test]
    fn split_thinking_single_block() {
        let (t, c) = split_thinking("<think>reason here</think>\nfinal answer");
        assert_eq!(t.as_deref(), Some("reason here"));
        assert_eq!(c, "final answer");
    }

    #[test]
    fn split_thinking_multiple_blocks_joined() {
        let input = "<think>step 1</think>maybe <think>step 2</think>done.";
        let (t, c) = split_thinking(input);
        assert_eq!(t.as_deref(), Some("step 1\n\nstep 2"));
        assert_eq!(c, "maybe done.");
    }

    #[test]
    fn split_thinking_unclosed_block_grabs_rest() {
        let (t, c) = split_thinking("prefix <think>dangling reasoning");
        assert_eq!(t.as_deref(), Some("dangling reasoning"));
        assert_eq!(c, "prefix ");
    }

    #[test]
    fn split_thinking_preserves_whitespace_in_clean() {
        let (_, c) = split_thinking("<think>x</think>\n\na\nb\n");
        assert_eq!(c, "a\nb\n");
    }

    #[test]
    fn set_context_limit_updates_session() {
        let mut file = base_session();
        assert_eq!(file.session.context_limit, None);
        set_context_limit(&mut file, Some(4));
        assert_eq!(file.session.context_limit, Some(4));
        set_context_limit(&mut file, None);
        assert_eq!(file.session.context_limit, None);
    }
}
