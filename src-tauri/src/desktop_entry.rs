use std::path::Path;

use crate::paths::engine_binary_path;

pub fn desktop_entry_contents(version: &str, install_dir: &Path) -> String {
    let exec = engine_binary_path(install_dir);
    format!(
        "[Desktop Entry]\n\
Type=Application\n\
Name=Unreal Editor {version}\n\
Comment=Unreal Engine {version} (installed via UEAssistant)\n\
Exec=\"{exec}\"\n\
Icon=ueassistant-unreal-editor\n\
Terminal=false\n\
Categories=Development;\n\
StartupWMClass=UnrealEditor\n",
        version = version,
        exec = exec.display(),
    )
}

pub fn file_name_for(version: &str) -> String {
    format!("com.ueassistant.unrealeditor.{version}.desktop")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn generates_exec_and_wm_class() {
        let contents = desktop_entry_contents("5.8.0", &PathBuf::from("/opt/UnrealEngine/5.8.0"));
        assert!(contents.contains("Exec=\"/opt/UnrealEngine/5.8.0/Engine/Binaries/Linux/UnrealEditor\""));
        assert!(contents.contains("StartupWMClass=UnrealEditor"));
        assert!(contents.contains("Name=Unreal Editor 5.8.0"));
    }
}
