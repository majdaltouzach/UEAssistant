import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'graceful-fs'

import { AppSettings, GlobalConfigVersion } from 'common/types'
import { currentGlobalConfigVersion } from 'backend/constants/others'

import { logError, logInfo, LogPrefix } from './logger'
import { backendEvents } from './backend_events'
import { configStore } from './constants/key_value_stores'
import { isFlatpak, isMac, isWindows } from './constants/environment'
import {
  configPath,
  gamesConfigPath,
  heroicInstallPath,
  userHome
} from './constants/paths'
import { join } from 'path'
import { spawnSync } from 'child_process'

function getSteamCompatFolder() {
  // Paths are from https://savelocation.net/steam-game-folder
  if (isWindows) {
    const defaultWinPath = join(process.env['PROGRAMFILES(X86)'] ?? '', 'Steam')
    return defaultWinPath
  } else if (isMac) {
    return join(userHome, 'Library/Application Support/Steam')
  } else {
    const flatpakSteamPath = join(
      userHome,
      '.var/app/com.valvesoftware.Steam/.steam/steam'
    )

    if (existsSync(flatpakSteamPath)) {
      // check if steam is really installed via flatpak
      const { status } = spawnSync('flatpak', [
        'info',
        'com.valvesoftware.Steam'
      ])

      if (status === 0) {
        return flatpakSteamPath
      }
    }
    return join(userHome, '.steam/steam')
  }
}

/**
 * This class does config handling.
 * This can't be constructed directly. Use the static method get().
 * It automatically selects the appropriate config loader based on the config version.
 *
 * It also implements all the config features that won't change across versions.
 */
abstract class GlobalConfig {
  protected static globalInstance: GlobalConfig

  public abstract version: GlobalConfigVersion

  protected config: AppSettings | undefined

  public set(config: AppSettings) {
    this.config = config
  }

  /**
   * Get the global configuartion handler.
   * If one doesn't exist, create one.
   *
   * @returns GlobalConfig instance.
   */
  public static get(): GlobalConfig {
    let version: GlobalConfigVersion

    // Config file doesn't already exist, make one with the current version.
    if (!existsSync(configPath)) {
      version = currentGlobalConfigVersion
    }
    // Config file exists, detect its version.
    else {
      // Check version field in the config.
      try {
        version = JSON.parse(readFileSync(configPath, 'utf-8'))['version']
      } catch (error) {
        logError(
          [`Config file is corrupted, please check ${configPath}:`, error],
          LogPrefix.Backend
        )
        version = 'v0'
      }
      // Legacy config file without a version field, it's a v0 config.
      if (!version) {
        version = 'v0'
      }
    }

    if (!GlobalConfig.globalInstance) {
      GlobalConfig.reload(version)
    }

    return GlobalConfig.globalInstance
  }

  /**
   * Recreate the global configuration handler.
   *
   * @param version Config version to load file using.
   * @returns void
   */
  private static reload(version: GlobalConfigVersion): void {
    // Select loader to use.
    switch (version) {
      case 'v0':
        GlobalConfig.globalInstance = new GlobalConfigV0()
        break
      default:
        logError(
          `Invalid config version '${version}' requested.`,
          LogPrefix.GlobalConfig
        )
        break
    }
    // Try to upgrade outdated config.
    if (GlobalConfig.globalInstance.upgrade()) {
      // Upgrade done, we need to fully reload config.
      logInfo(
        `Upgraded outdated ${version} config to ${currentGlobalConfigVersion}.`,
        LogPrefix.GlobalConfig
      )
      return GlobalConfig.reload(currentGlobalConfigVersion)
    } else if (version !== currentGlobalConfigVersion) {
      // Upgrade failed.
      logError(
        `Failed to upgrade outdated ${version} config.`,
        LogPrefix.GlobalConfig
      )
    }
  }

  /**
   * Gets the actual settings from the config file.
   * Does not modify its parent object.
   * Always reads from file regardless of `this.config`.
   *
   * @returns Settings present in config file.
   */
  public abstract getSettings(): AppSettings

  /**
   * Updates this.config, this.version to upgrade the current config file.
   *
   * Writes to file after that.
   * DO NOT call `flush()` afterward.
   *
   * @returns true if upgrade successful if upgrade fails or no upgrade needed.
   */
  public abstract upgrade(): boolean

