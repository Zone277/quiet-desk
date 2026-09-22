import { useCallback, useEffect, useState } from 'react'
import type { BootstrapSnapshot, CaptureShortcutStatus } from '../../shared/ipc-contract'
import type { Copy } from './i18n'
import { ipcError, newRequestId, unknownError } from './ui-utils'

interface ShortcutSettingsProps {
  bootstrap: BootstrapSnapshot
  copy: Copy
}

function failureMessage(status: CaptureShortcutStatus, copy: Copy): string | undefined {
  if (status.failure === 'conflict') return copy.shortcutConflict
  if (status.failure === 'invalid') return copy.shortcutInvalid
  if (status.failure === 'unavailable' || !status.registered) return copy.shortcutUnavailable
  return undefined
}

export function ShortcutSettings({ bootstrap, copy }: ShortcutSettingsProps): React.JSX.Element {
  const [status, setStatus] = useState<CaptureShortcutStatus>(bootstrap.captureShortcut)
  const [candidate, setCandidate] = useState(bootstrap.captureShortcut.accelerator)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const result = await window.quietDesk.shortcuts.get({ requestId: newRequestId(), payload: {} })
      if (!result.ok) {
        setError(ipcError(result))
        return
      }
      setStatus(result.value)
      setCandidate(result.value.accelerator)
      setError(undefined)
    } catch (reason) {
      setError(unknownError(reason))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const update = async (): Promise<void> => {
    const accelerator = candidate.trim()
    if (!accelerator) {
      setError(copy.shortcutInvalid)
      return
    }
    setPending(true)
    setError(undefined)
    try {
      const result = await window.quietDesk.shortcuts.update({
        requestId: newRequestId(),
        idempotencyKey: newRequestId(),
        payload: { accelerator }
      })
      if (!result.ok) {
        setError(ipcError(result))
        return
      }
      setStatus(result.value)
      if (result.value.registered && result.value.failure === null) setCandidate(result.value.accelerator)
    } catch (reason) {
      setError(unknownError(reason))
    } finally {
      setPending(false)
    }
  }

  const failure = failureMessage(status, copy)

  return (
    <section className="shortcut-settings section-card" aria-labelledby="shortcut-settings-title">
      <div className="shortcut-copy">
        <div className="section-heading">
          <h2 id="shortcut-settings-title">{copy.captureShortcut}</h2>
          <span className={`shortcut-registration ${status.registered ? 'registered' : 'unregistered'}`}>
            {status.registered ? copy.shortcutRegistered : copy.shortcutNotRegistered}
          </span>
        </div>
        <p className="field-hint">{copy.currentShortcut}: <kbd>{status.accelerator}</kbd> · {copy.shortcutHint}</p>
      </div>
      <div className="shortcut-form">
        <label className="field-control shortcut-input">
          <span>{copy.shortcutCandidate}</span>
          <input
            data-testid="shortcut-input"
            value={candidate}
            disabled={pending}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setCandidate(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              void update()
            }}
          />
        </label>
        <button type="button" className="button-secondary" data-testid="shortcut-save" disabled={pending} onClick={() => void update()}>
          {pending ? copy.saving : copy.saveShortcut}
        </button>
      </div>
      {failure ? <p className="inline-error shortcut-message" data-testid="shortcut-conflict" role="alert">{failure}</p> : null}
      {error ? <p className="inline-error shortcut-message" role="alert">{copy.operationFailed}: {error}</p> : null}
    </section>
  )
}
