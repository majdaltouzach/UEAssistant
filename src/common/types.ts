import {
  LegendaryInstallPlatform,
  GameMetadataInner,
  LegendaryInstallInfo
} from './types/legendary'
import { TitleBarOverlay } from 'electron'
import { ChildProcess } from 'child_process'
import type { Path } from 'backend/schemas'
import type LogWriter from 'backend/logger/log_writer'

export type Runner = 'legendary'

// NOTE: Do not put enum's in this module or it will break imports

export type DialogType = 'MESSAGE' | 'ERROR'

export interface ButtonOptions {
  text: string
  onClick?: () => void
}

export type LaunchParams = {
  appName: string
  launchArguments?: LaunchOption
  runner: Runner
  skipVersionCheck?: boolean
  args?: string[]
}

export type LaunchOption =
  BaseLaunchOption | AltExeLaunchOption | DLCLaunchOption

// Option to append extra parameters to the launch command
interface BaseLaunchOption {
  type?: 'basic'
  name: string
  parameters: string
}

// Option to launch an alternative executable instead
interface AltExeLaunchOption {
  type: 'altExe'
  executable: Path
}

// Option to launch a DLC (another game) instead of the base game
interface DLCLaunchOption {
  type: 'dlc'
  dlcAppName: string
  dlcTitle: string
}

interface About {
  description: string
  shortDescription: string
}

export type Release = {
  type: 'stable' | 'beta'
  html_url: string
  name: string
  tag_name: string
  published_at: string
  prerelease: boolean
  id: number
  body?: string
}

export type ExperimentalFeatures = {
  enableHelp: boolean
}

export interface AppSettings extends GameSettings {
  analyticsOptIn: boolean
  addDesktopShortcuts: boolean
  addStartMenuShortcuts: boolean
  addSteamShortcuts: boolean
  altLegendaryBin: string
  autoUpdateGames: boolean
  checkForUpdatesOnStartup: boolean
  checkUpdatesInterval: number
  customCSS: string
  customThemesPath: string
  darkTrayIcon: boolean
  defaultInstallPath: string
  defaultSteamPath: string
  disableController: boolean
  disablePlaytimeSync: boolean
  disableSmoothScrolling: boolean
  disableLogs: boolean
  disableAnimations: boolean
  discordRPC: boolean
  downloadNoHttps: boolean
  egsLinkedPath: string
  enableUpdates: boolean
  exitToTray: boolean
  noTrayIcon: boolean
  experimentalFeatures?: ExperimentalFeatures
  framelessWindow: boolean
  hideChangelogsOnStartup: boolean
  hideWindowOnProtocolLaunch: boolean
  libraryTopSection: LibraryTopSectionOptions
  maxRecentGames: number
  maxWorkers: number
  minimizeOnLaunch: boolean
  startInConsoleMode: boolean
  startInTray: boolean
  verboseLogs: boolean
}

export type LibraryTopSectionOptions =
  'disabled' | 'recently_played' | 'recently_played_installed' | 'favourites'

export type ExecResult = {
  stderr: string
  stdout: string
  fullCommand?: string
  error?: string
  abort?: boolean
}

export interface ExtraInfo {
  about?: About
  reqs: Reqs[]
  releaseDate?: string
  storeUrl?: string
  changelog?: string
  genres?: string[]
}

export type GameConfigVersion = 'auto' | 'v0' | 'v0.1'

export interface GameInfo {
  runner: Runner
  store_url?: string
  app_name: string
  art_cover: string
  art_logo?: string
  art_background?: string
  art_icon?: string
  art_square: string
  cloud_save_enabled?: boolean
  developer?: string
  extra?: ExtraInfo
  folder_name?: string
  install: Partial<InstalledInfo>
  installable?: boolean
  is_installed: boolean
  namespace?: string
  // NOTE: This is the save folder without any variables filled in...
  save_folder?: string
  // ...and this is the folder with them filled in
  save_path?: string
  title: string
  canRunOffline: boolean
  thirdPartyManagedApp?: string
  isEAManaged?: boolean
  isUbisoftManaged?: boolean
  is_mac_native?: boolean
  is_linux_native?: boolean
  browserUrl?: string
  description?: string
  //used for store release versions. if remote !== local, then update
  version?: string
  dlcList?: GameMetadataInner[]
  customUserAgent?: string
  launchFullScreen?: boolean
  overrides?: {
    title?: string
    art_cover?: string
    art_square?: string
  }
}

export interface GameSettings {
  autoSyncSaves: boolean
  enviromentOptions: EnviromentVariable[]
  ignoreGameUpdates: boolean
  language: string
  launcherArgs: string
  lastUsedLaunchOption?: LaunchOption
  offlineMode: boolean
  otherOptions?: string //deprecated
  preferSystemLibs: boolean
  targetExe: string
  wrapperOptions: WrapperVariable[]
  savesPath: string
  beforeLaunchScriptPath: string
  afterLaunchScriptPath: string
  verboseLogs: boolean
  enableQuickSavesMenu: boolean
}

export type Status =
  | 'installing'
  | 'importing'
  | 'updating'
  | 'launching'
  | 'playing'
  | 'uninstalling'
  | 'repairing'
  | 'done'
  | 'canceled'
  | 'moving'
  | 'queued'
  | 'error'
  | 'syncing-saves'
  | 'notAvailable'
  | 'notSupportedGame'
  | 'notInstalled'
  | 'installed'
  | 'redist'
  | 'extracting'

export interface GameStatus {
  appName: string
  progress?: InstallProgress
  folder?: string
  context?: string // Additional context e.g current step
  runner?: Runner
  status: Status
}

