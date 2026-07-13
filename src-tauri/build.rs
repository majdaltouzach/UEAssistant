fn main() {
    let attributes = tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "list_ue_versions",
            "list_available_ue_linux_builds",
            "submit_ue_listing_html",
            "epic_login",
            "epic_logout",
            "epic_user_info",
            "open_epic_login_window",
            "install_ue",
            "update_ue",
            "uninstall_ue",
            "list_installed_engines",
            "default_user_install_dir",
            "default_system_install_dir",
            "home_dir",
            "pick_install_directory",
        ]),
    );
    tauri_build::try_build(attributes).expect("tauri build script failed");
}
