import {
  CallRunnerOptions,
  GameInfo,
  Runner,
  EnviromentVariable,
  WrapperEnv,
  WrapperVariable,
  ExecResult,
  LaunchPreperationResult,
  RpcClient,
  GameSettings,
  LaunchParams,
  StatusPromise
} from 'common/types'
// This handles launching games, prefix creation etc..

import { existsSync } from 'graceful-fs'
import { join, isAbsolute } from 'path'

import {
  constructAndUpdateRPC,
  isEpicServiceOffline,
  quoteIfNecessary,
  errorHandler,
  removeQuoteIfNecessary,
  memoryLog,
  sendGameStatusUpdate,
  askForceUninstall
} from './utils'
import {
  createGameLogWriter,
  getRunnerLogWriter,
  logError,
  logInfo,
  LogPrefix
} from './logger'
import { GlobalConfig } from './config'
import { spawn } from 'child_process'
import shlex from 'shlex'
import { isOnline } from './online_monitor'
import { libraryManagerMap } from 'backend/storeManagers'
import { LegendaryCommand } from './storeManagers/legendary/commands'
import { searchForExecutableOnPath } from './utils/os/path'
import {
  createAbortController,
  deleteAbortController
} from './utils/aborthandler/aborthandler'
import { getMainWindow } from './main_window'
import { app, powerSaveBlocker } from 'electron'
import { addRecentGame } from './recent_games/recent_games'
import { tsStore } from './constants/key_value_stores'
import { gamesConfigPath } from './constants/paths'
import { isCLINoGui, isLinux, isWindows } from './constants/environment'
import { formatSystemInfo, getSystemInfo } from './utils/systeminfo'

import type { PartialDeep } from 'type-fest'
import type LogWriter from './logger/log_writer'

let powerDisplayId: number | null

const launchEventCallback: (args: LaunchParams) => StatusPromise = async ({
  appName,
  launchArguments,
  runner,
  skipVersionCheck,
  args
}) => {
  const game = libraryManagerMap[runner].getGame(appName)
  const gameInfo = game.getGameInfo()

  if (
    gameInfo.install.install_path &&
    !existsSync(gameInfo.install.install_path)
  ) {
    await askForceUninstall(game)

    sendGameStatusUpdate({
      appName,
      runner,
      status: 'done'
    })

    return { status: 'abort' }
  }

  const gameSettings = await game.getSettings()
  const { autoSyncSaves, savesPath } = gameSettings

  if (!launchArguments && gameSettings.lastUsedLaunchOption) {
    launchArguments = gameSettings.lastUsedLaunchOption
  }

  const { title } = gameInfo

  const { minimizeOnLaunch, noTrayIcon } = GlobalConfig.get().getSettings()

  const startPlayingDate = new Date()

  if (!tsStore.has(appName)) {
    tsStore.set(`${appName}.firstPlayed`, startPlayingDate.toISOString())
  }

  logInfo(`Launching ${title} (${appName})`, LogPrefix.Backend)

  if (autoSyncSaves && isOnline()) {
    sendGameStatusUpdate({
      appName,
      runner,
      status: 'syncing-saves'
    })
    logInfo(`Downloading saves for ${title}`, LogPrefix.Backend)
    try {
      await game.syncSaves('--skip-upload', savesPath)
      logInfo(`Saves for ${title} downloaded`, LogPrefix.Backend)
    } catch (error) {
      logError(
        `Error while downloading saves for ${title}. ${error}`,
        LogPrefix.Backend
      )
    }
  }

  sendGameStatusUpdate({
    appName,
    runner,
    status: 'launching'
  })

  const mainWindow = getMainWindow()
  if (minimizeOnLaunch && !noTrayIcon) {
    mainWindow?.hide()
  }

  // Prevent display from sleep
  if (!powerDisplayId) {
    logInfo('Preventing display from sleep', LogPrefix.Backend)
    powerDisplayId = powerSaveBlocker.start('prevent-display-sleep')
  }

  const logWriter = await createGameLogWriter(appName, runner)

  if (!gameSettings.verboseLogs) {
    await logWriter.logWarning('IMPORTANT: Logs are disabled', {
      forceLog: true
    })
    await logWriter.logWarning(
      "Enable verbose logs in Game's settings > Advanced tab > 'Enable verbose logs' before reporting an issue.",
      { forceLog: true }
    )
  }

  await runBeforeLaunchScript(gameInfo, gameSettings, logWriter)

  sendGameStatusUpdate({
    appName,
    runner,
    status: 'launching'
  })

  const command = game.launch(
    logWriter,
    launchArguments,
    args,
    skipVersionCheck
  )

  const launchResult = await command
    .catch(async (exception) => {
      logError(exception, LogPrefix.Backend)
      await logWriter.logError([
        `An exception occurred when launching the game:`
      ])
      await logWriter.logError(exception)

      return false
    })
    .finally(async () => {
      await runAfterLaunchScript(gameInfo, gameSettings, logWriter)
      await logWriter.close()
    })

  // Stop display sleep blocker
  if (powerDisplayId !== null) {
    logInfo('Stopping Display Power Saver Blocker', LogPrefix.Backend)
    powerSaveBlocker.stop(powerDisplayId)
  }

  // Update playtime and last played date
  const finishedPlayingDate = new Date()
  tsStore.set(`${appName}.lastPlayed`, finishedPlayingDate.toISOString())
  // Playtime of this session in minutes
  const sessionPlaytime =
    (finishedPlayingDate.getTime() - startPlayingDate.getTime()) / 1000 / 60
  const totalPlaytime =
    sessionPlaytime + tsStore.get(`${appName}.totalPlayed`, 0)
  tsStore.set(`${appName}.totalPlayed`, Math.floor(totalPlaytime))

  await addRecentGame(gameInfo)

  if (autoSyncSaves && isOnline()) {
    sendGameStatusUpdate({
      appName,
      runner,
      status: 'done'
    })

    sendGameStatusUpdate({
      appName,
      runner,
      status: 'syncing-saves'
    })

    logInfo(`Uploading saves for ${title}`, LogPrefix.Backend)
    try {
      await game.syncSaves('--skip-download', savesPath)
      logInfo(`Saves uploaded for ${title}`, LogPrefix.Backend)
    } catch (error) {
      logError(
        `Error uploading saves for ${title}. Error: ${error}`,
        LogPrefix.Backend
      )
    }
  }

  sendGameStatusUpdate({
    appName,
    runner,
    status: 'done'
  })

  // Exit if we've been launched without UI
  if (isCLINoGui) {
    app.exit()
  }

  return { status: launchResult ? 'done' : 'error' }
}

