use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::{LoomError, Result};
use crate::store::schema::{SessionFile, SessionId, SessionSummary};
use crate::store::validator;

const SUFFIX: &str = ".loom.json";

fn session_path(dir: &Path, id: &SessionId) -> PathBuf {
    dir.join(format!("{}{}", id.as_str(), SUFFIX))
}

fn tmp_path(dir: &Path, id: &SessionId) -> PathBuf {
    dir.join(format!("{}{}.tmp", id.as_str(), SUFFIX))
}

fn bak_path(dir: &Path, id: &SessionId) -> PathBuf {
    dir.join(format!("{}{}.bak", id.as_str(), SUFFIX))
}

pub fn read_session(path: &Path) -> Result<SessionFile> {
    let bytes = fs::read(path)?;
    let file: SessionFile = serde_json::from_slice(&bytes)?;
    validator::validate(&file).map_err(|e| LoomError::Ollama(format!("validation: {e}")))?;
    Ok(file)
}

/// Atomic write: serialize to `<id>.loom.json.tmp`, fsync, rotate the
/// existing file to `.bak`, rename `.tmp` → final. If the process dies
/// after writing `.tmp` but before the rotate, the original file is
/// untouched and `.tmp` is dropped on next load.
pub fn write_session_atomic(dir: &Path, file: &SessionFile) -> Result<()> {
    validator::validate(file).map_err(|e| LoomError::Ollama(format!("validation: {e}")))?;
    fs::create_dir_all(dir)?;

    let final_path = session_path(dir, &file.session.id);
    let tmp = tmp_path(dir, &file.session.id);
    let bak = bak_path(dir, &file.session.id);

    let json = serde_json::to_vec_pretty(file)?;
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(&json)?;
        f.sync_all()?;
    }

    if final_path.exists() {
        if bak.exists() {
            fs::remove_file(&bak)?;
        }
        fs::rename(&final_path, &bak)?;
    }

    fs::rename(&tmp, &final_path)?;
    Ok(())
}

pub fn delete_session(dir: &Path, id: &SessionId) -> Result<()> {
    for p in [session_path(dir, id), tmp_path(dir, id), bak_path(dir, id)] {
        if p.exists() {
            fs::remove_file(p)?;
        }
    }
    Ok(())
}

pub fn list_sessions(dir: &Path) -> Result<Vec<SessionSummary>> {
    let mut out = Vec::new();
    if !dir.exists() {
        return Ok(out);
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if !name.ends_with(SUFFIX) {
            continue;
        }
        if let Ok(file) = read_session(&path) {
            out.push(SessionSummary {
                id: file.session.id,
                title: file.session.title,
                created_at: file.session.created_at,
                model: file.session.model,
                turn_count: file.turns.len(),
                branch_count: file.branches.len(),
            });
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

pub fn load_session(dir: &Path, id: &SessionId) -> Result<SessionFile> {
    read_session(&session_path(dir, id))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::ollama::chat::{Options, Role};
    use crate::store::schema::{
        Branch, BranchId, Session, SessionFile, SessionId, Turn, TurnId, LOOM_SCHEMA_V1,
    };

    fn sample_file(id: &str) -> SessionFile {
        let turn = Turn {
            id: TurnId::new("t1"),
            parent: None,
            role: Role::System,
            content: "hi".to_string(),
            created_at: "2026-04-16T12:00:00Z".to_string(),
            generated_by: None,
            annotations: vec!["note".to_string()],
            swipe_group: None,
        };
        let mut turns = BTreeMap::new();
        turns.insert(TurnId::new("t1"), turn);

        let branch = Branch {
            name: "main".to_string(),
            head: TurnId::new("t1"),
            created_at: "2026-04-16T12:00:00Z".to_string(),
            parent_branch: None,
            forked_at: None,
        };
        let mut branches = BTreeMap::new();
        branches.insert(BranchId::new("b_main"), branch);

        SessionFile {
            loom_schema: LOOM_SCHEMA_V1,
            session: Session {
                id: SessionId::new(id),
                title: "t".to_string(),
                created_at: "2026-04-16T12:00:00Z".to_string(),
                model: "llama3.1:8b".to_string(),
                default_options: Options::default(),
                default_endpoint: "http://localhost:11434/api/chat".to_string(),
            },
            turns,
            branches,
            head_branch: BranchId::new("b_main"),
        }
    }

    #[test]
    fn round_trip_preserves_all_fields() {
        let dir = tempfile::tempdir().unwrap();
        let original = sample_file("sess_test_rt");
        write_session_atomic(dir.path(), &original).unwrap();
        let loaded = load_session(dir.path(), &original.session.id).unwrap();
        assert_eq!(loaded.session.id, original.session.id);
        assert_eq!(loaded.turns.len(), 1);
        assert_eq!(
            loaded.turns.values().next().unwrap().annotations,
            vec!["note".to_string()]
        );
        assert_eq!(loaded.head_branch, original.head_branch);
    }

    #[test]
    fn atomic_write_rotates_previous_to_bak() {
        let dir = tempfile::tempdir().unwrap();
        let mut v1 = sample_file("sess_test_atomic");
        v1.session.title = "v1".to_string();
        write_session_atomic(dir.path(), &v1).unwrap();

        let mut v2 = sample_file("sess_test_atomic");
        v2.session.title = "v2".to_string();
        write_session_atomic(dir.path(), &v2).unwrap();

        let final_path = session_path(dir.path(), &v2.session.id);
        let bak = bak_path(dir.path(), &v2.session.id);
        assert!(final_path.exists());
        assert!(bak.exists());

        let loaded = load_session(dir.path(), &v2.session.id).unwrap();
        assert_eq!(loaded.session.title, "v2");

        let bak_bytes = fs::read(&bak).unwrap();
        let bak_file: SessionFile = serde_json::from_slice(&bak_bytes).unwrap();
        assert_eq!(bak_file.session.title, "v1");
    }

    #[test]
    fn atomic_write_survives_tmp_left_behind() {
        // Simulate: we wrote .tmp but crashed before rotate. Next write
        // should simply overwrite .tmp without corrupting the original.
        let dir = tempfile::tempdir().unwrap();
        let v1 = sample_file("sess_test_crash");
        write_session_atomic(dir.path(), &v1).unwrap();

        let tmp = tmp_path(dir.path(), &v1.session.id);
        fs::write(&tmp, b"garbage that will be overwritten").unwrap();
        assert!(tmp.exists());

        let v2 = {
            let mut f = sample_file("sess_test_crash");
            f.session.title = "post-crash".to_string();
            f
        };
        write_session_atomic(dir.path(), &v2).unwrap();

        assert!(!tmp.exists(), "tmp should be consumed by successful write");
        let loaded = load_session(dir.path(), &v2.session.id).unwrap();
        assert_eq!(loaded.session.title, "post-crash");
    }

    #[test]
    fn list_and_delete_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let a = sample_file("sess_test_a");
        let b = sample_file("sess_test_b");
        write_session_atomic(dir.path(), &a).unwrap();
        write_session_atomic(dir.path(), &b).unwrap();

        let listed = list_sessions(dir.path()).unwrap();
        assert_eq!(listed.len(), 2);

        delete_session(dir.path(), &a.session.id).unwrap();
        let listed = list_sessions(dir.path()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, b.session.id);
    }
}
