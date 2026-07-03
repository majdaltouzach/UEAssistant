import { Runner } from 'common/types'
import EpicLogo from 'frontend/assets/epic-logo.svg?react'

type Props = { runner: Runner; className?: string }

export default function StoreLogos({ className = 'store-icon' }: Props) {
  return <EpicLogo className={className} />
}
