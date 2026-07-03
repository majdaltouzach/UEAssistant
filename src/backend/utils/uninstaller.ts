import { fixesPath, gamesConfigPath } from 'backend/constants/paths'
import { notify } from 'backend/dialog/dialog'
import { logError, logInfo, LogPrefix } from 'backend/logger'
import { libraryManagerMap } from 'backend/storeManagers'
import { sendGameStatusUpdate } from 'backend/utils'
import { Runner } from 'common/types'
import { storeMap } from 'common/utils'
import { Event } from 'electron'
import { existsSync, rmSync } from 'graceful-fs'
import i18next from 'i18next'
import { join } from 'path'

const removeFixFile = (appName: string, runner: Runner) => {
  const fixFilePath = join(fixesPath, `${appName}-${storeMap[runner]}.json`)
  if (existsSync(fixFilePath)) {
    rmSync(fixFilePath)
  }
}

const removeSettingsAndLogs = (appName: string) => {
  const removeIfExists = (filename: string) => {
    logInfo(`Removing ${filename}`, LogPrefix.Backend)
    const gameSettingsFile = join(gamesConfigPath, filename)
    if (existsSync(gameSettingsFile)) {
      rmSync(gameSettingsFile)
    }
  }

  removeIfExists(appName.concat('.json'))
  removeIfExists(appName.concat('.log'))
  removeIfExists(appName.concat('-lastPlay.log'))
}

export const uninstallGameCallback = async (
  event: Event,
  appName: string,
  runner: Runner,
  shouldRemovePrefix: boolean,
  shouldRemoveSetting: boolean
) => {
  sendGameStatusUpdate({
    appName,
    runner,
    status: 'uninstalling'
  })

  const game = libraryManagerMap[runner].getGame(appName)
  const { title } = game.getGameInfo()

  let uninstalled = false

  try {
    await game.uninstall()
    uninstalled = true
  } catch (error) {
    notify({
      title,
      body: i18next.t('notify.uninstalled.error', 'Error uninstalling')
    })
    logError(error, LogPrefix.Backend)
  }

  if (uninstalled) {
    if (shouldRemoveSetting) {
      removeSettingsAndLogs(appName)
    }
    removeFixFile(appName, runner)

    notify({ title, body: i18next.t('notify.uninstalled') })
    logInfo('Finished uninstalling', LogPrefix.Backend)
  }

  sendGameStatusUpdate({
    appName,
    runner,
    status: 'done'
  })
}
