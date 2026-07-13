use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

// Mirrors src/backend/storeManagers/legendary/user.ts (LegendaryUser class) —
// same underlying mechanism: paste an auth code from legendary.gl/epiclogin,
// hand it to `legendary auth --code`. No embedded browser/OAuth callback
// exists in Heroic either; this *is* the whole flow.

#[derive(Serialize)]
pub struct UserInfo {
    account_id: String,
    display_name: String,
}

// Full shape of ~/.config/legendary/user.json. Deliberately not `Serialize`:
// access_token/refresh_token must never leave the Rust process and reach
// the webview, even though it's a local desktop app.
#[derive(Deserialize)]
struct LegendaryUserFile {
    account_id: String,
    #[serde(rename = "displayName")]
    display_name: String,
}

fn legendary_user_json_path() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("could not resolve home directory")?;
    Ok(home.join(".config/legendary/user.json"))
}

// Tracks whether the login webview is currently open, so a second call
// while one is already in flight reuses/focuses it instead of spawning
// a duplicate window.
static LOGIN_WINDOW_OPEN: Mutex<bool> = Mutex::new(false);

const EPIC_LOGIN_URL: &str = "https://www.epicgames.com/id/login?responseType=code";

// Opens a Tauri webview at Epic's hosted login page (same URL Heroic's
// Electron `<webview>` used — see src/frontend/screens/WebView/index.tsx).
// Epic's OAuth client used here redirects to `http://localhost/?code=...`
// on success (no real localhost server involved, we never let the
// navigation actually complete — we intercept the URL and stop it).
// On success we run `legendary auth --code` and emit `epic-login-result`
// with either the resulting UserInfo or an error string.
#[tauri::command]
pub fn open_epic_login_window(app: AppHandle) -> Result<(), String> {
    {
        let mut open = LOGIN_WINDOW_OPEN.lock().unwrap();
        if *open {
            if let Some(w) = app.get_webview_window("epic-login") {
                let _ = w.set_focus();
            }
            return Ok(());
        }
        *open = true;
    }

    let app_for_nav = app.clone();
    let result = WebviewWindowBuilder::new(&app, "epic-login", WebviewUrl::External(
        EPIC_LOGIN_URL.parse().map_err(|e| format!("invalid login url: {e}"))?,
    ))
    .title("Log in to Epic Games")
    .inner_size(500.0, 700.0)
    // Real Epic Games Launcher UA — the login page serves a different
    // (device-code) flow to browsers it doesn't recognize as the launcher.
    .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) EpicGamesLauncher")
    .on_navigation(move |url| {
        if url.host_str() == Some("localhost") {
            if let Some(code) = url
                .query_pairs()
                .find(|(k, _)| k == "code")
                .map(|(_, v)| v.into_owned())
            {
                let app = app_for_nav.clone();
                tauri::async_runtime::spawn(async move {
                    let result = epic_login_blocking(app.clone(), code);
                    let _ = app.emit("epic-login-result", &result);
                    if let Some(w) = app.get_webview_window("epic-login") {
                        let _ = w.close();
                    }
                    *LOGIN_WINDOW_OPEN.lock().unwrap() = false;
                });
            }
            // Never actually let the webview navigate to localhost; we've
            // already pulled the code out of the URL.
            return false;
        }
        true
    })
    .build();

    if result.is_err() {
        *LOGIN_WINDOW_OPEN.lock().unwrap() = false;
    }
    result.map(|_| ()).map_err(|e| format!("failed to open login window: {e}"))
}

fn epic_login_blocking(app: AppHandle, code: String) -> Result<UserInfo, String> {
    epic_login(app, code)
}

#[tauri::command]
pub fn epic_login(app: AppHandle, code: String) -> Result<UserInfo, String> {
    let output = Command::new(crate::paths::legendary_bin_path(&app)?)
        .args(["auth", "--code", &code])
        .output()
        .map_err(|e| format!("failed to run legendary: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() || stderr.contains("ERROR: Logging in") {
        return Err(stderr.into_owned());
    }

    epic_user_info()
}

#[tauri::command]
pub fn epic_logout(app: AppHandle) -> Result<(), String> {
    let output = Command::new(crate::paths::legendary_bin_path(&app)?)
        .args(["auth", "--delete"])
        .output()
        .map_err(|e| format!("failed to run legendary: {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    Ok(())
}

#[tauri::command]
pub fn epic_user_info() -> Result<UserInfo, String> {
    let path = legendary_user_json_path()?;
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("not logged in ({}): {e}", path.display()))?;
    let parsed: LegendaryUserFile =
        serde_json::from_str(&raw).map_err(|e| format!("failed to parse user.json: {e}"))?;

    Ok(UserInfo {
        account_id: parsed.account_id,
        display_name: parsed.display_name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Shape captured from a real ~/.config/legendary/user.json — token
    // fields replaced with placeholders, only structural fields matter here.
    const SAMPLE_USER_JSON: &str = r#"{
        "access_token": "eg1~redacted",
        "account_id": "2d2fd242073a48c8b3a09be2214eeec0",
        "displayName": "digimonelephants",
        "refresh_token": "eg1~redacted"
    }"#;

    #[test]
    fn parses_account_id_and_display_name_only() {
        let parsed: LegendaryUserFile = serde_json::from_str(SAMPLE_USER_JSON).unwrap();
        assert_eq!(parsed.account_id, "2d2fd242073a48c8b3a09be2214eeec0");
        assert_eq!(parsed.display_name, "digimonelephants");
    }
}
