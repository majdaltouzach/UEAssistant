use futures_util::StreamExt;
use serde::Serialize;
use std::io::SeekFrom;
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::fs::OpenOptions;
use tokio::io::{AsyncSeekExt, AsyncWriteExt};

#[derive(Serialize, Clone)]
pub struct DownloadProgress {
    pub version: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub bytes_per_sec: u64,
}

// A fresh presigned URL is needed whenever the current one expires
// mid-download (Epic's S3 links are only valid for 1hr from page load) —
// the caller supplies a way to get one so this module doesn't need to know
// about the unrealengine.com listing/session logic at all.
pub type RefetchUrl<'a> = dyn Fn() -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<String, String>> + Send>>
    + Send
    + Sync
    + 'a;

// Streams `url` to `dest_path`, resuming from an existing partial file via
// HTTP Range, and re-fetching a fresh presigned URL (via `refetch_url`) if
// the current one expires (S3 returns 403 SignatureExpired-ish errors)
// partway through a large (29-37GB) download. Never buffers the whole
// response in memory — writes each chunk as it arrives.
pub async fn download_resumable(
    app: &AppHandle,
    version: &str,
    mut url: String,
    dest_path: &Path,
    refetch_url: &RefetchUrl<'_>,
) -> Result<(), String> {
    if let Some(parent) = dest_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    }

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;

    let mut attempts_left = 3u8;

    loop {
        let already_have = tokio::fs::metadata(dest_path)
            .await
            .map(|m| m.len())
            .unwrap_or(0);

        let mut req = client.get(&url);
        if already_have > 0 {
            req = req.header("Range", format!("bytes={already_have}-"));
        }

        let response = req.send().await.map_err(|e| format!("download request failed: {e}"))?;

        // Presigned S3 URL expired or was otherwise rejected — get a fresh
        // one and retry, keeping whatever bytes we already wrote to disk.
        if response.status() == reqwest::StatusCode::FORBIDDEN
            || response.status() == reqwest::StatusCode::UNAUTHORIZED
        {
            if attempts_left == 0 {
                return Err(format!(
                    "download URL rejected ({}) and out of retries",
                    response.status()
                ));
            }
            attempts_left -= 1;
            url = refetch_url().await?;
            continue;
        }

        if !response.status().is_success() && response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            return Err(format!("unexpected download status: {}", response.status()));
        }

        let resumed = response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
        let range_total = response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.rsplit('/').next())
            .and_then(|v| v.parse::<u64>().ok());
        let total_bytes = range_total.or_else(|| response.content_length().map(|len| {
            if resumed { len + already_have } else { len }
        }));

        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .open(dest_path)
            .await
            .map_err(|e| format!("failed to open {}: {e}", dest_path.display()))?;

        let start_offset = if resumed { already_have } else { 0 };
        if resumed {
            file.seek(SeekFrom::Start(start_offset))
                .await
                .map_err(|e| e.to_string())?;
        } else if already_have > 0 {
            // Server ignored our Range header (some presigned URLs / CDNs
            // do on redirect) — restart from scratch rather than corrupt
            // the file with a full body appended past existing bytes.
            file.set_len(0).await.map_err(|e| e.to_string())?;
            file.seek(SeekFrom::Start(0)).await.map_err(|e| e.to_string())?;
        }

        let mut downloaded = start_offset;
        let mut stream = response.bytes_stream();
        let mut last_emit = Instant::now();
        let mut bytes_since_last_emit = 0u64;
        let mut stream_error = None;

        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(c) => c,
                Err(e) => {
                    stream_error = Some(e.to_string());
                    break;
                }
            };
            if let Err(e) = file.write_all(&chunk).await {
                stream_error = Some(e.to_string());
                break;
            }
            downloaded += chunk.len() as u64;
            bytes_since_last_emit += chunk.len() as u64;

            if last_emit.elapsed() >= Duration::from_millis(500) {
                let secs = last_emit.elapsed().as_secs_f64().max(0.001);
                let _ = app.emit(
                    "ue-download-progress",
                    DownloadProgress {
                        version: version.to_string(),
                        downloaded_bytes: downloaded,
                        total_bytes,
                        bytes_per_sec: (bytes_since_last_emit as f64 / secs) as u64,
                    },
                );
                last_emit = Instant::now();
                bytes_since_last_emit = 0;
            }
        }
        file.flush().await.map_err(|e| e.to_string())?;

        if let Some(err) = stream_error {
            // Network hiccup mid-stream: retry (resuming) rather than
            // failing a 30+ minute download outright.
            if attempts_left == 0 {
                return Err(format!("download stream failed and out of retries: {err}"));
            }
            attempts_left -= 1;
            continue;
        }

        if let Some(total) = total_bytes {
            if downloaded < total {
                // Connection closed early — resume on next loop iteration.
                if attempts_left == 0 {
                    return Err("download ended early and out of retries".to_string());
                }
                attempts_left -= 1;
                continue;
            }
        }

        let _ = app.emit(
            "ue-download-progress",
            DownloadProgress {
                version: version.to_string(),
                downloaded_bytes: downloaded,
                total_bytes,
                bytes_per_sec: 0,
            },
        );
        return Ok(());
    }
}
