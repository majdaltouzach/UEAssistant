import { Runner } from 'common/types'
import { logDebug, LogPrefix, logInfo, logError } from './logger'
import { readFileSync, writeFileSync } from 'graceful-fs'
import { libraryManagerMap } from 'backend/storeManagers'
import { LegendaryAppName } from './storeManagers/legendary/commands/base'
import { legendaryInstalled } from './storeManagers/legendary/constants'

async function getDefaultSavePath(
  appName: string,
  runner: Runner
): Promise<string> {
  switch (runner) {
    case 'legendary':
      return getDefaultLegendarySavePath(appName)
  }
}

async function getDefaultLegendarySavePath(appName: string): Promise<string> {
  const game = libraryManagerMap['legendary'].getGame(appName)
  const { save_folder, save_path } = game.getGameInfo()
  logInfo(
    ['Computing save path for save folder', save_folder],
    LogPrefix.Legendary
  )
  if (save_path) {
    logDebug(
      ['Legendary has a save path stored, discarding it:', save_path],
      LogPrefix.Legendary
    )
    // FIXME: This isn't really that safe
    try {
      const installedJsonLoc = legendaryInstalled
      const installedJsonData = JSON.parse(
        readFileSync(installedJsonLoc, 'utf-8')
      )
      installedJsonData[appName].save_path = null
      writeFileSync(
        installedJsonLoc,
        JSON.stringify(installedJsonData, undefined, '  ')
      )
    } catch (e) {
      logError(['Failed to discard save path:', e], LogPrefix.Legendary)
      return save_path
    }
  }

  logInfo(['Computing default save path for', appName], LogPrefix.Legendary)
  await libraryManagerMap['legendary'].runRunnerCommand(
    {
      subcommand: 'sync-saves',
      appName: LegendaryAppName.parse(appName),
      '--skip-upload': true,
      '--skip-download': true,
      '--accept-path': true
    },
    {
      abortId: appName + '-savePath',
      logMessagePrefix: 'Getting default save path'
    }
  )

  // If the save path was computed successfully, Legendary will have saved
  // this path in `installed.json` (so the GameInfo)
  const { save_path: new_save_path } = libraryManagerMap[
    'legendary'
  ].getGameInfo(appName, true)!
  if (!new_save_path) {
    logError(
      ['Unable to compute default save path for', appName],
      LogPrefix.Legendary
    )
    return ''
  }
  logInfo(['Computed save path:', new_save_path], LogPrefix.Legendary)
  return new_save_path
}

export { getDefaultSavePath }
