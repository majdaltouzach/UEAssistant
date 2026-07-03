import { useCallback, useEffect, useState } from 'react'
import './UeApp.css'

// UEAssistant's own frontend entry point, calling straight into the Tauri
// commands in src-tauri/src/commands/*.rs via the global __TAURI__ bridge
// (window.__TAURI__, enabled by `withGlobalTauri: true` in tauri.conf.json —
// no @tauri-apps/api package needed). Deliberately independent of the
// legacy Heroic frontend tree (App.tsx, ContextProvider, etc.), which still
// expects the Electron `window.api` preload bridge that doesn't exist here.

interface TauriBridge {
  core: {
    invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
  }
  event: {
    listen: <T>(
      event: string,
      handler: (event: { payload: T }) => void
    ) => Promise<() => void>
  }
}

function tauri(): TauriBridge {
  const bridge = (window as unknown as { __TAURI__?: TauriBridge }).__TAURI__
  if (!bridge) {
    throw new Error(
      'window.__TAURI__ is not available (not running under Tauri)'
    )
  }
  return bridge
}

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return tauri().core.invoke<T>(cmd, args)
}

interface UserInfo {
  account_id: string
  display_name: string
}

interface UeLinuxBuild {
  file_name: string
  version: string
  size_bytes: number | null
  uploaded: string | null
  download_url: string
}

interface InstalledEngine {
  version: string
  install_path: string
  system_wide: boolean
  installed_at: string
}

interface DownloadProgress {
  version: string
  downloaded_bytes: number
  total_bytes: number | null
  bytes_per_sec: number
}

interface ExtractProgress {
  version: string
  files_done: number
  files_total: number
  current_file: string
}

type Progress =
  | { phase: 'download'; pct: number | null; bytesPerSec: number }
  | { phase: 'extract'; pct: number; currentFile: string }

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

