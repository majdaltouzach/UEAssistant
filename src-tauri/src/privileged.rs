use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Manager};

// Resolves the bundled pkexec-wrapper.sh: in a packaged app it ships as a
// Tauri resource, in `tauri dev` it's read straight from the crate root.
fn wrapper_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(resource_path) = app
        .path()
        .resolve("pkexec-wrapper.sh", tauri::path::BaseDirectory::Resource)
    {
        if resource_path.exists() {
            return Ok(resource_path);
        }
    }

    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("pkexec-wrapper.sh");
    if dev_path.exists() {
        return Ok(dev_path);
    }

    Err("pkexec-wrapper.sh not found (neither as a bundled resource nor in the dev tree)".into())
}

fn run_pkexec(app: &AppHandle, args: &[&str]) -> Result<(), String> {
    let script = wrapper_script_path(app)?;
    let output = Command::new("pkexec")
        .arg(&script)
        .args(args)
        .output()
        .map_err(|e| format!("failed to invoke pkexec: {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    Ok(())
}

// Moves an already-downloaded, already-extracted staging directory into its
// final /opt/UnrealEngine/<version> home, as root. Rust/legendary never run
// as root for the download or extraction themselves — only this move.
pub fn install_system_wide(
    app: &AppHandle,
    staging_dir: &std::path::Path,
    dest_dir: &std::path::Path,
) -> Result<(), String> {
    run_pkexec(
        app,
        &["install", &staging_dir.to_string_lossy(), &dest_dir.to_string_lossy()],
    )
}

pub fn uninstall_system_wide(app: &AppHandle, dest_dir: &std::path::Path) -> Result<(), String> {
    run_pkexec(app, &["uninstall", &dest_dir.to_string_lossy()])
}

pub fn install_desktop_entry_system_wide(
    app: &AppHandle,
    src_file: &std::path::Path,
    dest_dir: &std::path::Path,
) -> Result<(), String> {
    run_pkexec(
        app,
        &[
            "install-desktop-entry",
            &src_file.to_string_lossy(),
            &dest_dir.to_string_lossy(),
        ],
    )
}

pub fn uninstall_desktop_entry_system_wide(
    app: &AppHandle,
    dest_file: &std::path::Path,
) -> Result<(), String> {
    run_pkexec(app, &["uninstall-desktop-entry", &dest_file.to_string_lossy()])
}

pub fn install_symlink_system_wide(
    app: &AppHandle,
    target: &std::path::Path,
    link_path: &std::path::Path,
) -> Result<(), String> {
    run_pkexec(
        app,
        &["install-symlink", &target.to_string_lossy(), &link_path.to_string_lossy()],
    )
}

pub fn uninstall_symlink_system_wide(app: &AppHandle, link_path: &std::path::Path) -> Result<(), String> {
    run_pkexec(app, &["uninstall-symlink", &link_path.to_string_lossy()])
}
