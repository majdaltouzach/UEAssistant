mod commands;
mod desktop_entry;
mod download;
mod extract;
mod paths;
mod privileged;
mod state;

use commands::auth::{epic_login, epic_logout, epic_user_info, open_epic_login_window};
use commands::install::{install_ue, list_installed_engines, uninstall_ue, update_ue};
use commands::ue_engine::{list_available_ue_linux_builds, list_ue_versions, submit_ue_listing_html};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_ue_versions,
            list_available_ue_linux_builds,
            submit_ue_listing_html,
            epic_login,
            epic_logout,
            epic_user_info,
            open_epic_login_window,
            install_ue,
            update_ue,
            uninstall_ue,
            list_installed_engines
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