  /**
   * Get default settings as if the user's config file doesn't exist.
   * Doesn't modify the parent object.
   * Doesn't access config files.
   *
   * @returns AppSettings
   */
  public abstract getFactoryDefaults(): AppSettings

  /**
   * Reset `this.config` to `getFactoryDefaults()` and flush.
   */
  public abstract resetToDefaults(): void

  protected writeToFile(config: Record<string, unknown>) {
    return writeFileSync(configPath, JSON.stringify(config, null, 2))
  }

  /**
   * Write `this.config` to file.
   * Uses the config version defined in `this.version`.
   */
  public abstract flush(): void

  /** change a specific setting */
  public abstract setSetting(key: keyof AppSettings, value: unknown): void

  /**
   * Load the config file, upgrade if needed.
   */
  protected load() {
    // Config file doesn't exist, make one.
    if (!existsSync(configPath)) {
      this.resetToDefaults()
    }
    // Always upgrade before loading to avoid errors.
    // `getSettings` doesn't return an `AppSettings` otherwise.
    if (this.version !== currentGlobalConfigVersion) {
      // Do not load the config.
      // Wait for `upgrade` to be called by `reload`.
    } else {
      // No upgrades necessary, load config.
      // `this.version` should be `currentGlobalConfigVersion` at this point.
      this.config = this.getSettings()
    }
  }
}

class GlobalConfigV0 extends GlobalConfig {
  public version: GlobalConfigVersion = 'v0'

  constructor() {
    super()
    this.load()
  }

  public upgrade() {
    // Here we rewrite the config object to match the latest format and write to file.
    // Not necessary as this is the current version.
    return false
  }

  public getSettings(): AppSettings {
    if (this.config) {
      return this.config
    }

    if (!existsSync(gamesConfigPath)) {
      mkdirSync(gamesConfigPath, { recursive: true })
    }

    if (!existsSync(configPath)) {
      return this.getFactoryDefaults()
    }

    const settings = JSON.parse(readFileSync(configPath, 'utf-8'))
    const defaultSettings = settings.defaultSettings as AppSettings

    return {
      ...this.getFactoryDefaults(),
      ...defaultSettings
    }
  }

  public getFactoryDefaults(): AppSettings {
    const settings: AppSettings = {
      analyticsOptIn: false,
      checkUpdatesInterval: 10,
      enableUpdates: false,
      addDesktopShortcuts: false,
      addStartMenuShortcuts: false,
      addSteamShortcuts: false,
      altLegendaryBin: '',
      preferSystemLibs: false,
      checkForUpdatesOnStartup: !isFlatpak,
      autoUpdateGames: false,
      customCSS: '',
      customThemesPath: '',
      darkTrayIcon: false,
      defaultInstallPath: heroicInstallPath,
      libraryTopSection: 'disabled',
      defaultSteamPath: getSteamCompatFolder(),
      hideChangelogsOnStartup: false,
      language: 'en',
      maxRecentGames: 5,
      maxWorkers: 0,
      minimizeOnLaunch: false,
      enviromentOptions: [],
      wrapperOptions: [],
      framelessWindow: false,
      hideWindowOnProtocolLaunch: false,
      beforeLaunchScriptPath: '',
      afterLaunchScriptPath: '',
      verboseLogs: true,
      noTrayIcon: false,
      disableController: false,
      disablePlaytimeSync: false,
      disableSmoothScrolling: false,
      disableLogs: false,
      disableAnimations: false,
      discordRPC: false,
      downloadNoHttps: false,
      egsLinkedPath: '',
      exitToTray: false,
      startInConsoleMode: false,
      startInTray: false,
      autoSyncSaves: false,
      ignoreGameUpdates: false,
      launcherArgs: '',
      offlineMode: false,
      targetExe: '',
      savesPath: '',
      enableQuickSavesMenu: false
    }
    return settings
  }

  public setSetting(key: keyof AppSettings, value: unknown) {
    const config = this.getSettings()
    const configStoreSettings = configStore.get_nodefault('settings') || config
    configStore.set('settings', { ...configStoreSettings, [key]: value })

    const oldValue = config[key]
    config[key] = value as never
    this.config = config

    backendEvents.emit('settingChanged', { key, oldValue, newValue: value })

    return this.flush()
  }

  public resetToDefaults() {
    this.config = this.getFactoryDefaults()
    return this.flush()
  }

  public flush() {
    return this.writeToFile({
      defaultSettings: this.config,
      version: 'v0'
    })
  }
}

export { GlobalConfig }
