import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useLocation, useParams } from 'react-router-dom'

import { UpdateComponent } from 'frontend/components/UI'
import WebviewControls from 'frontend/components/UI/WebviewControls'
import ContextProvider from 'frontend/state/ContextProvider'
import './index.css'
import LoginWarning from '../Login/components/LoginWarning'

const validStoredUrl = (url: string, store: string) => {
  switch (store) {
    case 'epic':
      return url.includes('epicgames.com')
    default:
      return false
  }
}

export default function WebView() {
  const { i18n } = useTranslation()
  const { pathname, search } = useLocation()
  const { t } = useTranslation()
  const { epic, connectivity } = useContext(ContextProvider)
  const [loading, setLoading] = useState<{
    refresh: boolean
    message: string
  }>(() => ({
    refresh: true,
    message: t('loading.website', 'Loading Website')
  }))
  const navigate = useNavigate()
  const webviewRef = useRef<Electron.WebviewTag>(null)

  // `store` is set to epic depending on which storefront we're
  // supposed to show, `runner` is set to a runner if we're supposed to show its
  // login prompt
  const { store, runner } = useParams()

  let lang = i18n.language
  if (i18n.language === 'pt') {
    lang = 'pt-BR'
  }

  const epicLoginUrl = 'https://www.epicgames.com/id/login?responseType=code'

  const epicStore = `https://www.epicgames.com/store/${lang}/`
  const wikiURL =
    'https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/wiki'

  const trueAsStr = 'true' as unknown as boolean | undefined

  const urls: { [pathname: string]: string } = {
    '/store/epic': epicStore,
    '/wiki': wikiURL,
    '/loginEpic': epicLoginUrl,
    '/loginweb/legendary': epicLoginUrl
  }
  let startUrl = urls[pathname]

  if (store) {
    sessionStorage.setItem('last-store', store)
    const lastUrl = sessionStorage.getItem(`last-url-${store}`)
    if (lastUrl && validStoredUrl(lastUrl, store)) {
      startUrl = lastUrl
    }
  }

  if (pathname.match(/store-page/)) {
    const searchParams = new URLSearchParams(search)
    const queryParam = searchParams.get('store-url')
    if (queryParam) {
      startUrl = queryParam
    }
  }

  const handleSuccessfulLogin = () => {
    navigate('/login')
  }

  const [webviewPreloadPath, setWebviewPreloadPath] = useState('')
  useEffect(() => {
    const fetchWebviewPreloadPath = async () => {
      const path = await window.api.getWebviewPreloadPath()
      setWebviewPreloadPath(path)
    }

    void fetchWebviewPreloadPath()
  }, [])

  useLayoutEffect(() => {
    const webview = webviewRef.current
    if (webview) {
      const loadstop = async () => {
        setLoading({ ...loading, refresh: false })
        const userAgent =
          startUrl === epicLoginUrl
            ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) EpicGamesLauncher'
            : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/200.0'
        if (webview.getUserAgent() != userAgent) {
          webview.setUserAgent(userAgent)
        }
        // Ignore the login handling if not on login page
        if (!runner) {
          return
        } else if (runner == 'legendary') {
          const pageUrl = webview.getURL()
          const parsedUrl = new URL(pageUrl)
          if (parsedUrl.hostname === 'localhost') {
            const code = parsedUrl.searchParams.get('code')
            if (code) {
              setLoading({
                refresh: true,
                message: t('status.logging', 'Logging In...')
              })
              epic.login(code).then(() => handleSuccessfulLogin())
            }
          }
        }
      }

      webview.addEventListener('dom-ready', loadstop)
      // if the page title changed it's because the store loaded so there's
      // connectivity, we can update the status without waiting for the checks
      const updateConnectivity = () => {
        if (connectivity.status !== 'online') {
          window.api.setConnectivityOnline()
        }
      }
      webview.addEventListener('page-title-updated', updateConnectivity)

      return () => {
        webview.removeEventListener('dom-ready', loadstop)
        webview.removeEventListener('page-title-updated', updateConnectivity)
      }
    }
    return
  }, [webviewRef.current, runner, webviewPreloadPath])

  useEffect(() => {
    const webview = webviewRef.current
    if (webview) {
      const onNavigate = () => {
        if (store) {
          const url = webview.getURL()
          if (validStoredUrl(url, store)) {
            sessionStorage.setItem(`last-url-${store}`, webview.getURL())
          }
        }
      }

      // this one is needed for epic
      webview.addEventListener('did-navigate', onNavigate)
      webview.addEventListener('did-navigate-in-page', onNavigate)

      return () => {
        webview.removeEventListener('did-navigate', onNavigate)
        webview.removeEventListener('did-navigate-in-page', onNavigate)
      }
    }

    return
  }, [webviewRef.current, store, runner])

  const [showLoginWarningFor, setShowLoginWarningFor] = useState<null | 'epic'>(
    null
  )

  useEffect(() => {
    if (
      startUrl.match(/epicgames\.com/) &&
      startUrl.indexOf('/id/login') < 0 &&
      !epic.username
    ) {
      setShowLoginWarningFor('epic')
    } else {
      setShowLoginWarningFor(null)
    }
  }, [startUrl])

  const onLoginWarningClosed = () => {
    setShowLoginWarningFor(null)
  }

  // Handle back/forward mouse buttons to navigate inside webview
  useEffect(() => {
    if (!webviewRef.current) return

    const webview = webviewRef.current

    const handleMouseBackForward = (ev: MouseEvent) => {
      // 3 and 4 are the typical `button` value for mouse back/forward buttons on mouseup events
      switch (ev.button) {
        case 3:
          if (webview.canGoBack()) {
            ev.preventDefault()
            webview.goBack()
          }
          break
        case 4:
          if (webview.canGoForward()) {
            ev.preventDefault()
            webview.goForward()
          }
          break
      }
    }

    document.addEventListener('mouseup', handleMouseBackForward)

    return () => {
      document.removeEventListener('mouseup', handleMouseBackForward)
    }
  }, [webviewRef.current])

  if (!webviewPreloadPath) {
    return <></>
  }

  return (
    <div className="WebView">
      {webviewRef.current && (
        <WebviewControls
          webview={webviewRef.current}
          initURL={startUrl}
          openInBrowser={!startUrl.startsWith('login')}
        />
      )}
      {loading.refresh && <UpdateComponent message={loading.message} />}
      <webview
        key={store}
        ref={webviewRef}
        className="WebView__webview"
        partition={`persist:${startUrl === epicLoginUrl ? 'epicstore' : store}`}
        src={startUrl}
        allowpopups={trueAsStr}
        preload={webviewPreloadPath}
      />
      {showLoginWarningFor && (
        <LoginWarning
          warnLoginForStore={showLoginWarningFor}
          onClose={onLoginWarningClosed}
        />
      )}
    </div>
  )
}
