//! Schema migration framework. On load, if `loom_schema < CURRENT`, run
//! migrations in sequence and save the upgraded file. Each migration is a
//! pure function on `serde_json::Value` so it can handle any shape — not
//! just the current `SessionFile` struct.

use std::fs;
use std::path::Path;

use crate::error::Result;
use crate::store::schema::LOOM_SCHEMA_V1;

/// The current schema version. Bump this when adding a new migration.
pub const CURRENT_SCHEMA: u32 = LOOM_SCHEMA_V1;

/// Type alias for a migration function: takes the raw JSON value and
/// returns the upgraded JSON value.
type MigrationFn = fn(serde_json::Value) -> serde_json::Value;

/// Registry of migrations. Each entry is `(from_version, to_version, function)`.
/// Run in order when a file's `loom_schema` is behind `CURRENT_SCHEMA`.
const MIGRATIONS: &[(u32, u32, MigrationFn)] = &[
    // Example for future use:
    // (1, 2, migrate_v1_to_v2),
];

/// Check if a raw JSON session file needs migration. If so, run all
/// applicable migrations in sequence, backup the original, and write
/// the upgraded file back to disk.
///
/// Returns the (possibly upgraded) JSON value ready for deserialization.
pub fn migrate_if_needed(path: &Path, raw: serde_json::Value) -> Result<serde_json::Value> {
    let schema_version = raw
        .get("loom_schema")
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as u32;

    if schema_version >= CURRENT_SCHEMA {
        return Ok(raw);
    }

    // Backup the original at <path>.v<old>.bak
    let bak_name = format!(
        "{}.v{}.bak",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("session"),
        schema_version,
    );
    let bak_path = path.parent().unwrap_or(path).join(bak_name);
    if let Ok(bytes) = fs::read(path) {
        let _ = fs::write(&bak_path, bytes);
    }

    // Run applicable migrations in order
    let mut value = raw;
    let mut current = schema_version;
    for &(from, to, migrate_fn) in MIGRATIONS {
        if current == from {
            eprintln!(
                "[loom] migrating session {:?} from v{} to v{}",
                path.file_name().unwrap_or_default(),
                from,
                to,
            );
            value = migrate_fn(value);
            current = to;
        }
    }

    // Update the schema version in the JSON
    if let Some(obj) = value.as_object_mut() {
        obj.insert(
            "loom_schema".to_string(),
            serde_json::Value::Number(CURRENT_SCHEMA.into()),
        );
    }

    // Write upgraded file back
    let json = serde_json::to_vec_pretty(&value)?;
    fs::write(path, json)?;

    eprintln!(
        "[loom] migration complete: {:?} now at v{}",
        path.file_name().unwrap_or_default(),
        CURRENT_SCHEMA,
    );

    Ok(value)
}

/// Maximum turns allowed per session. Prevents unbounded growth.
pub const MAX_TURNS_PER_SESSION: usize = 10_000;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_if_needed_passthrough_for_current_schema() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.loom.json");
        let raw = serde_json::json!({
            "loom_schema": CURRENT_SCHEMA,
            "session": {"id": "s1"},
        });
        fs::write(&path, serde_json::to_vec(&raw).unwrap()).unwrap();

        let result = migrate_if_needed(&path, raw.clone()).unwrap();
        assert_eq!(result, raw);
        // No backup created
        assert!(!dir.path().join("test.loom.json.v1.bak").exists());
    }

    #[test]
    fn migrate_if_needed_creates_backup_for_old_schema() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("old.loom.json");
        // Schema 0 is older than any valid version — migration runner should
        // still backup even if no migrations exist for 0→1 (it'll just bump
        // the version number).
        let raw = serde_json::json!({
            "loom_schema": 0,
            "session": {"id": "s1"},
        });
        fs::write(&path, serde_json::to_vec(&raw).unwrap()).unwrap();

        let result = migrate_if_needed(&path, raw).unwrap();
        assert_eq!(result["loom_schema"], CURRENT_SCHEMA);
        assert!(dir.path().join("old.loom.json.v0.bak").exists());
    }
}
