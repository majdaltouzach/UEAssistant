import { backendEvents } from 'backend/backend_events'
import {
  isFlatpak,
  isAppImage,
  isSnap,
  isSteamDeckGameMode,
  isSteamDeck
} from 'backend/constants/environment'
import { logInfo, logWarning, LogPrefix } from 'backend/logger'
import { LegendaryUser } from 'backend/storeManagers/legendary/user'
import { getOsInfo } from 'backend/utils/systeminfo/osInfo'
import { app } from 'electron'
import https from 'https'

const PLAUSIBLE_DOMAIN = 'heroic-games-client.com'
const PLAUSIBLE_API = 'https://plausible.io/api/event'

interface PlausibleEventProps {
  [key: string]: string | number | boolean
}

function sendPlausible(payload: object): Promise<void> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const req = https.request(
      PLAUSIBLE_API,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'HeroicGamesLauncher/1.0'
        }
      },
      (res) => {
        res.on('data', () => {})
        res.on('end', resolve)
      }
    )
    req.setTimeout(5000, () => {
      req.destroy()
      reject(new Error('Request timed out'))
    })

    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function Plausible() {
  return {
    enableAutoPageviews() {
      // For desktop apps, send a single "pageview" event on app load
      sendPlausible({
        name: 'pageview',
        url: 'app://main',
        domain: PLAUSIBLE_DOMAIN
      }).catch(() => {})
    },
    trackEvent(eventName: string, opts?: { props?: PlausibleEventProps }) {
      sendPlausible({
        name: eventName,
        url: 'app://main',
        domain: PLAUSIBLE_DOMAIN,
        props: opts?.props
      }).catch(() => {})
    }
  }
}

export async function startPlausible() {
  if (process.env.CI === 'e2e') {
    logInfo('Skipping Plausible Analytics in E2E tests', LogPrefix.Backend)
    return
  }

  const plausible = Plausible()
  plausible.enableAutoPageviews()
  const appVersion = app.getVersion()
  const providersObject = {
    epic: !!LegendaryUser.isLoggedIn()
  }
  const loggedInProviders = Object.entries(providersObject)
    .filter(([, v]) => v)
    .map(([k]) => k)

  let distro = 'unknown'
  let distroVersion = 'unknown'
  try {
    const osInfo = await getOsInfo()
    if (osInfo.name) distro = osInfo.name
    if (osInfo.version) distroVersion = osInfo.version
  } catch (error) {
    logWarning(
      `Failed to read OS info for analytics: ${error}`,
      LogPrefix.Backend
    )
  }

  const props = {
    version: appVersion,
    epic: providersObject.epic || false,
    providers: loggedInProviders.join(', '),
    OS: process.platform,
    arch: process.arch,
    distro,
    distroVersion,
    isFlatpak: isFlatpak,
    isAppImage: isAppImage,
    isSnap: isSnap,
    isSteamDeckGameMode: isSteamDeckGameMode,
    isSteamDeck: !!isSteamDeck
  }

  if (process.platform) {
    logInfo('Starting Plausible Analytics', LogPrefix.Backend)
    logInfo(`Shared Data: ${JSON.stringify(props)}`, LogPrefix.Backend)
    plausible.trackEvent('App Loaded', {
      props
    })
  }
}

backendEvents.on('settingChanged', ({ key, newValue }) => {
  if (key === 'analyticsOptIn') {
    if (newValue) {
      logInfo('Starting Plausible Analytics', LogPrefix.Backend)
      startPlausible()
    } else {
      logInfo('Stopping Plausible Analytics', LogPrefix.Backend)
    }
  }
})
