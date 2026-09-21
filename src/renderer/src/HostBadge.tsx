import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesktopHostStatus } from '../../shared/desktop-spike'
import type { Copy } from './i18n'
import { unknownError } from './ui-utils'

export function HostBadge({ copy }: { copy: Copy }): React.JSX.Element {
  const [status, setStatus] = useState<DesktopHostStatus>()
  const [error, setError] = useState<string>()
  const requested = useRef(false)

  const read = useCallback(async (retry = false): Promise<void> => {
    try {
      setStatus(retry
        ? await window.quietDeskDesktopSpike.retryHost()
        : await window.quietDeskDesktopSpike.getStatus())
      setError(undefined)
    } catch (reason) {
      setError(unknownError(reason))
    }
  }, [])

  useEffect(() => {
    if (requested.current) return
    requested.current = true
    void read()
  }, [read])

  const label = status?.mode === 'desktop'
    ? copy.desktopHost
    : status
      ? copy.fallbackHost
      : copy.hostChecking

  return (
    <button
      type="button"
      className={`host-badge host-badge-${status?.mode ?? 'loading'} no-drag`}
      data-testid="host-mode"
      data-mode={status?.mode ?? 'loading'}
      title={error ?? status?.reason ?? label}
      aria-label={`${label}. ${error ?? status?.reason ?? ''}`}
      onClick={() => void read(true)}
    >
      <span aria-hidden="true" />
      {label}
    </button>
  )
}
