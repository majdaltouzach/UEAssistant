import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import useSetting from 'frontend/hooks/useSetting'
import SettingsContext from '../../SettingsContext'
import LegendarySyncSaves from './legendary'
import { ToggleSwitch } from 'frontend/components/UI'

const SyncSaves = () => {
  const { t } = useTranslation()
  const { runner, gameInfo } = useContext(SettingsContext)

  const [autoSyncSaves, setAutoSyncSaves] = useSetting('autoSyncSaves', false)
  const [savesPath, setSavesPath] = useSetting('savesPath', '')
  const [enableQuickSavesMenu, setEnableQuickSavesMenu] = useSetting(
    'enableQuickSavesMenu',
    false
  )

  const syncCommands = [
    { name: t('setting.manualsync.download'), value: '--skip-upload' },
    { name: t('setting.manualsync.upload'), value: '--skip-download' },
    { name: t('setting.manualsync.forcedownload'), value: '--force-download' },
    { name: t('setting.manualsync.forceupload'), value: '--force-upload' }
  ]

  const QuickSavesToggle = () => {
    return (
      <ToggleSwitch
        htmlId="enableQuickSavesMenu"
        value={enableQuickSavesMenu}
        handleChange={() => setEnableQuickSavesMenu(!enableQuickSavesMenu)}
        title={t(
          'setting.enable-quick-sync-menu',
          'Enable Quick Save-Sync Menu on game page'
        )}
      />
    )
  }

  if (runner === 'legendary') {
    return (
      <LegendarySyncSaves
        featureSupported={!!gameInfo?.cloud_save_enabled}
        savesPath={savesPath}
        setSavesPath={setSavesPath}
        autoSyncSaves={autoSyncSaves}
        setAutoSyncSaves={setAutoSyncSaves}
        syncCommands={syncCommands}
        quickSavesToggle={QuickSavesToggle}
      />
    )
  }

  return <></>
}

export default SyncSaves
