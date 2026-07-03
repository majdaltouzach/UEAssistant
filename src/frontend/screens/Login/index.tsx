import React, { useContext, useEffect, useState } from 'react'
import './index.scss'
import Runner from './components/Runner'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import EpicLogo from 'frontend/assets/epic-logo.svg?react'
import HeroicLogo from 'frontend/assets/heroic-icon.svg?react'

import { LanguageSelector, UpdateComponent } from '../../components/UI'
import { FlagPosition } from '../../components/UI/LanguageSelector'
import SIDLogin from './components/SIDLogin'
import ContextProvider from '../../state/ContextProvider'
import { useAwaited } from '../../hooks/useAwaited'
import { hasHelp } from 'frontend/hooks/hasHelp'

export const epicLoginPath = '/loginweb/legendary'

export default React.memo(function NewLogin() {
  const { epic, refreshLibrary } = useContext(ContextProvider)
  const { t } = useTranslation()

  hasHelp(
    'login',
    t('help.title.login', 'Login'),
    <p>{t('help.content.login', 'Log in into the different stores.')}</p>
  )

  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [showSidLogin, setShowSidLogin] = useState(false)
  const [isEpicLoggedIn, setIsEpicLoggedIn] = useState(Boolean(epic.username))

  const systemInfo = useAwaited(window.api.systemInfo.get)

  let oldMac = false
  let oldMacMessage = ''
  if (systemInfo?.OS.platform === 'darwin') {
    const version = parseInt(systemInfo.OS.version.split('.')[0])
    if (version < 12) {
      oldMac = true
      oldMacMessage = t(
        'login.old-mac',
        'Your macOS version is {{version}}. macOS 12 or newer is required to log in.',
        { version: systemInfo.OS.version }
      )
    }
  }

  const loginMessage = t(
    'login.message',
    'Login with your Epic Games account to access Unreal Engine.'
  )

  useEffect(() => {
    setLoading(false)
  }, [epic])

  useEffect(() => {
    setIsEpicLoggedIn(Boolean(epic.username))
  }, [epic.username, t])

  async function handleLibraryClick() {
    await refreshLibrary({ runInBackground: false })
    navigate('/')
  }

  if (loading) {
    return <UpdateComponent />
  }

  return (
    <div className="loginPage">
      {showSidLogin && (
        <SIDLogin
          backdropClick={() => {
            setShowSidLogin(false)
          }}
        />
      )}
      <div className="loginBackground"></div>

      <div className="loginContentWrapper">
        <div className="runnerList">
          <div className="runnerHeader">
            <HeroicLogo className="runnerHeaderIcon" />
            <div className="runnerHeaderText">
              <h1 className="title">UEAssistant</h1>
              <h2 className="subtitle">Unreal Engine Installer</h2>
            </div>

            {!loading && (
              <LanguageSelector
                flagPossition={FlagPosition.PREPEND}
                showWeblateLink={true}
              />
            )}
          </div>

          <p className="runnerMessage">{loginMessage}</p>
          {oldMac && <p className="disabledMessage">{oldMacMessage}</p>}

          <div className="runnerGroup">
            <Runner
              class="epic"
              buttonText={t('login.epic', 'Epic Games Login')}
              loginUrl={epicLoginPath}
              icon={() => <EpicLogo />}
              isLoggedIn={isEpicLoggedIn}
              user={epic.username}
              logoutAction={epic.logout}
              alternativeLoginAction={() => {
                setShowSidLogin(true)
              }}
              disabled={oldMac}
            />
          </div>
        </div>
        <button
          onClick={async () => handleLibraryClick()}
          className="goToLibrary"
        >
          {t('button.go_to_library', 'Go to Library')}
        </button>
      </div>
    </div>
  )
})
