use serde::Serialize;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
pub struct ExtractProgress {
    pub version: String,
    pub files_done: usize,
    pub files_total: usize,
    pub current_file: String,
}

// Streams a zip archive to `dest_dir`, one entry at a time, copying each
// entry in small buffered chunks rather than reading it fully into memory
// first — this is the actual memory-safety target from the original spec
// (originally assumed to be XZ/tar; Epic's unrealengine.com/linux builds
// ship as .zip instead). A 37GB UE archive must never be buffered whole.
//
// Blocking I/O — call via `tokio::task::spawn_blocking`.
pub fn extract_zip_streaming(
    app: &AppHandle,
    version: &str,
    zip_path: &Path,
    dest_dir: &Path,
) -> Result<(), String> {
    let file = File::open(zip_path).map_err(|e| format!("failed to open {}: {e}", zip_path.display()))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("corrupt zip archive: {e}"))?;

    // A retried install after a previous extraction attempt failed partway
    // could otherwise leave stale files that aren't part of the current
    // archive mixed into dest_dir — wipe it first so extraction always
    // starts from a clean tree.
    if dest_dir.exists() {
        std::fs::remove_dir_all(dest_dir)
            .map_err(|e| format!("failed to clear stale {}: {e}", dest_dir.display()))?;
    }
    std::fs::create_dir_all(dest_dir)
        .map_err(|e| format!("failed to create {}: {e}", dest_dir.display()))?;

    let total = archive.len();

    for i in 0..total {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("corrupt zip entry at index {i}: {e}"))?;

        let out_path: PathBuf = match entry.enclosed_name() {
            Some(name) => dest_dir.join(name),
            // Reject entries with unsafe paths (e.g. `../../etc/passwd`)
            // rather than silently skipping — a corrupt or tampered
            // archive shouldn't write outside dest_dir.
            None => return Err(format!("zip entry {} has an unsafe path", entry.name())),
        };

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)
                .map_err(|e| format!("failed to create {}: {e}", out_path.display()))?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
        }

        let mut out_file = File::create(&out_path)
            .map_err(|e| format!("failed to create {}: {e}", out_path.display()))?;
        io::copy(&mut entry, &mut out_file)
            .map_err(|e| format!("failed to extract {}: {e}", out_path.display()))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = entry.unix_mode() {
                let _ = std::fs::set_permissions(&out_path, std::fs::Permissions::from_mode(mode));
            }
        }

        if i % 200 == 0 || i + 1 == total {
            let _ = app.emit(
                "ue-extract-progress",
                ExtractProgress {
                    version: version.to_string(),
                    files_done: i + 1,
                    files_total: total,
                    current_file: entry.name().to_string(),
                },
            );
        }
    }

    Ok(())
}