// Native-Linux-only launcher: no per-platform Wine/Proton/DXVK settings to
// prune anymore, so this just strips the noisy/irrelevant fields before we
// log the game's settings.
function filterGameSettingsForLog(
  originalSettings: GameSettings
): PartialDeep<GameSettings> {
  const gameSettings: PartialDeep<GameSettings> =
    structuredClone(originalSettings)

  // this is irrelevant for support
  delete gameSettings.enableQuickSavesMenu
  // if this is visible, it means verboseLogs is true, no need to print it
  delete gameSettings.verboseLogs

  return gameSettings
}

async function prepareLaunch(
  gameSettings: GameSettings,
  logWriter: LogWriter,
  gameInfo: GameInfo,
  isNative: boolean
): Promise<LaunchPreperationResult> {
  const globalSettings = GlobalConfig.get().getSettings()

  let offlineMode = gameSettings.offlineMode || !isOnline()

  if (!offlineMode && gameInfo.runner === 'legendary') {
    offlineMode = await isEpicServiceOffline()
  }

  // Check if the game needs an internet connection
  if (!gameInfo.canRunOffline && offlineMode) {
    logWriter.logWarning(
      'Offline Mode is on but the game does not allow offline mode explicitly.'
    )
  }

  // Update Discord RPC if enabled
  let rpcClient = undefined
  if (globalSettings.discordRPC) {
    rpcClient = constructAndUpdateRPC(gameInfo)
  }

  await logWriter.logInfo([
    'Launching',
    `"${gameInfo.title}" (${gameInfo.runner})`
  ])
  await logWriter.logInfo(['Native?', isNative])

  const isThirdPartyManagedApp = gameInfo && !!gameInfo.thirdPartyManagedApp

  if (isThirdPartyManagedApp) {
    await logWriter.logInfo([
      'Managed by a third-party app:',
      gameInfo.thirdPartyManagedApp,
      '\n\n'
    ])
  } else {
    const installPath = gameInfo.install.install_path

    await logWriter.logInfo(['Installed in:', installPath, '\n\n'])
  }

  await logWriter.logInfo([
    'System Info:',
    getSystemInfo()
      .then(formatSystemInfo)
      .then((s) => `\n${s}\n\n`)
  ])

  await logWriter.logInfo([
    'Game Settings:',
    filterGameSettingsForLog(gameSettings),
    '\n',
    `Stored at: ${join(gamesConfigPath, gameInfo.app_name + '.json')}`,
    '\n\n'
  ])

  return { success: true, rpcClient, offlineMode }
}

