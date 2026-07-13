use tauri::AppHandle;

use crate::commands::ue_engine::list_available_ue_linux_builds;
use crate::desktop_entry::{desktop_entry_contents, file_name_for};
use crate::download::download_resumable;
use crate::extract::extract_zip_streaming;
use crate::paths::{
    install_dir_for, requires_pkexec, staging_dir_for, symlink_name_for, user_bin_dir,
    user_desktop_entry_dir, user_engines_root, SYSTEM_BIN_DIR, SYSTEM_DESKTOP_ENTRY_DIR,
    SYSTEM_WIDE_ROOT,
};
use crate::privileged;
use crate::state::{self, InstalledEngine};

// Lets the frontend pre-fill the "install for me only" / "install for all
// users" quick options with the exact resolved path (rather than duplicating
// the XDG-vs-/opt logic in TypeScript), and lets it prefix-check an arbitrary
// chosen path against $HOME to show a live "needs admin password" hint
// before the user commits to Install (paths::requires_pkexec is still the
// authoritative check, run again server-side in install_ue itself).
#[tauri::command]
pub fn default_user_install_dir() -> Result<String, String> {
    Ok(user_engines_root()?.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn default_system_install_dir() -> String {
    SYSTEM_WIDE_ROOT.to_string()
}

#[tauri::command]
pub fn home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "could not resolve home directory".to_string())
}

// Native folder picker for "install somewhere else". Returns None if the
// user cancels. Blocking (rfd has no async API on Linux/GTK), but this is a
// short-lived modal dialog invoked directly from a user click, not on the
// download/extraction hot path.
#[tauri::command]
pub fn pick_install_directory() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Choose Unreal Engine install location")
        .pick_folder()
        .map(|p| p.to_string_lossy().into_owned())
}

async fn refetch_download_url(app: &AppHandle, version: &str) -> Result<String, String> {
    let builds = list_available_ue_linux_builds(app.clone()).await?;
    // Fab/Bridge companion zips now share the same `version` key as the
    // engine archive itself (grouped for the UI's collapse/expand extras
    // section) — pin the refetch to the actual engine zip specifically, or
    // a mid-download URL-expiry refetch could resume against the wrong file.
    builds
        .into_iter()
        .find(|b| b.version == version && b.file_name.starts_with("Linux_Unreal_Engine_"))
        .map(|b| b.download_url)
        .ok_or_else(|| format!("version {version} no longer listed on unrealengine.com/linux"))
}

// download -> extract -> place at resolved path -> verify -> record.
// `download_url` is the presigned S3 URL from list_available_ue_linux_builds
// (fetched fresh right before this call, per that command's 1hr-expiry
// note). Runs the actual download/extraction as the current user always.
// `install_path` is the user-chosen parent directory (default suggestion or
// arbitrary, via pick_install_directory) — whether the final placement needs
// pkexec is derived from it here (anywhere under $HOME: no; anywhere else:
// yes), never trusted as a client-supplied bool.
#[tauri::command]
pub async fn install_ue(
    app: AppHandle,
    version: String,
    download_url: String,
    install_path: String,
) -> Result<(), String> {
    let base_dir = std::path::PathBuf::from(install_path);
    let system_wide = requires_pkexec(&base_dir)?;

    let staging_dir = staging_dir_for(&version)?;
    tokio::fs::create_dir_all(&staging_dir)
        .await
        .map_err(|e| format!("failed to create {}: {e}", staging_dir.display()))?;

    let zip_path = staging_dir.join(format!("{version}.zip"));
    let extract_dir = staging_dir.join("extracted");

    {
        let app_for_refetch = app.clone();
        let version_for_refetch = version.clone();
        let refetch = move || {
            let app = app_for_refetch.clone();
            let version = version_for_refetch.clone();
            Box::pin(async move { refetch_download_url(&app, &version).await })
                as std::pin::Pin<Box<dyn std::future::Future<Output = Result<String, String>> + Send>>
        };
        download_resumable(&app, &version, download_url, &zip_path, &refetch).await?;
    }

    {
        let app = app.clone();
        let version = version.clone();
        let zip_path = zip_path.clone();
        let extract_dir = extract_dir.clone();
        tokio::task::spawn_blocking(move || extract_zip_streaming(&app, &version, &zip_path, &extract_dir))
            .await
            .map_err(|e| format!("extraction task panicked: {e}"))??;
    }

    let binary = crate::paths::engine_binary_path(&extract_dir);
    if !binary.exists() {
        return Err(format!(
            "extracted archive doesn't contain {} — corrupt or unexpected archive layout",
            binary.display()
        ));
    }

    let dest_dir = install_dir_for(&version, &base_dir);
    place_engine(&app, &extract_dir, &dest_dir, system_wide).await?;

    // Zip no longer needed once successfully extracted and placed.
    let _ = tokio::fs::remove_file(&zip_path).await;
    let _ = tokio::fs::remove_dir_all(&staging_dir).await;

    install_desktop_entry(&app, &version, &dest_dir, system_wide).await?;
    install_symlink(&app, &version, &dest_dir, system_wide).await?;

    state::upsert(InstalledEngine {
        version: version.clone(),
        install_path: dest_dir.to_string_lossy().into_owned(),
        system_wide,
        installed_at: chrono_now(),
    })?;

    Ok(())
}

