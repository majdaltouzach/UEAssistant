wq# UEAssistant — Heroic Fork → Tauri Migration + UE Installer

## Context
This repo is a fork of Heroic Games Launcher (Electron + React + TypeScript + MUI + Vite). Goal: repurpose it into **UEAssistant** — a Linux-native Unreal Engine installer/updater, reusing Heroic's proven Epic OAuth flow and legendary integration, but swapping the Electron main process for a **Tauri 2 Rust backend** for memory-safe file/download operations.

## Phase 0 — Investigate before writing code
Before any implementation, answer these and report back:

1. **Does legendary expose Unreal Engine as an installable app?** UE ships via Epic's vault/entitlement system, not the standard game catalog. Check `legendary list --third-party` behavior and whether Heroic's legendary fork (`Heroic-Games-Launcher/legendary`) already handles vault-type entitlements. If UE doesn't appear as a normal app, identify how Heroic's own Epic-integration exe (`Etaash-mathamsetty/heroic-epic-integration`) or the Epic Games Store web API handles vault downloads instead.
2. **Locate existing Epic auth flow** — find where Heroic implements the embedded-browser Epic login (SID exchange, OAuth callback) in `src/`. This gets reused as-is; do not rebuild it.
3. **Identify the current Electron ↔ React IPC boundary** (`electron.vite.config.ts`, preload scripts, main process handlers) — this is what gets ported to Tauri commands.

Report findings before proceeding to Phase 1.

## Phase 1 — Electron → Tauri migration
- Add `src-tauri/` (Tauri 2, Rust) alongside existing `src/` (keep React/MUI frontend, do not rewrite UI framework)
- Port Electron main-process responsibilities to Rust `#[tauri::command]` functions:
  - Auth session handling (wrap legendary CLI calls via `std::process::Command`, same as Heroic currently shells out to legendary)
  - File extraction (XZ/tar) — this is the critical memory-safety target Toufic wants Rust for
  - Install path resolution (user-level `$HOME/.local/share` vs system-wide `/opt` via `pkexec`)
  - Desktop entry / symlink creation
- Remove `electron-builder.yml`, `electron.vite.config.ts` once Tauri build path confirmed working; replace with `tauri.conf.json`
- Keep `pnpm-workspace.yaml` structure, add Tauri as a workspace member

## Phase 2 — UE-specific installer logic
- New Rust module `src-tauri/src/commands/ue_engine.rs`:
  - `list_available_ue_versions()` — via legendary, fallback to direct Epic API if vault-type entitlement isn't legendary-compatible (see Phase 0 finding)
  - `install_ue(version, install_path, system_wide: bool)` — download → extract XZ → place in path → verify
  - `update_ue(version)` — re-download changed chunks, re-extract, preserve project files
  - `uninstall_ue(version)` — remove dir + desktop entry + registry record
- Install path logic: default prompt user-level vs system-wide at install time; system-wide uses `pkexec` for the final `mv`/`chown` step only — **never run legendary or the download itself as root**
- Desktop shortcut generation: `.desktop` file pointing at `Engine/Binaries/Linux/UnrealEditor`, correct icon path, `StartupWMClass=UnrealEditor`

## Constraints
- GPL-3.0 license carries over from Heroic fork — keep `COPYING` intact
- Do not touch GOG/Amazon/Nile code paths — strip or leave dormant, UE-only scope for now
- All Rust file operations must handle partial/corrupt downloads gracefully (resume support if legendary supports it natively)
- Bash scripts only for things Rust/Tauri can't cleanly do (e.g. `pkexec` wrapper invocation) — keep minimal, POSIX-compliant

## Deliverable for this session
Start with Phase 0 investigation only. Report findings on legendary + UE vault entitlement question before writing any Rust or removing any Electron code.