/**
 * Maps general settings to environment variables
 * @param gameSettings The GameSettings to get the environment variables for
 * @returns A big string of environment variables, structured key=value
 */
function setupEnvVars(gameSettings: GameSettings, installPath?: string) {
  const ret: Record<string, string> = {}

  if (isLinux && installPath) {
    ret.STEAM_COMPAT_INSTALL_PATH = installPath
  }

  if (gameSettings.enviromentOptions) {
    gameSettings.enviromentOptions.forEach((envEntry: EnviromentVariable) => {
      ret[envEntry.key] = removeQuoteIfNecessary(envEntry.value)
    })
  }

  // setup LD_PRELOAD if not defined
  // fixes the std::log_error for Fall Guys
  // thanks to https://github.com/Diyou
  if (!process.env.LD_PRELOAD && !ret.LD_PRELOAD) {
    ret.LD_PRELOAD = ''
  }

  return ret
}

/**
 * Maps launcher info to environment variables for consumption by wrappers
 * @param wrapperEnv The info to be added into the environment variables
 * @returns Environment variables
 */
function setupWrapperEnvVars(wrapperEnv: WrapperEnv) {
  const ret: Record<string, string> = {}

  ret.HEROIC_APP_NAME = wrapperEnv.appName
  ret.HEROIC_APP_RUNNER = wrapperEnv.appRunner
  ret.HEROIC_APP_SOURCE = 'epic'
  ret.STORE = 'egs'

  return ret
}

function setupWrappers(gameSettings: GameSettings): Array<string> {
  const wrappers: string[] = []

  if (gameSettings.wrapperOptions) {
    gameSettings.wrapperOptions.forEach((wrapperEntry: WrapperVariable) => {
      wrappers.push(wrapperEntry.exe)
      wrappers.push(...shlex.split(wrapperEntry.args ?? ''))
    })
  }
  return wrappers.filter((n) => n)
}

function launchCleanup(rpcClient?: RpcClient) {
  if (rpcClient) {
    rpcClient.destroy()
    logInfo('Stopped Discord Rich Presence', LogPrefix.Backend)
  }
}

interface RunnerProps {
  name: Runner
  logPrefix: LogPrefix
  bin: string
  dir?: string
}

const commandsRunning: Record<string, Promise<ExecResult>> = {}

let shouldUsePowerShell: boolean | null = null

function appNameFromCommandParts(commandParts: string[], runner: Runner) {
  let appNameIndex = -1

  if (runner === 'legendary') {
    // for legendary, the appName comes right after the commands
    const idx = commandParts.findIndex((value) =>
      ['launch', 'install', 'repair', 'update'].includes(value)
    )
    if (idx > -1) {
      appNameIndex = idx + 1
    }
  }

  return appNameIndex > -1 ? commandParts[appNameIndex] : ''
}