export type GlobalConfigVersion = 'auto' | 'v0'
export interface InstallProgress {
  bytes: string
  eta: string
  folder?: string
  percent?: number
  downSpeed?: number
  diskSpeed?: number
  file?: string
}
export interface InstalledInfo {
  manifest?: {
    disk_size: number
    download_size: number
    app_name: string
    languages: string[]
    versionEtag: string
    dependencies: string[]
    perLangSize: {
      [key: string]: {
        download_size: number
        disk_size: number
      }
    }
  }
  executable: string
  install_path: string
  install_size: string
  is_dlc: boolean
  version: string
  platform: InstallPlatform
  appName?: string
  installedWithDLCs?: boolean // OLD DLC boolean (all dlcs installed)
  installedDLCs?: string[]
  language?: string
  versionEtag?: string
  pinnedVersion?: boolean
}

export interface Reqs {
  minimum: string
  recommended: string
  title: string
}

export type SyncType = 'Download' | 'Upload' | 'Force download' | 'Force upload'

export type UserInfo = {
  account_id: string
  displayName: string
  user: string
}

export interface InstallArgs {
  path: string
  platformToInstall: InstallPlatform
  installDlcs?: Array<string>
  sdlList?: string[]
  installLanguage?: string
  branch?: string
  build?: string
  dependencies?: string[]
}

export interface InstallParams extends InstallArgs {
  appName: string
  gameInfo: GameInfo
  runner: Runner
  size?: string
}

export interface UpdateParams {
  appName: string
  runner: Runner
  gameInfo: GameInfo
  installDlcs?: Array<string>
  installLanguage?: string
  build?: string
  branch?: string
}

export interface LaunchPreperationResult {
  success: boolean
  failureReason?: string
  rpcClient?: RpcClient
  offlineMode?: boolean
}

export interface RpcClient {
  destroy(): void
}

export interface CallRunnerOptions {
  logMessagePrefix?: string
  logWriters?: LogWriter[]
  logSanitizer?: (line: string) => string
  env?: Record<string, string> | NodeJS.ProcessEnv
  wrappers?: string[]
  onOutput?: (output: string, child: ChildProcess) => void
  abortId?: string
  cwd?: string
}

export interface EnviromentVariable {
  key: string
  value: string
}

export interface WrapperVariable {
  exe: string
  args: string
}

export interface WrapperEnv {
  appName: string
  appRunner: Runner
}

export type RecentGame = {
  appName: string
  title: string
}

export type HiddenGame = RecentGame

export type FavouriteGame = HiddenGame

export type RefreshOptions = {
  checkForUpdates?: boolean
  fullRefresh?: boolean
  library?: Runner | 'all'
  runInBackground?: boolean
}

export type GamepadActionStatus = Record<
  ValidGamepadAction,
  {
    triggeredAt: { [key: number]: number }
    repeatDelay: false | number
  }
>

export type ValidGamepadAction = GamepadActionArgs['action']

export type GamepadActionArgs =
  GamepadActionArgsWithMetadata | GamepadActionArgsWithoutMetadata

interface GamepadActionArgsWithMetadata {
  action: 'leftClick' | 'rightClick'
  metadata: {
    elementTag: string
    x: number
    y: number
  }
}

interface GamepadActionArgsWithoutMetadata {
  action:
    | 'padUp'
    | 'padDown'
    | 'padLeft'
    | 'padRight'
    | 'leftStickUp'
    | 'leftStickDown'
    | 'leftStickLeft'
    | 'leftStickRight'
    | 'rightStickUp'
    | 'rightStickDown'
    | 'rightStickLeft'
    | 'rightStickRight'
    | 'mainAction'
    | 'back'
    | 'altAction'
    | 'esc'
    | 'tab'
    | 'shiftTab'
    | 'keyboardClick'
    | 'guide'
  metadata?: undefined
}

export type InstallPlatform = LegendaryInstallPlatform | 'Browser'

export type ConnectivityStatus = 'offline' | 'check-online' | 'online'

export interface Tools {
  exe?: string
  tool: string
  appName: string
  runner: Runner
}

export interface Tool {
  name: string
  url: string
  os: string
  strip?: number
}

export type DMStatus = 'done' | 'error' | 'abort' | 'paused'
export interface DMQueueElement {
  type: 'update' | 'install'
  params: InstallParams
  addToQueueTime: number
  startTime: number
  endTime: number
  status?: DMStatus
}

export interface SaveSyncArgs {
  arg: string | undefined
  path: string
  appName: string
  runner: Runner
}

export interface ImportGameArgs {
  appName: string
  path: string
  runner: Runner
  platform: InstallPlatform
}

export interface MoveGameArgs {
  appName: string
  path: string
  runner: Runner
}

export interface DiskSpaceData {
  free: number
  diskSize: number
  message: string
  validPath: boolean
  validFlatpakPath: boolean
}

export interface ToolArgs {
  appName: string
  action: 'backup' | 'restore'
}

export type StatusPromise = Promise<{ status: 'done' | 'error' | 'abort' }>

export type DownloadManagerState = 'idle' | 'running' | 'paused' | 'stopped'

export interface WindowProps extends Electron.Rectangle {
  maximized: boolean
  frame?: boolean
  titleBarStyle?: 'default' | 'hidden' | 'hiddenInset'
  titleBarOverlay?: TitleBarOverlay | boolean
}

export type InstallInfo = LegendaryInstallInfo

export interface UploadedLogData {
  // Descriptive name of the log file (e.g. "Game log of ...")
  name: string
  // Token to modify the file (used to delete the log file on the server)
  token: string
  // Time the log file was uploaded (used to know whether it expired)
  uploadedAt: number
}

export interface RunnerCommandStub {
  commandParts: string[]
  response?: Promise<ExecResult>
  stdout?: string
  stderr?: string
}
