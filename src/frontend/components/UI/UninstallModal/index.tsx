import './index.scss'
import React, { useContext, useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader
} from 'frontend/components/UI/Dialog'
import { useTranslation } from 'react-i18next'
import { Runner } from 'common/types'
import ToggleSwitch from '../ToggleSwitch'
import { useNavigate, useLocation } from 'react-router-dom'
import ContextProvider from 'frontend/state/ContextProvider'

interface UninstallModalProps {
  appName: string
  runner: Runner
  onClose: () => void
  isDlc: boolean
}

const UninstallModal: React.FC<UninstallModalProps> = function ({
  appName,
  runner,
  onClose,
  isDlc
}) {
  const [deleteSettingsChecked, setDeleteSettingsChecked] = useState(false)
  const { t } = useTranslation('gamepage')
  const [showUninstallModal, setShowUninstallModal] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { installingEpicGame, libraryStatus } = useContext(ContextProvider)
  const [gameTitle, setGameTitle] = useState('')

  const isGameRunning = libraryStatus.find(
    (st) =>
      st.appName === appName && st.runner === runner && st.status === 'playing'
  )

  const loadGameInfo = async () => {
    setShowUninstallModal(true)

    const gameInfo = await window.api.getGameInfo(appName, runner)

    if (isDlc || !gameInfo) {
      return
    }

    setGameTitle(gameInfo.overrides?.title || gameInfo.title)
  }

  useEffect(() => {
    loadGameInfo()
  }, [])

  const storage: Storage = window.localStorage
  const uninstallGame = async () => {
    onClose()

    await window.api.uninstall(appName, runner, false, deleteSettingsChecked)
    if (location.pathname.match(/gamepage/)) {
      navigate('/#library')
    }
    storage.removeItem(appName)
  }

  // disallow uninstalling epic games if an epic game is being installed
  if (installingEpicGame && runner === 'legendary') {
    return (
      <>
        {showUninstallModal && (
          <Dialog onClose={onClose} showCloseButton className="uninstall-modal">
            <DialogHeader onClose={onClose}>
              {t('gamepage:box.uninstall.title')}
            </DialogHeader>
            <DialogContent>
              {t(
                'gamepage:box.uninstall.cannotUninstallEpic',
                'Epic games cannot be uninstalled while another Epic game is being installed.'
              )}
            </DialogContent>
            <DialogFooter>
              <button onClick={onClose} className={`button outline`}>
                {t('box.close', 'Close')}
              </button>
            </DialogFooter>
          </Dialog>
        )}
      </>
    )
  }

  if (isGameRunning) {
    return (
      <>
        {showUninstallModal && (
          <Dialog onClose={onClose} showCloseButton className="uninstall-modal">
            <DialogHeader onClose={onClose}>
              {t('gamepage:box.uninstall.title')}
            </DialogHeader>
            <DialogContent>
              {t('gamepage:box.uninstall.gameIsRunning', {
                defaultValue:
                  '{{title}} is running. Close the game to uninstall it.',
                title: gameTitle
              })}
            </DialogContent>
            <DialogFooter>
              <button onClick={onClose} className={`button outline`}>
                {t('box.close', 'Close')}
              </button>
            </DialogFooter>
          </Dialog>
        )}
      </>
    )
  }

  // normal dialog to uninstall a game
  return (
    <>
      {showUninstallModal && (
        <Dialog onClose={onClose} showCloseButton className="uninstall-modal">
          <DialogHeader onClose={onClose}>
            {t('gamepage:box.uninstall.title')}
          </DialogHeader>
          <DialogContent>
            <div className="uninstallModalMessage">
              {isDlc
                ? t('gamepage:box.uninstall.dlc', {
                    defaultValue: 'Do you want to uninstall "{{title}}" (DLC)?',
                    title: gameTitle
                  })
                : t('gamepage:box.uninstall.message', {
                    defaultValue: 'Do you want to uninstall "{{title}}"?',
                    title: gameTitle
                  })}
            </div>
            {!isDlc && (
              <ToggleSwitch
                htmlId="uninstallsettingCheckbox"
                value={deleteSettingsChecked}
                title={t('gamepage:box.uninstall.settingcheckbox', {
                  defaultValue:
                    "Erase settings and remove log{{newLine}}Note: This can't be undone. Any modified settings will be forgotten and log will be deleted.",
                  newLine: '\n'
                })}
                handleChange={() => {
                  setDeleteSettingsChecked(!deleteSettingsChecked)
                }}
              />
            )}
          </DialogContent>
          <DialogFooter>
            <button
              onClick={uninstallGame}
              className={`button is-secondary outline`}
            >
              {t('box.yes')}
            </button>
            <button onClick={onClose} className={`button is-secondary outline`}>
              {t('box.no')}
            </button>
          </DialogFooter>
        </Dialog>
      )}
    </>
  )
}

export default UninstallModal
