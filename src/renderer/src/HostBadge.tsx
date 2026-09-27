import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesktopHostStatus } from '../../shared/desktop-spike'
import type { Copy } from './i18n'
import { unknownError } from './ui-utils'

export function HostBadge({ copy }: { copy: Copy }): React.JSX.Element {
  const [status, setStatus] = useState<DesktopHostStatus>()
  const [error, setError] = useState<string>()
  const generation = useRef(0)
  const active = useRef(true)

  const read = useCallback(async (retry = false): Promise<void> => {
    const requestGeneration = ++generation.current
    try {
      const next = retry
        ? await window.quietDeskDesktopSpike.retryHost()
        : await window.quietDeskDesktopSpike.getStatus()
      if (!active.current || requestGeneration !== generation.current) return
      setStatus(next)
      setError(undefined)
    } catch (reason) {
      if (!active.current || requestGeneration !== generation.current) return
      setError(unknownError(reason))
    }
  }, [])

  useEffect(() => {
    active.current = true
    void read()
    const timer = window.setInterval(() => { void read() }, 10_000)
    return () => {
      active.current = false
      generation.current += 1
      window.clearInterval(timer)
    }
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
