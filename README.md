# UEAssistant

[![GPLv3 license](https://img.shields.io/badge/license-GPLv3-blue?style=for-the-badge)](COPYING)
[![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&labelColor=gray)](https://www.rust-lang.org/)
[![Tauri](https://img.shields.io/badge/Tauri%202-FFC131?style=for-the-badge&logo=tauri&labelColor=gray)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-5fd9fb?style=for-the-badge&logo=react&labelColor=gray)](https://reactjs.org/)
[![Typescript](https://img.shields.io/badge/Typescript-3178c6?style=for-the-badge&logo=typescript&labelColor=gray)](https://www.typescriptlang.org/)

UEAssistant installs and updates **Unreal Engine on Linux**, no hassle.

Getting UE running on Linux today means fighting Epic's launcher, wrangling Wine/Proton, or hand-rolling legendary CLI calls. UEAssistant removes that pain point — one native Linux app, log in with your Epic account, pick a UE version, install. Built so game devs and filmmakers can move to Linux without losing access to the engine.

## What it does

- Native Linux installer/updater for Unreal Engine (vault-entitlement aware, not the normal Epic game catalog path)
- Epic account login (OAuth, reused from Heroic's embedded-browser flow)
- Choose install location: user-level (`$HOME/.local/share`) or system-wide (`/opt`, via `pkexec` for the final move/chown only — downloads and extraction never run as root)
- Desktop entry + icon generation so UE shows up in your app launcher like any native app
- Update in place, preserving your projects
- Uninstall cleanly (engine dir, desktop entry, records)

## Architecture

UEAssistant is a **from-scratch architecture rewrite** of its origin project, not a themed fork. The Electron main process is being replaced end-to-end with a **Tauri 2 Rust backend**:

- **Frontend**: React + TypeScript + MUI (kept from the origin project — no UI framework rewrite)
- **Backend**: Rust via Tauri 2 `#[tauri::command]`s, replacing all Electron main-process/IPC code
  - Memory-safe file extraction (XZ/tar) — the primary reason for moving off Node/Electron for this piece
  - Install path resolution, symlink/desktop-entry creation, and privileged-step isolation (`pkexec` only wraps the final filesystem move, never the download or extraction)
  - Auth/session handling shells out to the `legendary` CLI, same approach as the origin project
- Store integrations unrelated to Epic/UE (GOG, Amazon/Nile, sideload, etc.) are stripped or left dormant — this project is UE-only in scope

## Status

Active migration in progress: Electron → Tauri. Store-agnostic launcher features are being removed as UE-specific installer logic replaces them.

## Development environment

1. Make sure Git, Node.js, pnpm 10, and a Rust toolchain (`rustup`) are installed
2. Clone the repo:

   ```bash
   git clone <repo-url>
   cd UEAssistant
   ```

3. Install JS dependencies: `pnpm install`
4. Once the Tauri backend lands, build/dev commands will live under `src-tauri/` — see `tauri.conf.json` when present

## Credits

UEAssistant is a hard fork of [Heroic Games Launcher](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher), and owes its Epic OAuth flow and `legendary` integration to that project's work. Full credit and thanks to the Heroic Games Launcher team and contributors — this project would not exist without their groundwork.

Also relies on:

- Legendary: https://github.com/derrod/legendary ([Heroic's fork](https://github.com/Heroic-Games-Launcher/legendary))
- Heroic Epic-integration exe: https://github.com/Etaash-mathamsetty/heroic-epic-integration

## License

GPL-3.0, carried over from Heroic Games Launcher. See [COPYING](COPYING).
