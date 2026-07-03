use regex::Regex;
use serde::Serialize;
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;

#[derive(Serialize)]
pub struct UeVersion {
    app_name: String,
    version: String,
}

// A native Linux Unreal Engine build, as listed on the authenticated
// www.unrealengine.com/linux page. This is a *separate* distribution
// channel from legendary/the Epic vault entitlement system — legendary
// only exposes Windows/Mac manifests for UE (`legendary list --platform
// Linux` rejects Linux as an invalid platform on a live account). Epic
// ships prebuilt Linux Editor archives only through this direct-download
// page, gated behind the same Epic account SSO session used to log in.
#[derive(Serialize, Clone, Debug)]
pub struct UeLinuxBuild {
    pub file_name: String,
    pub version: String,
    pub size_bytes: Option<u64>,
    pub uploaded: Option<String>,
    // Presigned S3 GetObject URL (1hr expiry from page load). Must be
    // used promptly — re-fetch the listing if a download needs to resume
    // after the URL has expired.
    pub download_url: String,
}

// unrealengine.com and epicgames.com are different domains — cookies from
// the epic-login webview (which only ever visits epicgames.com/id/login)
// are never sent to unrealengine.com, so a direct load of unrealengine.com/
// linux always hits unrealengine.com's own "Epic Account Required" gate. Its
// `state` param is where that gate redirects back to after unrealengine.com
// establishes its own session (via SSO against the already-live
// epicgames.com session in the shared WebKit cookie store, silently if
// that session is still valid — no re-entering credentials needed in the
// common case).
const UE_LINUX_LOGIN_URL: &str =
    "https://www.unrealengine.com/login?state=https%3A%2F%2Fwww.unrealengine.com%2Flinux";

// Holds the pending listing request while the hidden `ue-listing` webview
// loads the page; `submit_ue_listing_html` fills it in once the page's JS
// hands the rendered HTML back over IPC.
static LISTING_WAITER: Mutex<Option<oneshot::Sender<String>>> = Mutex::new(None);

// Opens a hidden webview against the authenticated unrealengine.com/linux
// page (reuses whatever Epic SSO session cookies exist from the login
// webview — Tauri/WebKitGTK webviews share one cookie store by default,
// unlike Electron's per-partition model Heroic used), waits for its own
// injected script to hand back the rendered HTML, and parses the listing
// out of it. There is no separate JSON listing API: an XHR-filtered
// Network-tab capture on page load showed only `/linux/auth` and
// `/linux/opt-in?setting=email:ue` (session-check/telemetry) — the file
// list + presigned download URLs are server-rendered directly into the
// page.
#[tauri::command]
pub async fn list_available_ue_linux_builds(app: AppHandle) -> Result<Vec<UeLinuxBuild>, String> {
    let (tx, rx) = oneshot::channel();
    *LISTING_WAITER.lock().unwrap() = Some(tx);

    // The login -> SSO -> /linux redirect chain re-fires `load` at every
    // hop in this same webview (initialization_script reruns on every
    // navigation, by design). Only send once we've actually landed on
    // /linux itself, or we'd hand back the login page's HTML instead.
    let init_script = r#"
        (function () {
            function send() {
                if (!/\/linux(\/|$|\?)/.test(window.location.pathname)) return;
                window.__TAURI__.core.invoke('submit_ue_listing_html', {
                    html: document.documentElement.outerHTML
                });
            }
            if (document.readyState === 'complete') {
                send();
            } else {
                window.addEventListener('load', send);
            }
        })();
    "#;

    let url = UE_LINUX_LOGIN_URL
        .parse()
        .map_err(|e| format!("invalid listing url: {e}"))?;

    // Visible, not headless: if the shared epicgames.com session has
    // expired, unrealengine.com's login page needs a real user to type
    // credentials into it.
    let build_result = WebviewWindowBuilder::new(&app, "ue-listing", WebviewUrl::External(url))
        .title("Fetching Unreal Engine Linux builds")
        .inner_size(500.0, 700.0)
        .initialization_script(init_script)
        .build();

    if let Err(e) = build_result {
        *LISTING_WAITER.lock().unwrap() = None;
        return Err(format!("failed to open listing window: {e}"));
    }

    let html = match tokio::time::timeout(Duration::from_secs(180), rx).await {
        Ok(Ok(html)) => html,
        Ok(Err(_)) => {
            close_listing_window(&app);
            return Err("listing window closed before returning data".to_string());
        }
        Err(_) => {
            close_listing_window(&app);
            return Err(
                "timed out waiting for unrealengine.com/linux (are you logged in?)".to_string(),
            );
        }
    };

    close_listing_window(&app);
    parse_ue_linux_listing(&html)
}

