use std::path::PathBuf;

// Default system-wide install root. The final placement step there always
// goes through the pkexec wrapper (see src-tauri/pkexec-wrapper.sh) — Rust
// itself never runs as root.
pub const SYSTEM_WIDE_ROOT: &str = "/opt/UnrealEngine";

pub fn user_engines_root() -> Result<PathBuf, String> {
    let data_dir = dirs::data_dir().ok_or("could not resolve XDG data directory")?;
    Ok(data_dir.join("ueassistant").join("engines"))
}

pub fn install_dir_for(version: &str, system_wide: bool) -> Result<PathBuf, String> {
    if system_wide {
        Ok(PathBuf::from(SYSTEM_WIDE_ROOT).join(version))
    } else {
        Ok(user_engines_root()?.join(version))
    }
}

// Staging area for in-progress downloads/extraction. Always user-writable,
// even for a system-wide install — only the final move is privileged.
pub fn staging_dir_for(version: &str) -> Result<PathBuf, String> {
    let data_dir = dirs::data_dir().ok_or("could not resolve XDG data directory")?;
    Ok(data_dir.join("ueassistant").join("staging").join(version))
}

pub fn state_file_path() -> Result<PathBuf, String> {
    let data_dir = dirs::data_dir().ok_or("could not resolve XDG data directory")?;
    Ok(data_dir.join("ueassistant").join("engines.json"))
}

pub fn user_desktop_entry_dir() -> Result<PathBuf, String> {
    let data_dir = dirs::data_dir().ok_or("could not resolve XDG data directory")?;
    Ok(data_dir.join("applications"))
}

pub const SYSTEM_DESKTOP_ENTRY_DIR: &str = "/usr/share/applications";

pub fn engine_binary_path(install_dir: &std::path::Path) -> PathBuf {
    install_dir.join("Engine/Binaries/Linux/UnrealEditor")
}
