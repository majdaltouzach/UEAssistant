import './index.scss'

import React, { useContext, useState } from 'react'

import { useTranslation } from 'react-i18next'
import {
  AlternativeExe,
  EnvVariablesTable,
  IgnoreGameUpdates,
  LauncherArgs,
  LaunchOptionSelector,
  OfflineMode,
  PreferedLanguage,
  WrappersTable,
  BeforeLaunchScriptPath,
  AfterLaunchScriptPath
} from '../../components'
import { TabPanel } from 'frontend/components/UI'
import SettingsContext from '../../SettingsContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faInfoCircle } from '@fortawesome/free-solid-svg-icons'
import SyncSaves from '../SyncSaves'
import FooterInfo from '../FooterInfo'
import { Tabs, Tab } from '@mui/material'
import VerboseLogs from '../../components/VerboseLogs'

export default function GamesSettings() {
  const { t } = useTranslation()
  const { isDefault, gameInfo } = useContext(SettingsContext)

  const showCloudSavesTab = gameInfo?.runner === 'legendary'

  // Get the latest used tab index for the current game
  const localStorageKey = gameInfo
    ? `${gameInfo.app_name}-setting_tab`
    : 'default'
  const latestTabIndex = localStorage.getItem(localStorageKey) || 'advanced'
  const [value, setValue] = useState(latestTabIndex)

  const handleChange = (
    event: React.ChangeEvent<unknown>,
    newValue: string
  ) => {
    setValue(newValue)
    // Store the latest used tab index for the current game
    localStorage.setItem(localStorageKey, newValue.toString())
  }

  return (
    <>
      {isDefault && (
        <p className="defaults-hint">
          <FontAwesomeIcon icon={faInfoCircle} />
          {t(
            'settings.default_hint',
            'Changes in this section only apply as default values when installing games. If you want to change the settings of an already installed game, use the Settings button in the game page.'
          )}
        </p>
      )}

      <Tabs
        value={value}
        onChange={handleChange}
        aria-label="settings tabs"
        variant="scrollable"
      >
        <Tab
          label={t('settings.navbar.advanced', 'Advanced')}
          value="advanced"
        />

        {showCloudSavesTab && (
          <Tab
            label={t('settings.navbar.sync', 'Cloud Saves Sync')}
            value="saves"
          />
        )}
      </Tabs>

      <TabPanel value={value} index={'advanced'}>
        <IgnoreGameUpdates />
        <OfflineMode />
        <VerboseLogs />
        <AlternativeExe />
        <LaunchOptionSelector />
        <LauncherArgs />
        <div className="Field">
          <label>{t('setting.scripts', 'Scripts:')}</label>
          <BeforeLaunchScriptPath />
          <AfterLaunchScriptPath />
        </div>
        <WrappersTable />
        <EnvVariablesTable />
        <PreferedLanguage />
      </TabPanel>

      <TabPanel value={value} index={'saves'}>
        <SyncSaves />
      </TabPanel>

      {!isDefault && <FooterInfo />}
    </>
  )
}