async function callRunner(
  commandParts: string[],
  runner: RunnerProps,
  options: CallRunnerOptions
): Promise<ExecResult> {
  const appName = appNameFromCommandParts(commandParts, runner.name)

  // Automatically add the relevant LogWriter for the runner
  options.logWriters ??= []
  options.logWriters.push(getRunnerLogWriter(runner.name))

  // Necessary to get rid of possible undefined or null entries, else
  // TypeError is triggered
  commandParts = commandParts.filter(Boolean)

  let bin = runner.bin
  let fullRunnerPath = runner.dir ? join(runner.dir, bin) : bin

  // macOS/Linux: `spawn`ing an executable in the current working directory
  // requires a "./"
  if (!isWindows && !isAbsolute(bin) && runner.dir) bin = './' + bin

  // On Windows: Use PowerShell's `Start-Process` to wait for the process and
  // its children to exit, provided PowerShell is available
  if (shouldUsePowerShell === null)
    shouldUsePowerShell =
      isWindows && !!(await searchForExecutableOnPath('powershell'))

  if (shouldUsePowerShell) {
    const argsAsString = commandParts
      .map((part) => part.replaceAll('\\', '\\\\'))
      .map((part) => `"\`"${part}\`""`)
      .join(',')
    commandParts = [
      '-NoProfile',
      'Start-Process',
      `"\`"${fullRunnerPath}\`""`,
      '-Wait',
      '-NoNewWindow'
    ]
    if (argsAsString) commandParts.push('-ArgumentList', argsAsString)

    bin = fullRunnerPath = 'powershell'
  }

  const safeCommand = getRunnerCallWithoutCredentials(
    [...commandParts],
    options?.env,
    fullRunnerPath
  )

  const prefix = `${options.logMessagePrefix ?? 'Running command'}:`
  logInfo([prefix, safeCommand], runner.logPrefix)

  if (options?.logWriters) {
    for (const writer of options.logWriters) {
      await writer.logInfo(
        [prefix, safeCommand, '\n\n'].filter(Boolean).join(' ')
      )
      if (appName) await writer.logInfo('Game Output:')
    }
  }

  // check if the same command is currently running
  // if so, return the same promise instead of running it again
  const key = [runner.name, commandParts].join(' ')
  const currentPromise = commandsRunning[key]

  if (key in commandsRunning) {
    return currentPromise
  }

  const abortId = options?.abortId || appName || Math.random().toString()
  const abortController = createAbortController(abortId)

  let promise = new Promise<ExecResult>((res, rej) => {
    const child = spawn(bin, commandParts, {
      cwd: options?.cwd || runner.dir,
      env: { ...process.env, ...options?.env },
      signal: abortController.signal
    })

    const stdout = memoryLog()
    const stderr = memoryLog()

    child.stdout.setEncoding('utf-8')
    child.stdout.on('data', (data: string) => {
      const stringToLog = options?.logSanitizer
        ? options.logSanitizer(data)
        : data

      options?.logWriters?.forEach((writer) => writer.writeString(stringToLog))

      if (options?.onOutput) {
        options.onOutput(data, child)
      }

      stdout.push(data.trim())
    })

    child.stderr.setEncoding('utf-8')
    child.stderr.on('data', (data: string) => {
      const stringToLog = options?.logSanitizer
        ? options.logSanitizer(data)
        : data

      options?.logWriters?.forEach((writer) => writer.writeString(stringToLog))

      if (options?.onOutput) {
        options.onOutput(data, child)
      }

      stderr.push(data.trim())
    })

    child.on('close', (code, signal) => {
      errorHandler(
        `${stdout.join().concat(stderr.join())}`,
        appName,
        runner.name
      )

      if (signal && !child.killed) {
        rej(new Error(`Process terminated with signal ${signal}`))
      }

      res({
        stdout: stdout.join(),
        stderr: stderr.join('\n')
      })
    })

    child.on('error', (error) => {
      rej(error)
    })
  })

  promise = promise
    .then(({ stdout, stderr }) => {
      return { stdout, stderr, fullCommand: safeCommand }
    })
    .catch((error) => {
      if (abortController.signal.aborted) {
        logInfo(['Abort command', `"${safeCommand}"`], runner.logPrefix)

        return {
          stdout: '',
          stderr: '',
          fullCommand: safeCommand,
          abort: true
        }
      }

      errorHandler(error, appName, runner.name)

      logError(
        ['Error running', 'command', `"${safeCommand}":`, error],
        runner.logPrefix
      )

      return { stdout: '', stderr: `${error}`, fullCommand: safeCommand, error }
    })
    .finally(() => {
      // remove from list when done
      delete commandsRunning[key]
      deleteAbortController(abortId)
    })

  // keep track of which commands are running
  commandsRunning[key] = promise

  return promise
}

/**
 * Generates a formatted, safe command that can be logged
 * @param command The runner command that's executed, e.g. install, list, etc.
 * Note that this will be modified, so pass a copy of your actual command parts
 * @param env Enviroment variables to use
 * @param wrappers Wrappers to use (gamemode, steam runtime, etc.)
 * @param runnerPath The full path to the runner executable
 * @returns
 */