fn close_listing_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("ue-listing") {
        let _ = w.close();
    }
}

// Invoked by the injected script in the `ue-listing` webview once the page
// has finished loading. Scoped via capabilities to only be callable from
// that window's remote origin (unrealengine.com) — see
// src-tauri/capabilities/ue-listing.json.
#[tauri::command]
pub fn submit_ue_listing_html(html: String) {
    if let Some(tx) = LISTING_WAITER.lock().unwrap().take() {
        let _ = tx.send(html);
    }
}

// Best-effort scrape of the rendered page. Epic doesn't publish this as a
// documented API, so rather than depend on a specific SSR framework's data
// blob shape (which may change), we anchor on the one thing we know is
// stable and load-bearing: every download entry has a presigned S3
// GetObject URL whose `response-content-disposition` query param encodes
// the real file name. That gives us (name, url) pairs directly. Size/date
// are recovered best-effort from the surrounding text and are optional —
// a missing size/date shouldn't fail the whole listing, since the URL is
// the only field actually required to install.
fn parse_ue_linux_listing(html: &str) -> Result<Vec<UeLinuxBuild>, String> {
    let url_re = Regex::new(
        r#"https://ucs-blob-store\.s3-accelerate\.amazonaws\.com/blobs/[^"'\s<>]+"#,
    )
    .map_err(|e| e.to_string())?;
    let filename_re =
        Regex::new(r#"filename\*=UTF-8''([^&"'\s<>]+)"#).map_err(|e| e.to_string())?;
    let size_re = Regex::new(r"(\d+(?:\.\d+)?)\s*GB").map_err(|e| e.to_string())?;
    let date_re =
        Regex::new(r"[A-Z][a-z]{2} \d{1,2}, \d{4}").map_err(|e| e.to_string())?;

    let mut builds = Vec::new();
    let mut last_url_end = 0usize;

    for m in url_re.find_iter(html) {
        // `outerHTML` serializes attribute values with HTML entities
        // (`&` -> `&amp;`), so the query string separators need decoding
        // before the URL is usable as an actual download link.
        let url = m.as_str().replace("&amp;", "&");
        // Fully percent-decoded copy for pulling the file name out of
        // `response-content-disposition` — the URL itself keeps its
        // original encoding, since presigned S3 signatures cover the
        // exact query string.
        let decoded = urlencoding_decode(&url);
        let file_name = filename_re
            .captures(&decoded)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_else(|| "unknown.zip".to_string());

        // Look at the text between the end of the previous match and this
        // one for a GB size + upload date — matches table-row order in the
        // rendered markup without depending on exact tag structure.
        let window_start = last_url_end;
        let window_text = &html[window_start..m.start()];
        let size_bytes = size_re
            .captures(window_text)
            .and_then(|c| c.get(1))
            .and_then(|g| g.as_str().parse::<f64>().ok())
            .map(|gb| (gb * 1_073_741_824.0) as u64);
        let uploaded = date_re
            .find(window_text)
            .map(|m| m.as_str().to_string());

        let version = file_name
            .trim_end_matches(".zip")
            .trim_start_matches("Linux_Unreal_Engine_")
            .to_string();

        builds.push(UeLinuxBuild {
            file_name,
            version,
            size_bytes,
            uploaded,
            download_url: url,
        });

        last_url_end = m.end();
    }

    if builds.is_empty() {
        return Err(
            "no download entries found on unrealengine.com/linux — page layout may have changed, or session isn't authenticated".to_string(),
        );
    }

    // Only keep the actual engine archives (Linux_Unreal_Engine_*), not
    // the Fab/Bridge companion tool zips also listed on the same page.
    builds.retain(|b| b.file_name.starts_with("Linux_Unreal_Engine_"));

    Ok(builds)
}

fn urlencoding_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                out.push(byte as char);
                continue;
            }
        }
        out.push(c);
    }
    out
}