// Epic ships each UE version as a full archive, not a delta — there's no
// chunked-manifest patching available through this distribution channel
// (unlike legendary's vault installs). "Update" is a full re-download of
// the target version into its own versioned directory; it never touches
// other installed versions or user Projects directories (those live
// outside any Engine/<version> path).
#[tauri::command]
pub async fn update_ue(
    app: AppHandle,
    version: String,
    download_url: String,
    install_path: String,
) -> Result<(), String> {
    install_ue(app, version, download_url, install_path).await
}

#[tauri::command]
pub async fn uninstall_ue(app: AppHandle, version: String) -> Result<(), String> {
    let engine = state::find(&version)?
        .ok_or_else(|| format!("{version} is not installed"))?;
    let dest_dir = std::path::PathBuf::from(&engine.install_path);

    if engine.system_wide {
        privileged::uninstall_system_wide(&app, &dest_dir)?;
    } else if dest_dir.exists() {
        tokio::fs::remove_dir_all(&dest_dir)
            .await
            .map_err(|e| format!("failed to remove {}: {e}", dest_dir.display()))?;
    }

    uninstall_desktop_entry(&app, &version, engine.system_wide).await?;
    uninstall_symlink(&app, &version, engine.system_wide).await?;
    state::remove(&version)?;
    Ok(())
}

#[tauri::command]
pub fn list_installed_engines() -> Result<Vec<InstalledEngine>, String> {
    Ok(state::load()?.engines)
}

async fn place_engine(
    app: &AppHandle,
    extract_dir: &std::path::Path,
    dest_dir: &std::path::Path,
    system_wide: bool,
) -> Result<(), String> {
    if system_wide {
        privileged::install_system_wide(app, extract_dir, dest_dir)
    } else {
        if let Some(parent) = dest_dir.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
        }
        if dest_dir.exists() {
            tokio::fs::remove_dir_all(dest_dir)
                .await
                .map_err(|e| format!("failed to remove existing {}: {e}", dest_dir.display()))?;
        }
        match tokio::fs::rename(extract_dir, dest_dir).await {
            Ok(()) => Ok(()),
            // Staging and dest are normally both under the XDG data dir
            // (same filesystem), but fall back to copy+remove for the rare
            // case they aren't (e.g. dest overridden onto another mount).
            Err(e) if e.raw_os_error() == Some(libc_exdev()) => {
                copy_dir_recursive(extract_dir, dest_dir)
                    .await
                    .map_err(|e| format!("failed to copy into {}: {e}", dest_dir.display()))?;
                let _ = tokio::fs::remove_dir_all(extract_dir).await;
                Ok(())
            }
            Err(e) => Err(format!("failed to move into {}: {e}", dest_dir.display())),
        }
    }
}

// EXDEV ("Invalid cross-device link") — avoids pulling in the `libc` crate
// for one constant, which is stable across Linux targets.
fn libc_exdev() -> i32 {
    18
}

