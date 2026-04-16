use std::collections::HashSet;

use thiserror::Error;

use crate::store::schema::{BranchId, SessionFile, TurnId, LOOM_SCHEMA_V1};

#[derive(Debug, Error)]
pub enum Invalid {
    #[error("unsupported loom_schema version: {0} (expected {LOOM_SCHEMA_V1})")]
    SchemaVersion(u32),

    #[error("head_branch {0} does not exist in branches map")]
    MissingHeadBranch(BranchId),

    #[error("branch {0} head points at turn {1} which does not exist")]
    MissingBranchHead(BranchId, TurnId),

    #[error("turn {0} references missing parent turn {1}")]
    MissingParent(TurnId, TurnId),

    #[error("cycle detected at turn {0}")]
    Cycle(TurnId),

    #[error("orphan turn {0} is not reachable from any branch head")]
    Orphan(TurnId),

    #[error("branch {0} forked_at turn {1} which does not exist")]
    MissingForkedAt(BranchId, TurnId),
}

pub fn validate(file: &SessionFile) -> Result<(), Invalid> {
    if file.loom_schema != LOOM_SCHEMA_V1 {
        return Err(Invalid::SchemaVersion(file.loom_schema));
    }

    if !file.branches.contains_key(&file.head_branch) {
        return Err(Invalid::MissingHeadBranch(file.head_branch.clone()));
    }

    for (bid, b) in &file.branches {
        if !file.turns.contains_key(&b.head) {
            return Err(Invalid::MissingBranchHead(bid.clone(), b.head.clone()));
        }
        if let Some(forked) = &b.forked_at {
            if !file.turns.contains_key(forked) {
                return Err(Invalid::MissingForkedAt(bid.clone(), forked.clone()));
            }
        }
    }

    for (tid, t) in &file.turns {
        if let Some(parent) = &t.parent {
            if !file.turns.contains_key(parent) {
                return Err(Invalid::MissingParent(tid.clone(), parent.clone()));
            }
        }
    }

    for tid in file.turns.keys() {
        let mut seen = HashSet::new();
        let mut cur: Option<TurnId> = Some(tid.clone());
        while let Some(c) = cur {
            if !seen.insert(c.clone()) {
                return Err(Invalid::Cycle(tid.clone()));
            }
            cur = file.turns.get(&c).and_then(|t| t.parent.clone());
        }
    }

    let mut reachable: HashSet<TurnId> = HashSet::new();
    for b in file.branches.values() {
        let mut cur: Option<TurnId> = Some(b.head.clone());
        while let Some(c) = cur {
            if !reachable.insert(c.clone()) {
                break;
            }
            cur = file.turns.get(&c).and_then(|t| t.parent.clone());
        }
    }
    for tid in file.turns.keys() {
        if !reachable.contains(tid) {
            return Err(Invalid::Orphan(tid.clone()));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::ollama::chat::{Options, Role};
    use crate::store::schema::{Branch, Session, SessionId, Turn};

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

    fn mk_branch(name: &str, head: &str) -> Branch {
        Branch {
            name: name.to_string(),
            head: TurnId::new(head),
            created_at: "2026-04-16T12:00:00Z".to_string(),
            parent_branch: None,
            forked_at: None,
        }
    }

    fn base_file() -> SessionFile {
        let mut turns = BTreeMap::new();
        turns.insert(TurnId::new("t1"), mk_turn("t1", None, Role::System, "sys"));
        turns.insert(TurnId::new("t2"), mk_turn("t2", Some("t1"), Role::User, "u"));
        turns.insert(
            TurnId::new("t3"),
            mk_turn("t3", Some("t2"), Role::Assistant, "a"),
        );

        let mut branches = BTreeMap::new();
        branches.insert(BranchId::new("b_main"), mk_branch("main", "t3"));

        SessionFile {
            loom_schema: LOOM_SCHEMA_V1,
            session: Session {
                id: SessionId::new("sess_0"),
                title: "test".to_string(),
                created_at: "2026-04-16T12:00:00Z".to_string(),
                model: "llama3.1:8b".to_string(),
                default_options: Options::default(),
                default_endpoint: "http://localhost:11434/api/chat".to_string(),
                context_limit: None,
                default_seed: None,
            },
            turns,
            branches,
            head_branch: BranchId::new("b_main"),
        }
    }

    #[test]
    fn accepts_valid_linear_session() {
        let file = base_file();
        validate(&file).expect("linear 3-turn session is valid");
    }

    #[test]
    fn accepts_valid_3way_fork() {
        let mut file = base_file();
        file.turns.insert(
            TurnId::new("t4"),
            mk_turn("t4", Some("t2"), Role::Assistant, "alt-a"),
        );
        file.turns.insert(
            TurnId::new("t5"),
            mk_turn("t5", Some("t2"), Role::Assistant, "alt-b"),
        );
        file.branches
            .insert(BranchId::new("b_alt1"), mk_branch("alt1", "t4"));
        file.branches
            .insert(BranchId::new("b_alt2"), mk_branch("alt2", "t5"));

        validate(&file).expect("3-way fork from t2 is valid");
    }

    #[test]
    fn rejects_missing_parent() {
        let mut file = base_file();
        file.turns.insert(
            TurnId::new("t4"),
            mk_turn("t4", Some("t999"), Role::User, "orphan"),
        );
        file.branches
            .insert(BranchId::new("b_bad"), mk_branch("bad", "t4"));

        let err = validate(&file).unwrap_err();
        assert!(matches!(err, Invalid::MissingParent(_, _)));
    }

    #[test]
    fn rejects_cycle() {
        let mut file = base_file();
        // Make t1 point to t3, which points to t2, which points to t1 → cycle
        file.turns.get_mut(&TurnId::new("t1")).unwrap().parent = Some(TurnId::new("t3"));
        let err = validate(&file).unwrap_err();
        assert!(matches!(err, Invalid::Cycle(_)));
    }

    #[test]
    fn rejects_orphan_turn() {
        let mut file = base_file();
        // t4 exists but no branch points at it and it's disconnected
        file.turns
            .insert(TurnId::new("t4"), mk_turn("t4", None, Role::User, "orphan"));
        let err = validate(&file).unwrap_err();
        assert!(matches!(err, Invalid::Orphan(_)));
    }

    #[test]
    fn rejects_missing_head_branch() {
        let mut file = base_file();
        file.head_branch = BranchId::new("b_nope");
        let err = validate(&file).unwrap_err();
        assert!(matches!(err, Invalid::MissingHeadBranch(_)));
    }

    #[test]
    fn rejects_missing_branch_head_turn() {
        let mut file = base_file();
        file.branches
            .get_mut(&BranchId::new("b_main"))
            .unwrap()
            .head = TurnId::new("t_nope");
        let err = validate(&file).unwrap_err();
        assert!(matches!(err, Invalid::MissingBranchHead(_, _)));
    }

    #[test]
    fn rejects_unsupported_schema_version() {
        let mut file = base_file();
        file.loom_schema = 999;
        let err = validate(&file).unwrap_err();
        assert!(matches!(err, Invalid::SchemaVersion(999)));
    }
}
