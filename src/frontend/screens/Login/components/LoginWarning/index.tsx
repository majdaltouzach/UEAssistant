import './index.scss'
import {
  Dialog,
  DialogContent,
  DialogHeader
} from 'frontend/components/UI/Dialog'
import { useTranslation } from 'react-i18next'
import { epicLoginPath } from '../..'
import { NavLink } from 'react-router-dom'

interface LoginWarningProps {
  warnLoginForStore: null | 'epic'
  onClose: () => void
}

const LoginWarning = function ({
  warnLoginForStore,
  onClose
}: LoginWarningProps) {
  const { t } = useTranslation('gamepage')

  if (!warnLoginForStore) {
    return null
  }

  const textContent = t(
    'not_logged_in.epic',
    "You are not logged in with an Epic account. Don't use the store page to login, click the following button instead:"
  )
  const loginPath = epicLoginPath

  return (
    <Dialog onClose={onClose} className="notLoggedIn" showCloseButton={true}>
      <DialogHeader onClose={onClose}>
        {t('not_logged_in.title', 'You are NOT logged in')}
      </DialogHeader>
      <DialogContent>
        <p>{textContent}</p>
        <NavLink className="button" to={loginPath} onClick={onClose}>
          <span>{t('not_logged_in.login', 'Log in')}</span>
        </NavLink>
      </DialogContent>
    </Dialog>
  )
}

export default LoginWarning