function getRunnerCallWithoutCredentials(
  command: string[] | LegendaryCommand,
  env: Record<string, string> | NodeJS.ProcessEnv = {},
  runnerPath: string
): string {
  if (!Array.isArray(command))
    command = libraryManagerMap['legendary'].commandToArgsArray(command)

  const modifiedCommand = [...command]
  // Redact sensitive arguments (Authorization Code for Legendary, token for GOGDL)
  for (const sensitiveArg of ['--code', '--token']) {
    // PowerShell's argument formatting is quite different, instead of having
    // arguments as members of `command`, they're all in one specific member
    // (the one after "-ArgumentList")
    if (runnerPath === 'powershell') {
      const argumentListIndex = modifiedCommand.indexOf('-ArgumentList') + 1
      if (!argumentListIndex) continue
      modifiedCommand[argumentListIndex] = modifiedCommand[
        argumentListIndex
      ].replace(
        new RegExp(`"${sensitiveArg}","(.*?)"`),
        `"${sensitiveArg}","<redacted>"`
      )
    } else {
      const sensitiveArgIndex = modifiedCommand.indexOf(sensitiveArg)
      if (sensitiveArgIndex === -1) {
        continue
      }
      modifiedCommand[sensitiveArgIndex + 1] = '<redacted>'
    }
  }

  const formattedEnvVars: string[] = []
  for (const [key, value] of Object.entries(env)) {
    // Only add variables if they aren't already defined in our own env
    if (key in process.env) {
      if (value === process.env[key]) {
        continue
      }
    }
    formattedEnvVars.push(`${key}=${quoteIfNecessary(value ?? '')}`)
  }

  return [
    ...formattedEnvVars,
    quoteIfNecessary(runnerPath),
    ...modifiedCommand.map(quoteIfNecessary)
  ].join(' ')
}

async function runBeforeLaunchScript(
  gameInfo: GameInfo,
  gameSettings: GameSettings,
  logWriter: LogWriter
) {
  if (!gameSettings.beforeLaunchScriptPath) {
    return true
  }

  await logWriter.writeString(
    `Running script before ${gameInfo.title} (${gameSettings.beforeLaunchScriptPath})\n`
  )

  return runScriptForGame(gameInfo, gameSettings, 'before', logWriter)
}

async function runAfterLaunchScript(
  gameInfo: GameInfo,
  gameSettings: GameSettings,
  logWriter: LogWriter
) {
  if (!gameSettings.afterLaunchScriptPath) {
    return true
  }

  await logWriter.writeString(
    `Running script after ${gameInfo.title} (${gameSettings.afterLaunchScriptPath})\n`
  )
  return runScriptForGame(gameInfo, gameSettings, 'after', logWriter)
}

/* Execute script before launch/after exit, wait until the script
 * exits to continue
 *
 * The script can start sub-processes with `bash another-command &`
 * if `another-command` should run asynchronously
 *
 * For example:
 *
 * ```
 * #!/bin/bash
 *
 * echo "this runs before/after the game"
 * bash ./another.bash & # this is launched before/after the game but is not waited
 * echo "this also runs before/after the game too" > someoutput.txt
 * ```
 *
 * Notes:
 * - Output and logs are printed in the game's log
 * - Make sure the script is executable
 * - Make sure any async process is not stuck running in the background forever,
 *   use the after script to kill any running process if that's the case
 */
async function runScriptForGame(
  gameInfo: GameInfo,
  gameSettings: GameSettings,
  scriptStage: 'before' | 'after',
  logWriter: LogWriter
): Promise<boolean | string> {
  return new Promise((resolve, reject) => {
    const scriptPath = gameSettings[`${scriptStage}LaunchScriptPath`]
    const scriptEnv = {
      HEROIC_GAME_APP_NAME: gameInfo.app_name,
      HEROIC_GAME_EXEC: gameInfo.install.executable,
      HEROIC_GAME_RUNNER: gameInfo.runner,
      HEROIC_GAME_SCRIPT_STAGE: scriptStage,
      HEROIC_GAME_TITLE: gameInfo.title,
      HEROIC_GAME_SETTINGS: JSON.stringify(gameSettings),
      HEROIC_GAME_INFO: JSON.stringify(gameInfo),
      ...process.env
    }
    const child = spawn(scriptPath, {
      cwd: gameInfo.install.install_path,
      env: scriptEnv
    })
    child.stdout.setEncoding('utf-8')
    child.stderr.setEncoding('utf-8')

    if (gameSettings.verboseLogs) {
      child.stdout.on('data', (data: string) => {
        logWriter.writeString(data)
      })

      child.stderr.on('data', (data: string) => {
        logWriter.writeString(data)
      })
    }

    child.on('error', (err) => {
      if (gameSettings.verboseLogs) {
        logWriter.logError(err)
      }
      reject(err)
    })

    child.on('exit', () => {
      resolve(true)
    })
  })
}

export {
  prepareLaunch,
  launchCleanup,
  setupEnvVars,
  setupWrapperEnvVars,
  setupWrappers,
  callRunner,
  launchEventCallback
}
