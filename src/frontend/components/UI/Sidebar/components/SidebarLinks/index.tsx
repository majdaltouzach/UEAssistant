import {
  faBookOpen,
  faSlidersH,
  faStore,
  faUser,
  faUniversalAccess,
  faCoffee,
  faUserAlt,
  faBarsProgress,
  faTv
} from '@fortawesome/free-solid-svg-icons'
import { useLocation } from 'react-router-dom'
import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { faDiscord, faGithub } from '@fortawesome/free-brands-svg-icons'
import { openDiscordLink } from 'frontend/helpers'

import ContextProvider from 'frontend/state/ContextProvider'
import QuitButton from '../QuitButton'
import { SHOW_EXTERNAL_LINK_DIALOG_STORAGE_KEY } from 'frontend/components/UI/ExternalLinkDialog'
import SidebarItem from '../SidebarItem'

type PathSplit = [a: undefined, b: undefined, type: string]

export default function SidebarLinks() {
  const { t } = useTranslation()
  const location = useLocation() as { pathname: string }
  const [, , type] = location.pathname.split('/') as PathSplit

  const { epic, platform, handleExternalLinkDialog } =
    useContext(ContextProvider)

  const isSettings = location.pathname.includes('settings')
  const isWin = platform === 'win32'

  const loggedIn = Boolean(epic.username)

  function handleExternalLink(linkCallback: () => void) {
    const showDialogSetting = localStorage.getItem(
      SHOW_EXTERNAL_LINK_DIALOG_STORAGE_KEY
    )
    const showExternalLinkDialog = showDialogSetting
      ? (JSON.parse(showDialogSetting) as boolean)
      : true

    if (showExternalLinkDialog) {
      handleExternalLinkDialog({ showDialog: true, linkCallback })
    } else {
      linkCallback()
    }
  }

  return (
    <div className="SidebarLinks Sidebar__section" data-tour="sidebar-menu">
      {!loggedIn && (
        <SidebarItem
          icon={faUser}
          label={t('button.login', 'Login')}
          url="/login"
          dataTour="sidebar-login"
        />
      )}

      <SidebarItem
        isActiveFallback={location.pathname.includes('store')}
        url="/store/epic"
        icon={faStore}
        label={t('stores', 'Epic Games Store')}
        dataTour="sidebar-stores"
      />

      <div className="divider" />
      <div className="SidebarItemWithSubmenu">
        <SidebarItem
          isActiveFallback={location.pathname.includes('settings')}
          icon={faSlidersH}
          label={t('Settings', 'Settings')}
          url="/settings/general"
          dataTour="sidebar-settings"
        />
        {isSettings && (
          <div className="SidebarSubmenu settings">
            <SidebarItem
              url="/settings/general"
              isActiveFallback={type === 'general'}
              className="SidebarLinks__subItem"
              label={t('settings.navbar.general')}
            />

            {!isWin && (
              <SidebarItem
                url="/settings/games_settings"
                isActiveFallback={type === 'games_settings'}
                className="SidebarLinks__subItem"
                label={t(
                  'settings.navbar.games_settings_defaults',
                  'Game Defaults'
                )}
              />
            )}

            <SidebarItem
              url="/settings/advanced"
              isActiveFallback={type === 'advanced'}
              className="SidebarLinks__subItem"
              label={t('settings.navbar.advanced', 'Advanced')}
            />

            <SidebarItem
              url="/settings/systeminfo"
              isActiveFallback={type === 'systeminfo'}
              className="SidebarLinks__subItem"
              label={t(
                'settings.navbar.systemInformation',
                'System Information'
              )}
            />

            <SidebarItem
              url="/settings/log"
              isActiveFallback={type === 'log'}
              className="SidebarLinks__subItem"
              label={t('settings.navbar.log', 'Log')}
            />
          </div>
        )}
      </div>
      <SidebarItem
        url="/console"
        icon={faTv}
        label={t('sidebar.console', 'Console Mode')}
        dataTour="sidebar-console"
      />

      <SidebarItem
        url="/download-manager"
        icon={faBarsProgress}
        label={t('download-manager.link', 'Downloads')}
        dataTour="sidebar-downloads"
      />

      {loggedIn && (
        <SidebarItem
          url="/login"
          icon={faUserAlt}
          label={t('userselector.manageaccounts', 'Manage Accounts')}
          dataTour="sidebar-manage-accounts"
        />
      )}

      <SidebarItem
        url="/accessibility"
        icon={faUniversalAccess}
        label={t('accessibility.title', 'Accessibility')}
        dataTour="sidebar-accessibility"
      />

      <div className="divider" />

      <SidebarItem
        url="/wiki"
        icon={faBookOpen}
        label={t('docs', 'Documentation')}
        dataTour="sidebar-docs"
      />

      <div data-tour="sidebar-community">
        <SidebarItem
          elementType="button"
          onClick={() => handleExternalLink(openDiscordLink)}
          icon={faDiscord}
          label={t('userselector.discord', 'Discord')}
        />

        <SidebarItem
          elementType="button"
          onClick={() => handleExternalLink(window.api.openPatreonPage)}
          icon={faCoffee}
          label="Patreon"
        />

        <SidebarItem
          elementType="button"
          onClick={() => handleExternalLink(window.api.openKofiPage)}
          icon={faCoffee}
          label="Ko-fi"
        />

        <SidebarItem
          elementType="button"
          onClick={() => handleExternalLink(window.api.openGithubSponsorsPage)}
          icon={faGithub}
          label="GitHub Sponsors"
        />
      </div>

      <QuitButton dataTour="sidebar-quit" />
    </div>
  )
}
