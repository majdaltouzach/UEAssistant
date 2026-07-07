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
    // The page is Next.js-rendered: the listing data is embedded as a JSON
    // string inside a <script> tag, and Next.js escapes `&`/`<`/`>` in that
    // JSON as & / < / > so the payload can't break out of the
    // script tag. Decode those before any other parsing, or the filename
    // regex below (which doesn't treat "&" as a delimiter) swallows
    // everything up to the next real quote character — e.g. the query
    // string tail `...zip&x-id=GetObject` ends up inside file_name.
    let html = decode_unicode_escapes(html);
    let html = html.as_str();

    let url_re = Regex::new(
        r#"https://ucs-blob-store\.s3-accelerate\.amazonaws\.com/blobs/[^"'\s<>]+"#,
    )
    .map_err(|e| e.to_string())?;
    let filename_re =
        Regex::new(r#"filename\*=UTF-8''([^&"'\s<>]+)"#).map_err(|e| e.to_string())?;
    let size_re = Regex::new(r"(\d+(?:\.\d+)?)\s*GB").map_err(|e| e.to_string())?;
    let date_re =
        Regex::new(r"[A-Z][a-z]{2} \d{1,2}, \d{4}").map_err(|e| e.to_string())?;
    // Engine/Fab/Bridge zips for the same release all embed the same
    // "X.Y.Z" release number in their file name (e.g.
    // Linux_Unreal_Engine_5.8.0.zip, Linux_Fab_5.8.0_0.0.13.zip,
    // Linux_Bridge_5.8.0_2025.0.1.zip all contain "5.8.0") — grouping on
    // this lets the frontend show one "Unreal Engine 5.8.0" tile with the
    // companion files collapsed underneath, instead of a flat file list.
    let version_re = Regex::new(r"\d+\.\d+\.\d+").map_err(|e| e.to_string())?;

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

        // Narrow the size/date search to the text between this row's own
        // file name (as it appears in its own visible <td>, not the URL)
        // and the download link — not the whole gap since the previous
        // link. That gap can span huge chunks of unrelated markup (nav,
        // banners, other page copy), and the *first* GB/date it happens to
        // contain isn't necessarily this row's — e.g. an unrelated "8.0 GB"
        // mention earlier on the page was previously getting picked up
        // instead of the row's real "37.08 GB".
        let search_region = &html[last_url_end..m.start()];
        let anchor_start = search_region
            .rfind(file_name.as_str())
            .map(|rel| last_url_end + rel)
            .unwrap_or(last_url_end);
        let window_text = &html[anchor_start..m.start()];
        let size_bytes = size_re
            .captures(window_text)
            .and_then(|c| c.get(1))
            .and_then(|g| g.as_str().parse::<f64>().ok())
            .map(|gb| (gb * 1_073_741_824.0) as u64);
        let uploaded = date_re
            .find(window_text)
            .map(|m| m.as_str().to_string());

        let version = version_re
            .find(&file_name)
            .map(|m| m.as_str().to_string())
            .unwrap_or_else(|| file_name.clone());

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

    Ok(builds)
}

