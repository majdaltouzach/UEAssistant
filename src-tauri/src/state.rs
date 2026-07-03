use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Mutex;

use crate::paths::state_file_path;

// UEAssistant's own record of what's installed. UE isn't a legendary-managed
// app (it's a direct download from unrealengine.com/linux, a separate
// distribution channel from the Epic vault/legendary manifest system), so
// there's no existing registry to piggyback on — this is authoritative.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InstalledEngine {
    pub version: String,
    pub install_path: String,
    pub system_wide: bool,
    pub installed_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct EngineRegistry {
    pub engines: Vec<InstalledEngine>,
}

// Guards read-modify-write of the state file against concurrent commands
// (e.g. an install completing while another install starts).
static STATE_LOCK: Mutex<()> = Mutex::new(());

pub fn load() -> Result<EngineRegistry, String> {
    let _guard = STATE_LOCK.lock().unwrap();
    load_unlocked()
}

fn load_unlocked() -> Result<EngineRegistry, String> {
    let path = state_file_path()?;
    if !path.exists() {
        return Ok(EngineRegistry::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    serde_json::from_str(&raw).map_err(|e| format!("failed to parse {}: {e}", path.display()))
}

fn save_unlocked(registry: &EngineRegistry) -> Result<(), String> {
    let path = state_file_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    }
    let raw = serde_json::to_string_pretty(registry).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| format!("failed to write {}: {e}", path.display()))
}

pub fn upsert(engine: InstalledEngine) -> Result<(), String> {
    let _guard = STATE_LOCK.lock().unwrap();
    let mut registry = load_unlocked()?;
    registry.engines.retain(|e| e.version != engine.version);
    registry.engines.push(engine);
    save_unlocked(&registry)
}

pub fn remove(version: &str) -> Result<(), String> {
    let _guard = STATE_LOCK.lock().unwrap();
    let mut registry = load_unlocked()?;
    registry.engines.retain(|e| e.version != version);
    save_unlocked(&registry)
}

pub fn find(version: &str) -> Result<Option<InstalledEngine>, String> {
    let registry = load()?;
    Ok(registry.engines.into_iter().find(|e| e.version == version))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_replaces_same_version() {
        let mut registry = EngineRegistry::default();
        registry.engines.push(InstalledEngine {
            version: "5.8.0".into(),
            install_path: "/old/path".into(),
            system_wide: false,
            installed_at: "2026-01-01".into(),
        });
        registry.engines.retain(|e| e.version != "5.8.0");
        registry.engines.push(InstalledEngine {
            version: "5.8.0".into(),
            install_path: "/new/path".into(),
            system_wide: true,
            installed_at: "2026-07-01".into(),
        });
        assert_eq!(registry.engines.len(), 1);
        assert_eq!(registry.engines[0].install_path, "/new/path");
        assert!(registry.engines[0].system_wide);
    }
}