export default function UeApp() {
  const [user, setUser] = useState<UserInfo | null | 'loading'>('loading')
  const [installed, setInstalled] = useState<InstalledEngine[]>([])
  const [available, setAvailable] = useState<UeLinuxBuild[] | null>(null)
  const [availableLoading, setAvailableLoading] = useState(false)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<Record<string, Progress>>({})
  const [error, setError] = useState<string | null>(null)

  const refreshInstalled = useCallback(() => {
    invoke<InstalledEngine[]>('list_installed_engines')
      .then(setInstalled)
      .catch((e) => setError(String(e)))
  }, [])

  const refreshUser = useCallback(() => {
    invoke<UserInfo>('epic_user_info')
      .then((info) => {
        setUser(info)
        refreshInstalled()
      })
      .catch(() => setUser(null))
  }, [refreshInstalled])

  useEffect(() => {
    refreshUser()

    const unlistenPromises = [
      tauri().event.listen<{ Ok?: UserInfo; Err?: string }>(
        'epic-login-result',
        (e) => {
          if (e.payload.Ok) {
            setUser(e.payload.Ok)
            setError(null)
            refreshInstalled()
          } else {
            setError(e.payload.Err ?? 'Login failed')
          }
        }
      ),
      tauri().event.listen<DownloadProgress>('ue-download-progress', (e) => {
        const { version, downloaded_bytes, total_bytes, bytes_per_sec } =
          e.payload
        setProgress((prev) => ({
          ...prev,
          [version]: {
            phase: 'download',
            pct: total_bytes ? (downloaded_bytes / total_bytes) * 100 : null,
            bytesPerSec: bytes_per_sec
          }
        }))
      }),
      tauri().event.listen<ExtractProgress>('ue-extract-progress', (e) => {
        const { version, files_done, files_total, current_file } = e.payload
        setProgress((prev) => ({
          ...prev,
          [version]: {
            phase: 'extract',
            pct: files_total ? (files_done / files_total) * 100 : 0,
            currentFile: current_file
          }
        }))
      })
    ]

    return () => {
      unlistenPromises.forEach((p) => p.then((unlisten) => unlisten()))
    }
  }, [refreshUser, refreshInstalled])

  const login = () => {
    setError(null)
    invoke('open_epic_login_window').catch((e) => setError(String(e)))
  }

  const logout = () => {
    invoke('epic_logout')
      .then(() => {
        setUser(null)
        setInstalled([])
      })
      .catch((e) => setError(String(e)))
  }

  const refreshAvailable = () => {
    setAvailableLoading(true)
    setError(null)
    invoke<UeLinuxBuild[]>('list_available_ue_linux_builds')
      .then(setAvailable)
      .catch((e) => setError(String(e)))
      .finally(() => setAvailableLoading(false))
  }

  const installVersion = (build: UeLinuxBuild) => {
    setBusy((prev) => new Set(prev).add(build.version))
    setError(null)
    invoke('install_ue', {
      version: build.version,
      downloadUrl: build.download_url,
      systemWide: false
    })
      .then(refreshInstalled)
      .catch((e) => setError(String(e)))
      .finally(() => {
        setBusy((prev) => {
          const next = new Set(prev)
          next.delete(build.version)
          return next
        })
        setProgress((prev) => {
          const rest = { ...prev }
          delete rest[build.version]
          return rest
        })
      })
  }

  const uninstallVersion = (version: string) => {
    setBusy((prev) => new Set(prev).add(version))
    setError(null)
    invoke('uninstall_ue', { version })
      .then(refreshInstalled)
      .catch((e) => setError(String(e)))
      .finally(() => {
        setBusy((prev) => {
          const next = new Set(prev)
          next.delete(version)
          return next
        })
      })
  }

  const isInstalled = (version: string) =>
    installed.some((e) => e.version === version)

  return (
    <div className="ue-app">
      <header className="ue-header">
        <h1>UEAssistant</h1>
        {user && user !== 'loading' && (
          <div className="ue-account">
            <span>{user.display_name}</span>
            <button onClick={logout}>Log out</button>
          </div>
        )}
      </header>

      {error && (
        <div className="ue-error" role="alert">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss">
            &times;
          </button>
        </div>
      )}

      {user === 'loading' && <p>Checking Epic session…</p>}

      {user === null && (
        <div className="ue-login">
          <p>Log in with your Epic Games account to install Unreal Engine.</p>
          <button onClick={login}>Log in with Epic Games</button>
        </div>
      )}

      {user && user !== 'loading' && (
        <>
          <section>
            <h2>Installed engines</h2>
            {installed.length === 0 && (
              <p className="ue-muted">None installed yet.</p>
            )}
            <ul className="ue-list">
              {installed.map((engine) => (
                <li key={engine.version}>
                  <div>
                    <strong>{engine.version}</strong>
                    <div className="ue-muted">{engine.install_path}</div>
                  </div>
                  <button
                    disabled={busy.has(engine.version)}
                    onClick={() => uninstallVersion(engine.version)}
                  >
                    {busy.has(engine.version) ? 'Working…' : 'Uninstall'}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <div className="ue-section-header">
              <h2>Available Unreal Engine builds (Linux)</h2>
              <button onClick={refreshAvailable} disabled={availableLoading}>
                {availableLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            {available === null && !availableLoading && (
              <p className="ue-muted">
                Click Refresh to fetch the current build list from
                unrealengine.com/linux.
              </p>
            )}
            <ul className="ue-list">
              {available?.map((build) => {
                const p = progress[build.version]
                return (
                  <li key={build.version}>
                    <div>
                      <strong>{build.version}</strong>
                      <div className="ue-muted">
                        {build.size_bytes ? formatBytes(build.size_bytes) : ''}
                        {build.uploaded ? ` · ${build.uploaded}` : ''}
                      </div>
                      {p && (
                        <div className="ue-progress">
                          <div
                            className="ue-progress-bar"
                            style={{ width: `${p.pct ?? 0}%` }}
                          />
                          <span>
                            {p.phase === 'download'
                              ? `Downloading${p.pct !== null ? ` ${p.pct.toFixed(0)}%` : ''} (${formatBytes(p.bytesPerSec)}/s)`
                              : `Extracting ${p.pct.toFixed(0)}% — ${p.currentFile}`}
                          </span>
                        </div>
                      )}
                    </div>
                    <button
                      disabled={
                        busy.has(build.version) || isInstalled(build.version)
                      }
                      onClick={() => installVersion(build)}
                    >
                      {isInstalled(build.version)
                        ? 'Installed'
                        : busy.has(build.version)
                          ? 'Installing…'
                          : 'Install'}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