// Decodes JS-style `\uXXXX` escapes (as produced by Next.js's
// htmlEscapeJsonString when embedding a JSON string inside HTML). Leaves
// anything that isn't a valid `\uXXXX` sequence untouched.
fn decode_unicode_escapes(s: &str) -> String {
    let re = Regex::new(r"\\u([0-9a-fA-F]{4})").unwrap();
    re.replace_all(s, |caps: &regex::Captures| {
        u32::from_str_radix(&caps[1], 16)
            .ok()
            .and_then(char::from_u32)
            .map(|c| c.to_string())
            .unwrap_or_else(|| caps[0].to_string())
    })
    .into_owned()
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
    fn groups_engine_and_fab_companion_under_the_same_version() {
        let builds = parse_ue_linux_listing(SAMPLE_LISTING_HTML).unwrap();
        assert_eq!(builds.len(), 2);
        assert_eq!(builds[0].file_name, "Linux_Unreal_Engine_5.8.0.zip");
        assert_eq!(builds[0].version, "5.8.0");
        assert_eq!(builds[0].size_bytes, Some((37.08 * 1_073_741_824.0) as u64));
        assert!(builds[0].download_url.starts_with(
            "https://ucs-blob-store.s3-accelerate.amazonaws.com/blobs/cd/aa/"
        ));
        assert_eq!(builds[1].file_name, "Linux_Fab_5.8.0_0.0.13.zip");
        // Same version key as the engine entry — this is what lets the
        // frontend group them into one "Unreal Engine 5.8.0" tile with the
        // Fab zip collapsed underneath as an extra, instead of dropping it.
        assert_eq!(builds[1].version, "5.8.0");
        assert_eq!(builds[1].size_bytes, Some((0.03 * 1_073_741_824.0) as u64));
    }

    // Regression test for a real bug: the first row's size/date window used
    // to scan from the start of the page (or previous row) up to the
    // download link, so an unrelated "8.0 GB" mention earlier on the page
    // (e.g. nav/banner copy) was picked up instead of the row's real
    // "37.08 GB" — anchoring the window to the row's own file_name text
    // fixes this.
    const SAMPLE_WITH_DECOY_SIZE_HTML: &str = r#"
        <div class="promo">Get 8.0 GB of extra cloud storage free!</div>
        <table>
          <tr>
            <td>Linux_Unreal_Engine_5.8.0.zip</td>
            <td>37.08 GB</td>
            <td>Jun 17, 2026</td>
            <td><a href="https://ucs-blob-store.s3-accelerate.amazonaws.com/blobs/cd/aa/c551-e891-4dc6-ad0c-2e8d719157ae?X-Amz-Algorithm=AWS4-HMAC-SHA256&amp;X-Amz-Expires=3600&amp;response-content-disposition=inline%3Bfilename%3D%22file.zip%22%3Bfilename%2A%3DUTF-8%27%27Linux_Unreal_Engine_5.8.0.zip&amp;x-id=GetObject">Download</a></td>
          </tr>
        </table>
    "#;

    #[test]
    fn does_not_pick_up_unrelated_gb_mention_before_the_row() {
        let builds = parse_ue_linux_listing(SAMPLE_WITH_DECOY_SIZE_HTML).unwrap();
        assert_eq!(builds.len(), 1);
        assert_eq!(builds[0].size_bytes, Some((37.08 * 1_073_741_824.0) as u64));
    }

    // Two different released versions, each with its own engine + companion
    // zip, listed back to back — the version-grouping fix isn't specific to
    // 5.8.0, and rows must not bleed into each other (wrong size/date/group).
    const SAMPLE_MULTI_VERSION_HTML: &str = r#"
        <table>
          <tr>
            <td>Linux_Unreal_Engine_5.8.0.zip</td>
            <td>37.08 GB</td>
            <td>Jun 17, 2026</td>
            <td><a href="https://ucs-blob-store.s3-accelerate.amazonaws.com/blobs/aa/aa/111-e891-4dc6-ad0c-2e8d719157ae?X-Amz-Algorithm=AWS4-HMAC-SHA256&amp;X-Amz-Expires=3600&amp;response-content-disposition=inline%3Bfilename%3D%22file.zip%22%3Bfilename%2A%3DUTF-8%27%27Linux_Unreal_Engine_5.8.0.zip&amp;x-id=GetObject">Download</a></td>
          </tr>
          <tr>
            <td>Linux_Fab_5.8.0_0.0.13.zip</td>
            <td>0.03 GB</td>
            <td>Jun 17, 2026</td>
            <td><a href="https://ucs-blob-store.s3-accelerate.amazonaws.com/blobs/bb/bb/222-e891-4dc6-ad0c-2e8d719157ae?X-Amz-Algorithm=AWS4-HMAC-SHA256&amp;X-Amz-Expires=3600&amp;response-content-disposition=inline%3Bfilename%3D%22file.zip%22%3Bfilename%2A%3DUTF-8%27%27Linux_Fab_5.8.0_0.0.13.zip&amp;x-id=GetObject">Download</a></td>
          </tr>
          <tr>
            <td>Linux_Unreal_Engine_5.7.4.zip</td>
            <td>36.50 GB</td>
            <td>May 2, 2026</td>
            <td><a href="https://ucs-blob-store.s3-accelerate.amazonaws.com/blobs/cc/cc/333-e891-4dc6-ad0c-2e8d719157ae?X-Amz-Algorithm=AWS4-HMAC-SHA256&amp;X-Amz-Expires=3600&amp;response-content-disposition=inline%3Bfilename%3D%22file.zip%22%3Bfilename%2A%3DUTF-8%27%27Linux_Unreal_Engine_5.7.4.zip&amp;x-id=GetObject">Download</a></td>
          </tr>
          <tr>
            <td>Linux_Bridge_5.7.4_2025.0.1.zip</td>
            <td>0.04 GB</td>
            <td>May 2, 2026</td>
            <td><a href="https://ucs-blob-store.s3-accelerate.amazonaws.com/blobs/dd/dd/444-e891-4dc6-ad0c-2e8d719157ae?X-Amz-Algorithm=AWS4-HMAC-SHA256&amp;X-Amz-Expires=3600&amp;response-content-disposition=inline%3Bfilename%3D%22file.zip%22%3Bfilename%2A%3DUTF-8%27%27Linux_Bridge_5.7.4_2025.0.1.zip&amp;x-id=GetObject">Download</a></td>
          </tr>
        </table>
    "#;

    #[test]
    fn groups_companions_per_version_across_multiple_releases() {
        let builds = parse_ue_linux_listing(SAMPLE_MULTI_VERSION_HTML).unwrap();
        assert_eq!(builds.len(), 4);

        let group_580: Vec<_> = builds.iter().filter(|b| b.version == "5.8.0").collect();
        assert_eq!(group_580.len(), 2);
        let engine_580 = group_580
            .iter()
            .find(|b| b.file_name == "Linux_Unreal_Engine_5.8.0.zip")
            .unwrap();
        assert_eq!(engine_580.size_bytes, Some((37.08 * 1_073_741_824.0) as u64));

        let group_574: Vec<_> = builds.iter().filter(|b| b.version == "5.7.4").collect();
        assert_eq!(group_574.len(), 2);
        let engine_574 = group_574
            .iter()
            .find(|b| b.file_name == "Linux_Unreal_Engine_5.7.4.zip")
            .unwrap();
        assert_eq!(engine_574.size_bytes, Some((36.50 * 1_073_741_824.0) as u64));
        assert_eq!(engine_574.uploaded, Some("May 2, 2026".to_string()));

        let bridge_574 = group_574
            .iter()
            .find(|b| b.file_name == "Linux_Bridge_5.7.4_2025.0.1.zip")
            .unwrap();
        assert_eq!(bridge_574.size_bytes, Some((0.04 * 1_073_741_824.0) as u64));
    }

    #[test]
    fn errors_when_no_download_entries_found() {
        let err = parse_ue_linux_listing("<html><body>not logged in</body></html>").unwrap_err();
        assert!(err.contains("no download entries found"));
    }

    // Real unrealengine.com/linux markup embeds the listing as a JSON string
    // inside a <script> tag, with `&` escaped as `&` (Next.js's
    // XSS-safe JSON-in-HTML encoding) rather than the HTML entity `&amp;`.
    // Regression test for the confusing "5.8.0.zip&x-id=GetObject"
    // names this produced before decode_unicode_escapes was added.
    const SAMPLE_JSON_EMBEDDED_HTML: &str = r#"
        <script>self.__next_f.push([1,"{\"downloadUrl\":\"https://ucs-blob-store.s3-accelerate.amazonaws.com/blobs/cd/aa/c551-e891-4dc6-ad0c-2e8d719157ae?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600&response-content-disposition=inline%3Bfilename%3D%22file.zip%22%3Bfilename%2A%3DUTF-8%27%27Linux_Unreal_Engine_5.8.0.zip&x-id=GetObject\",\"size\":\"37.08 GB\",\"uploaded\":\"Jun 17, 2026\"}"])</script>
    "#;

    #[test]
    fn decodes_next_js_unicode_escaped_ampersands_before_extracting_filename() {
        let builds = parse_ue_linux_listing(SAMPLE_JSON_EMBEDDED_HTML).unwrap();
        assert_eq!(builds.len(), 1);
        assert_eq!(builds[0].file_name, "Linux_Unreal_Engine_5.8.0.zip");
        assert_eq!(builds[0].version, "5.8.0");
        assert!(!builds[0].download_url.contains("\\u0026"));
        assert!(builds[0].download_url.contains('&'));
    }
}
