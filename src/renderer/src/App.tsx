import { useCallback, useEffect, useState } from 'react'
import type { DesktopHostStatus } from '../../shared/desktop-spike'

export function App(): React.JSX.Element {
  const [status, setStatus] = useState<DesktopHostStatus>()
  const [error, setError] = useState<string>()
  const [clicks, setClicks] = useState(0)

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.quietDeskDesktopSpike.getStatus())
      setError(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 1500)
    return () => window.clearInterval(timer)
  }, [refresh])

  const retry = async (): Promise<void> => {
    try {
      setStatus(await window.quietDeskDesktopSpike.retryHost())
      setError(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const mode = status?.mode ?? 'fallback'

  return (
    <main className={`spike-shell mode-${mode}`}>
      <header className="drag-region">
        <div>
          <p className="eyebrow">QuietDesk · Windows host spike</p>
          <h1>{mode === 'desktop' ? 'DESKTOP ATTACHED' : 'DEVELOPMENT FALLBACK'}</h1>
        </div>
        <span className="mode-dot" aria-label={`host mode ${mode}`} />
      </header>

      <section className="status-card no-drag" aria-live="polite">
        <p>{status?.reason ?? 'Waiting for host diagnostics…'}</p>
        {error ? <p className="error">{error}</p> : null}
        <dl>
          <div><dt>Parent</dt><dd>{status?.native.parentClass ?? 'unknown'}</dd></div>
          <div><dt>Route</dt><dd>{status?.native.route ?? 'none'}</dd></div>
          <div><dt>Bounds</dt><dd>{status ? `${status.windowBounds.width}×${status.windowBounds.height} @ ${status.windowBounds.x},${status.windowBounds.y}` : '—'}</dd></div>
          <div><dt>Content</dt><dd>{status ? `${status.contentBounds.width}×${status.contentBounds.height} DIP` : '—'}</dd></div>
          <div><dt>DPI scale</dt><dd>{status?.display.scaleFactor ?? '—'}</dd></div>
          <div><dt>Focused</dt><dd>{String(status?.focused ?? false)}</dd></div>
          <div><dt>Transparent</dt><dd>{String(status?.windowOptions.transparent ?? false)}</dd></div>
        </dl>
      </section>

      <section className="interaction-card no-drag">
        <p>This content must remain clickable while the header remains draggable.</p>
        <div className="actions">
          <button id="interaction-target" type="button" onClick={() => setClicks((value) => value + 1)}>
            Interaction count: {clicks}
          </button>
          <button id="retry-host" type="button" className="secondary" onClick={() => void retry()}>
            Retry desktop host
          </button>
        </div>
      </section>

      <footer className="no-drag">
        Non-public Shell route · opaque and continuously resizable · state: {status?.statePath ?? 'loading'}
      </footer>
    </main>
  )
}