fn copy_dir_recursive<'a>(
    src: &'a std::path::Path,
    dest: &'a std::path::Path,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = std::io::Result<()>> + Send + 'a>> {
    Box::pin(async move {
        tokio::fs::create_dir_all(dest).await?;
        let mut entries = tokio::fs::read_dir(src).await?;
        while let Some(entry) = entries.next_entry().await? {
            let file_type = entry.file_type().await?;
            let dest_path = dest.join(entry.file_name());
            if file_type.is_dir() {
                copy_dir_recursive(&entry.path(), &dest_path).await?;
            } else {
                tokio::fs::copy(entry.path(), &dest_path).await?;
            }
        }
        Ok(())
    })
}

async fn install_desktop_entry(
    app: &AppHandle,
    version: &str,
    install_dir: &std::path::Path,
    system_wide: bool,
) -> Result<(), String> {
    let contents = desktop_entry_contents(version, install_dir);
    let file_name = file_name_for(version);

    if system_wide {
        let staging_dir = staging_dir_for(version)?;
        tokio::fs::create_dir_all(&staging_dir)
            .await
            .map_err(|e| e.to_string())?;
        let tmp_path = staging_dir.join(&file_name);
        tokio::fs::write(&tmp_path, contents)
            .await
            .map_err(|e| e.to_string())?;
        privileged::install_desktop_entry_system_wide(
            app,
            &tmp_path,
            std::path::Path::new(SYSTEM_DESKTOP_ENTRY_DIR),
        )?;
        let _ = tokio::fs::remove_dir_all(&staging_dir).await;
    } else {
        let dir = user_desktop_entry_dir()?;
        tokio::fs::create_dir_all(&dir)
            .await
            .map_err(|e| format!("failed to create {}: {e}", dir.display()))?;
        tokio::fs::write(dir.join(&file_name), contents)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Thin PATH-visible launcher (`unrealeditor-<version>`) pointing at the
// actual engine binary, kept separate from the engine's own data tree per
// XDG convention: executables in $HOME/.local/bin (or /usr/bin
// system-wide), data/config in $HOME/.local/share (or /opt).
async fn install_symlink(
    app: &AppHandle,
    version: &str,
    install_dir: &std::path::Path,
    system_wide: bool,
) -> Result<(), String> {
    let target = crate::paths::engine_binary_path(install_dir);
    let link_name = symlink_name_for(version);

    if system_wide {
        let link_path = std::path::Path::new(SYSTEM_BIN_DIR).join(&link_name);
        privileged::install_symlink_system_wide(app, &target, &link_path)
    } else {
        let bin_dir = user_bin_dir()?;
        tokio::fs::create_dir_all(&bin_dir)
            .await
            .map_err(|e| format!("failed to create {}: {e}", bin_dir.display()))?;
        let link_path = bin_dir.join(&link_name);
        let _ = tokio::fs::remove_file(&link_path).await;
        std::os::unix::fs::symlink(&target, &link_path)
            .map_err(|e| format!("failed to symlink {}: {e}", link_path.display()))
    }
}

async fn uninstall_symlink(app: &AppHandle, version: &str, system_wide: bool) -> Result<(), String> {
    let link_name = symlink_name_for(version);
    if system_wide {
        let link_path = std::path::Path::new(SYSTEM_BIN_DIR).join(&link_name);
        privileged::uninstall_symlink_system_wide(app, &link_path)
    } else {
        let link_path = user_bin_dir()?.join(&link_name);
        let _ = tokio::fs::remove_file(link_path).await;
        Ok(())
    }
}

async fn uninstall_desktop_entry(app: &AppHandle, version: &str, system_wide: bool) -> Result<(), String> {
    let file_name = file_name_for(version);
    if system_wide {
        let dest_file = std::path::Path::new(SYSTEM_DESKTOP_ENTRY_DIR).join(&file_name);
        privileged::uninstall_desktop_entry_system_wide(app, &dest_file)?;
    } else {
        let path = user_desktop_entry_dir()?.join(&file_name);
        let _ = tokio::fs::remove_file(path).await;
    }
    Ok(())
}

// No chrono dependency for one timestamp — SystemTime gives us enough for
// a stored "installed at" record without pulling in a whole date/time crate.
fn chrono_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", now.as_secs())
}