// Reuses the `legendary` CLI exactly as the Electron backend does
// (src/backend/storeManagers/legendary/*) — shells out rather than
// re-implementing Epic's manifest/auth protocol.
//
// UE only shows up with `--include-ue`; `--third-party` (what the
// Electron library scan currently passes) does not include it.
// Confirmed against a live account: `legendary list --include-ue`
// returns UE_4.0..UE_5.8, title "Unreal Engine", standard app_names —
// no vault/entitlement special-casing needed on install.
#[tauri::command]
pub fn list_ue_versions() -> Result<Vec<UeVersion>, String> {
    let output = Command::new("legendary")
        .args(["list", "--include-ue", "--csv"])
        .output()
        .map_err(|e| format!("failed to run legendary: {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }

    Ok(parse_ue_versions(&String::from_utf8_lossy(&output.stdout)))
}

// `legendary list --include-ue --csv` header: App name,App title,Version,Is DLC
// Filters to UE_* since --include-ue also surfaces Fab/Marketplace plugin entries
// (e.g. FabPlugin_5.5) that aren't the engine itself.
fn parse_ue_versions(csv: &str) -> Vec<UeVersion> {
    csv.lines()
        .skip(1) // header row
        .filter_map(|line| {
            let mut fields = line.split(',');
            let app_name = fields.next()?.trim().to_string();
            if !app_name.starts_with("UE_") {
                return None;
            }
            let version = fields.nth(1)?.trim().to_string();
            Some(UeVersion { app_name, version })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Captured verbatim from `legendary list --include-ue --csv` on a live account.
    const SAMPLE_CSV: &str = "App name,App title,Version,Is DLC\n\
UE_4.27Chaos,4.27-Chaos,4.27.2-18386882+++UE4+Release-4.27-Chaos-2023.1-Windows,False\n\
FabPlugin_5.3,Fab UE Plugin,5.3.0-27405482+++UE5+Release-5.3-0.0.5-48504992-Windows,False\n\
UE_5.6,Unreal Engine,5.6.1-44394996+++UE5+Release-5.6-Windows,False\n";

    #[test]
    fn filters_out_non_engine_entries_and_parses_version() {
        let versions = parse_ue_versions(SAMPLE_CSV);
        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].app_name, "UE_4.27Chaos");
        assert_eq!(
            versions[0].version,
            "4.27.2-18386882+++UE4+Release-4.27-Chaos-2023.1-Windows"
        );
        assert_eq!(versions[1].app_name, "UE_5.6");
        assert_eq!(versions[1].version, "5.6.1-44394996+++UE5+Release-5.6-Windows");
    }

    // Synthetic fragment modeled on the real unrealengine.com/linux table
    // (captured via screenshot, not real markup — see task notes: this
    // must be re-validated against a real authenticated fetch). Exercises
    // the presigned-URL-anchored scraping strategy: name+URL come from the
    // S3 link itself, size/date are recovered from the surrounding text.
    const SAMPLE_LISTING_HTML: &str = r#"
        <table>
          <tr>
            <td>Linux_Unreal_Engine_5.8.0.zip</td>
            <td>37.08 GB</td>
            <td>Jun 17, 2026</td>
            <td><a href="https://ucs-blob-store.s3-accelerate.amazonaws.com/blobs/cd/aa/c551-e891-4dc6-ad0c-2e8d719157ae?X-Amz-Algorithm=AWS4-HMAC-SHA256&amp;X-Amz-Expires=3600&amp;response-content-disposition=inline%3Bfilename%3D%22file.zip%22%3Bfilename%2A%3DUTF-8%27%27Linux_Unreal_Engine_5.8.0.zip&amp;x-id=GetObject">Download</a></td>
          </tr>
          <tr>
            <td>Linux_Fab_5.8.0_0.0.13.zip</td>
            <td>0.03 GB</td>
            <td>Jun 17, 2026</td>
            <td><a href="https://ucs-blob-store.s3-accelerate.amazonaws.com/blobs/11/22/deadbeef-e891-4dc6-ad0c-2e8d719157ae?X-Amz-Algorithm=AWS4-HMAC-SHA256&amp;X-Amz-Expires=3600&amp;response-content-disposition=inline%3Bfilename%3D%22file.zip%22%3Bfilename%2A%3DUTF-8%27%27Linux_Fab_5.8.0_0.0.13.zip&amp;x-id=GetObject">Download</a></td>
          </tr>
        </table>
    "#;

    #[test]
    fn parses_engine_entries_and_excludes_fab_companion_zips() {
        let builds = parse_ue_linux_listing(SAMPLE_LISTING_HTML).unwrap();
        assert_eq!(builds.len(), 1);
        assert_eq!(builds[0].file_name, "Linux_Unreal_Engine_5.8.0.zip");
        assert_eq!(builds[0].version, "5.8.0");
        assert!(builds[0].download_url.starts_with(
            "https://ucs-blob-store.s3-accelerate.amazonaws.com/blobs/cd/aa/"
        ));
    }

    #[test]
    fn errors_when_no_download_entries_found() {
        let err = parse_ue_linux_listing("<html><body>not logged in</body></html>").unwrap_err();
        assert!(err.contains("no download entries found"));
    }
}
