use std::path::PathBuf;
use tauri::Manager;

// Maps Rust's std::env::consts::ARCH/OS to the folder names the download
// script (meta/downloadHelperBinaries.ts) and Electron's archSpecificBinary()
// (src/backend/utils.ts) both use: public/bin/{x64,arm64}/{win32,linux,darwin}.
fn arch_dir() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    }
}

fn platform_dir() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other, // "linux"
    }
}

// Resolves a bundled helper binary (legendary, gogdl, ...), mirroring
// getLegendaryBin()/archSpecificBinary() in src/backend/utils.ts: prefer the
// arch-native build under public/bin, fall back to the x64 build (assumes a
// compat layer like box64 for non-x64 hosts without a native download).
//
// In dev (`tauri dev`), CARGO_MANIFEST_DIR is baked in at compile time and
// points at src-tauri/ on the machine that ran `cargo build` — fine since dev
// always compiles and runs on the same machine. Packaged builds instead read
// from the bundled resource dir (see "resources" in tauri.conf.json).
pub fn helper_binary_path(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let bin_name = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };

    let base = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("public")
            .join("bin")
    } else {
        app.path()
            .resource_dir()
            .map_err(|e| format!("could not resolve resource directory: {e}"))?
            .join("bin")
    };

    let arch_specific = base.join(arch_dir()).join(platform_dir()).join(&bin_name);
    if arch_specific.exists() {
        return Ok(arch_specific);
    }
    Ok(base.join("x64").join(platform_dir()).join(&bin_name))
}

pub fn legendary_bin_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    helper_binary_path(app, "legendary")
}

// Default system-wide install root. The final placement step there always
// goes through the pkexec wrapper (see src-tauri/pkexec-wrapper.sh) — Rust
// itself never runs as root.
pub const SYSTEM_WIDE_ROOT: &str = "/opt/UnrealEngine";

pub fn user_engines_root() -> Result<PathBuf, String> {
    let data_dir = dirs::data_dir().ok_or("could not resolve XDG data directory")?;
    Ok(data_dir.join("ueassistant").join("engines"))
}

// User picks any directory (default suggestions, or an arbitrary one via the
// native folder picker); the engine goes into a version-named subdirectory
// of it so multiple versions can share one parent without colliding.
pub fn install_dir_for(version: &str, base_dir: &std::path::Path) -> PathBuf {
    base_dir.join(version)
}

// Anywhere under $HOME is user-writable already — no elevation needed.
// Anywhere else (/opt, /usr, a second drive mounted outside the home tree,
// etc.) requires pkexec for the final placement. `base_dir` need not exist
// yet, so this is a plain prefix check rather than a canonicalize+compare
// (which would fail on a not-yet-created path).
pub fn requires_pkexec(base_dir: &std::path::Path) -> Result<bool, String> {
    let home = dirs::home_dir().ok_or("could not resolve home directory")?;
    Ok(!base_dir.starts_with(&home))
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

// XDG convention: user-level *executables* (or symlinks to them) belong in
// $HOME/.local/bin, not $HOME/.local/share — the latter is for data/config
// only. The engine install tree itself stays under user_engines_root()
// (data); this is just the thin, PATH-visible launcher pointing into it.
pub fn user_bin_dir() -> Result<PathBuf, String> {
    dirs::executable_dir().ok_or("could not resolve $HOME/.local/bin".to_string())
}

pub const SYSTEM_BIN_DIR: &str = "/usr/bin";

pub fn symlink_name_for(version: &str) -> String {
    format!("unrealeditor-{version}")
}

pub fn engine_binary_path(install_dir: &std::path::Path) -> PathBuf {
    install_dir.join("Engine/Binaries/Linux/UnrealEditor")
}
