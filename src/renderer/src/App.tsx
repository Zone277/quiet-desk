import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesktopHostStatus } from '../../shared/desktop-spike'
import type {
  BootstrapSnapshot,
  ChangeEvent,
  WindowKind
} from '../../shared/ipc-contract'

type BootstrapState =
  | { phase: 'loading' }
  | { phase: 'ready'; snapshot: BootstrapSnapshot }
  | { phase: 'error'; message: string }

interface AppProps {
  windowKind: WindowKind
}

const WINDOW_COPY: Record<WindowKind, { eyebrow: string; title: string; description: string }> = {
  widget: {
    eyebrow: 'QuietDesk · Early preview',
    title: 'Widget',
    description: 'Desktop status and local data diagnostics.'
  },
  capture: {
    eyebrow: 'QuietDesk · Early preview',
    title: 'Capture',
    description: 'Quick Capture will be available in a future version.'
  },
  library: {
    eyebrow: 'QuietDesk · Early preview',
    title: 'Library',
    description: 'Library browsing and editing will be available in a future version.'
  }
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function useBootstrap(windowKind: WindowKind): BootstrapState {
  const [state, setState] = useState<BootstrapState>({ phase: 'loading' })
  const latestRevision = useRef(-1)
  const latestEventSequence = useRef(0)
  const requestGeneration = useRef(0)

  useEffect(() => {
    let active = true

    const refresh = async (): Promise<void> => {
      const generation = ++requestGeneration.current
      try {
        const result = await window.quietDesk.app.bootstrap({
          requestId: crypto.randomUUID(),
          payload: { windowKind }
        })
        if (!active || generation !== requestGeneration.current) return

        if (!result.ok) {
          setState({
            phase: 'error',
            message: `${result.error.code}: ${result.error.message}`
          })
          return
        }
        if (result.value.windowKind !== windowKind) {
          setState({ phase: 'error', message: 'Bootstrap returned the wrong window identity.' })
          return
        }

        latestRevision.current = result.value.dataRevision
        setState({ phase: 'ready', snapshot: result.value })
      } catch (reason) {
        if (active && generation === requestGeneration.current) {
          setState({ phase: 'error', message: errorMessage(reason) })
        }
      }
    }

    const onChange = (event: ChangeEvent): void => {
      if (event.sequence <= latestEventSequence.current) return
      latestEventSequence.current = event.sequence
      if (event.sequence > latestRevision.current) {
        void refresh()
      }
    }

    const unsubscribe = window.quietDesk.changes.subscribe(onChange)
    void refresh()

    return () => {
      active = false
      requestGeneration.current += 1
      unsubscribe()
    }
  }, [windowKind])

  return state
}

function BootstrapPanel({ state }: { state: BootstrapState }): React.JSX.Element {
  if (state.phase === 'loading') {
    return (
      <section className="panel bootstrap-panel" data-testid="bootstrap-state" data-state="loading" aria-live="polite">
        <p className="status-label">QuietDesk</p>
        <p>Loading local application state…</p>
      </section>
    )
  }

  if (state.phase === 'error') {
    return (
      <section className="panel bootstrap-panel error-panel" data-testid="bootstrap-state" data-state="error" aria-live="polite">
        <p className="status-label">Startup error</p>
        <p>{state.message}</p>
      </section>
    )
  }

  const { snapshot } = state
  return (
    <section
      className="panel bootstrap-panel"
      data-testid="bootstrap-state"
      data-state="ready"
      data-revision={snapshot.dataRevision}
      aria-live="polite"
    >
      <div className="panel-heading">
        <div>
          <p className="status-label">Local data ready</p>
          <h2>Revision {snapshot.dataRevision}</h2>
        </div>
        <span className="status-chip">Local</span>
      </div>
      <dl className="runtime-grid">
        <div><dt>Window</dt><dd>{snapshot.windowKind}</dd></div>
        <div><dt>Locale</dt><dd>{snapshot.locale}</dd></div>
        <div><dt>Theme</dt><dd>{snapshot.theme}</dd></div>
        <div><dt>Date</dt><dd>{snapshot.currentDate}</dd></div>
        <div className="wide"><dt>Application time zone</dt><dd>{snapshot.appTimeZone}</dd></div>
      </dl>
      <p className="capability-note">
        Available: {snapshot.implementedCapabilities.join(', ') || 'none'}
      </p>
    </section>
  )
}

function AvailabilityNotice({ windowKind }: { windowKind: Exclude<WindowKind, 'widget'> }): React.JSX.Element {
  const deferred = windowKind === 'capture'
    ? ['draft autosave', 'IME-safe submission', 'Markdown preview']
    : ['date browsing', 'Daily Log', 'trash and export']

  return (
    <section className="panel shell-notice no-drag" aria-labelledby="shell-notice-title">
      <p className="status-label">Early preview</p>
      <h2 id="shell-notice-title">Coming soon</h2>
      <p>This feature is not available in the current version.</p>
      <ul>
        {deferred.map((item) => <li key={item}>{item}: coming soon</li>)}
      </ul>
    </section>
  )
}

function WidgetContent(): React.JSX.Element {
  const [status, setStatus] = useState<DesktopHostStatus>()
  const [hostError, setHostError] = useState<string>()
  const [clicks, setClicks] = useState(0)
  const hasReadInitialStatus = useRef(false)

  const readStatus = useCallback(async () => {
    try {
      setStatus(await window.quietDeskDesktopSpike.getStatus())
      setHostError(undefined)
    } catch (reason) {
      setHostError(errorMessage(reason))
    }
  }, [])

  useEffect(() => {
    if (hasReadInitialStatus.current) return
    hasReadInitialStatus.current = true
    void readStatus()
  }, [readStatus])

  const retry = async (): Promise<void> => {
    try {
      setStatus(await window.quietDeskDesktopSpike.retryHost())
      setHostError(undefined)
    } catch (reason) {
      setHostError(errorMessage(reason))
    }
  }

  const mode = status?.mode ?? 'fallback'
  const modeLabel = status
    ? (mode === 'desktop' ? 'DESKTOP ATTACHED' : 'COMPATIBILITY MODE')
    : 'CHECKING DESKTOP HOST'

  return (
    <>
      <section className="panel host-panel no-drag" data-testid="host-mode" data-mode={status?.mode ?? 'loading'} aria-live="polite">
        <div className="panel-heading">
          <div>
            <p className="status-label">DesktopHostAdapter</p>
            <h2>{modeLabel}</h2>
          </div>
          <span className={`mode-dot mode-dot-${mode}`} aria-label={`host mode ${status?.mode ?? 'loading'}`} />
        </div>
        <p>{status?.reason ?? 'Reading host diagnostics once…'}</p>
        {hostError ? <p className="error-text">{hostError}</p> : null}
        <dl className="runtime-grid compact-grid">
          <div><dt>Parent</dt><dd>{status?.native.parentClass ?? 'unknown'}</dd></div>
          <div><dt>Route</dt><dd>{status?.native.route ?? 'none'}</dd></div>
          <div><dt>Bounds</dt><dd>{status ? `${status.windowBounds.width}×${status.windowBounds.height}` : '—'}</dd></div>
          <div><dt>DPI scale</dt><dd>{status?.display.scaleFactor ?? '—'}</dd></div>
        </dl>
      </section>

      <section className="panel interaction-panel no-drag">
        <p>Task and schedule cards will appear here in a future version.</p>
        <div className="actions">
          <button
            id="interaction-target"
            data-testid="interaction-target"
            type="button"
            onClick={() => setClicks((value) => value + 1)}
          >
            Interaction count: {clicks}
          </button>
          <button
            id="retry-host"
            data-testid="retry-host"
            type="button"
            className="secondary"
            onClick={() => void retry()}
          >
            Retry desktop host
          </button>
        </div>
      </section>
    </>
  )
}

export function App({ windowKind }: AppProps): React.JSX.Element {
  const bootstrap = useBootstrap(windowKind)
  const copy = WINDOW_COPY[windowKind]

  return (
    <main className={`app-shell app-shell-${windowKind}`} data-window-kind={windowKind}>
      <header className="window-header drag-region">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1 data-testid="window-title">{copy.title}</h1>
          <p className="window-description">{copy.description}</p>
        </div>
        <span className="window-kind-badge">{windowKind}</span>
      </header>

      <div className="content-stack no-drag">
        <BootstrapPanel state={bootstrap} />
        {windowKind === 'widget' ? <WidgetContent /> : <AvailabilityNotice windowKind={windowKind} />}
      </div>

      <footer className="no-drag">Early preview · local data only</footer>
    </main>
  )
}
