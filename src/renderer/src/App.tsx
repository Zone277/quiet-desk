import { useCallback, useEffect, useRef, useState } from 'react'
import type { BootstrapSnapshot, ChangeEvent, WindowKind } from '../../shared/ipc-contract'
import { AppearanceControls } from './AppearanceControls'
import { CaptureView } from './CaptureView'
import { HostBadge } from './HostBadge'
import { copyFor } from './i18n'
import { LibraryView } from './LibraryView'
import { ipcError, newRequestId, unknownError } from './ui-utils'
import { WidgetView } from './WidgetView'

type BootstrapState =
  | { phase: 'loading' }
  | { phase: 'ready'; snapshot: BootstrapSnapshot }
  | { phase: 'error'; message: string }

interface AppProps {
  windowKind: WindowKind
}

export function App({ windowKind }: AppProps): React.JSX.Element {
  const [state, setState] = useState<BootstrapState>({ phase: 'loading' })
  const generation = useRef(0)
  const active = useRef(true)

  const refreshBootstrap = useCallback(async (): Promise<void> => {
    const requestGeneration = ++generation.current
    try {
      const result = await window.quietDesk.app.bootstrap({
        requestId: newRequestId(),
        payload: { windowKind }
      })
      if (!active.current || requestGeneration !== generation.current) return
      if (!result.ok) {
        setState({ phase: 'error', message: ipcError(result) })
        return
      }
      if (result.value.windowKind !== windowKind) {
        setState({ phase: 'error', message: copyFor(result.value.locale).wrongWindow })
        return
      }
      setState({ phase: 'ready', snapshot: result.value })
    } catch (reason) {
      if (active.current && requestGeneration === generation.current) {
        setState({ phase: 'error', message: unknownError(reason) })
      }
    }
  }, [windowKind])

  useEffect(() => {
    active.current = true
    const unsubscribe = window.quietDesk.changes.subscribe((event: ChangeEvent) => {
      if (event.topics.includes('settings')) void refreshBootstrap()
    })
    void refreshBootstrap()
    return () => {
      active.current = false
      generation.current += 1
      unsubscribe()
    }
  }, [refreshBootstrap])

  useEffect(() => {
    if (state.phase !== 'ready') return
    document.documentElement.lang = state.snapshot.locale
    document.documentElement.dataset.theme = state.snapshot.resolvedTheme
    document.documentElement.dataset.themePreference = state.snapshot.theme
  }, [state])

  if (state.phase === 'loading') {
    return (
      <main className="app-shell centered-shell" data-window-kind={windowKind} data-testid="window-root">
        <section className="loading-state" data-testid="bootstrap-state" data-state="loading" aria-live="polite">
          <span className="loading-orb" aria-hidden="true" />
          <p>QuietDesk</p>
        </section>
      </main>
    )
  }

  if (state.phase === 'error') {
    const errorCopy = copyFor((document.documentElement.dataset.themePreference ? document.documentElement.lang : navigator.language).toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US')
    return (
      <main className="app-shell centered-shell" data-window-kind={windowKind} data-testid="window-root">
        <section className="error-state no-drag" data-testid="bootstrap-state" data-state="error" aria-live="polite">
          <p className="eyebrow">QuietDesk</p>
          <h1 data-testid="window-title">{errorCopy.startupError}</h1>
          <p data-testid="global-error">{state.message}</p>
          <button type="button" onClick={() => void refreshBootstrap()}>{errorCopy.retry}</button>
        </section>
      </main>
    )
  }

  const bootstrap = state.snapshot
  const copy = copyFor(bootstrap.locale)
  const title = windowKind === 'widget' ? copy.widget : windowKind === 'capture' ? copy.capture : copy.library

  return (
    <main
      className={`app-shell app-shell-${windowKind}`}
      data-window-kind={windowKind}
      data-testid="window-root"
    >
      <header className="window-header drag-region">
        <div className="brand-block">
          <p className="eyebrow">{copy.appName}</p>
          <h1 data-testid="window-title">{title}</h1>
          {windowKind === 'widget' ? <HostBadge copy={copy} /> : null}
        </div>
        <div className="header-tools no-drag">
          <AppearanceControls bootstrap={bootstrap} copy={copy} onUpdated={refreshBootstrap} />
        </div>
      </header>

      <div
        className="window-content no-drag"
        data-testid="bootstrap-state"
        data-state="ready"
        data-revision={bootstrap.dataRevision}
      >
        {windowKind === 'widget' && bootstrap.captureShortcut.failure !== null
          ? (
              <p className="inline-error shortcut-message" data-testid="shortcut-conflict" role="alert">
                <span className="shortcut-brief">{copy.shortcutNotRegistered} · {copy.openCapture}</span>
                <span className="shortcut-detail">
                {bootstrap.captureShortcut.failure === 'conflict'
                  ? copy.shortcutConflict
                  : bootstrap.captureShortcut.failure === 'invalid'
                    ? copy.shortcutInvalid
                    : copy.shortcutUnavailable}
                </span>
              </p>
            )
          : null}
        {windowKind === 'widget'
          ? <WidgetView bootstrap={bootstrap} copy={copy} />
          : windowKind === 'capture'
            ? <CaptureView bootstrap={bootstrap} copy={copy} />
            : <LibraryView bootstrap={bootstrap} copy={copy} />}
      </div>
    </main>
  )
}
