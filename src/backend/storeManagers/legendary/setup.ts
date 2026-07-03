import { libraryManagerMap } from '..'
import { sendGameStatusUpdate } from 'backend/utils'
import { enable, getStatus, isEnabled } from './eos_overlay/eos_overlay'
import { isLinux } from 'backend/constants/environment'
import LogWriter from 'backend/logger/log_writer'

// UEAssistant only installs/launches native Linux builds, so none of the
// Windows-prerequisite-via-Wine setup Heroic used to do here (registry
// fixes, EA App/Ubisoft Connect installers) applies. The only thing left
// to set up post-install is the (optional) EOS Overlay.
export const legendarySetup = async (appName: string, logWriter: LogWriter) => {
  const gameInfo = libraryManagerMap['legendary'].getGame(appName).getGameInfo()
  if (!gameInfo) {
    return
  }

  sendGameStatusUpdate({
    appName,
    runner: 'legendary',
    status: 'redist',
    context: 'EPIC'
  })

  // We only want to enable the EOS Overlay on linux
  // On windows, the overlay is installed globally
  // On mac, the overlay doesn't work
  if (isLinux) {
    const isOverlayEnabled = await isEnabled()

    if (!isOverlayEnabled) {
      if (getStatus().isInstalled) {
        void logWriter.logInfo('EOS Overlay: Enabling')
        await enable()
      } else {
        void logWriter.logInfo('EOS Overlay: Not Installed')
      }
    }
  }
}
