import { useState } from 'react'
import type { BootstrapSnapshot, Locale, Theme } from '../../shared/ipc-contract'
import type { Copy } from './i18n'
import { ipcError, newRequestId, unknownError } from './ui-utils'

interface AppearanceControlsProps {
  bootstrap: BootstrapSnapshot
  copy: Copy
  onUpdated: () => Promise<void>
}

export function AppearanceControls({ bootstrap, copy, onUpdated }: AppearanceControlsProps): React.JSX.Element {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  const update = async (change: { locale?: Locale; theme?: Theme }): Promise<void> => {
    setPending(true)
    setError(undefined)
    try {
      const result = await window.quietDesk.settings.updateAppearance({
        requestId: newRequestId(),
        idempotencyKey: newRequestId(),
        payload: change
      })
      if (!result.ok) {
        setError(ipcError(result))
        return
      }
      await onUpdated()
    } catch (reason) {
      setError(unknownError(reason))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="appearance-controls no-drag" aria-label={`${copy.language} / ${copy.theme}`}>
      <label className="select-control compact-control">
        <span>{copy.language}</span>
        <select
          data-testid="appearance-locale"
          value={bootstrap.locale}
          disabled={pending}
          onChange={(event) => void update({ locale: event.target.value as Locale })}
        >
          <option value="zh-CN">中文</option>
          <option value="en-US">EN</option>
        </select>
      </label>
      <label className="select-control compact-control">
        <span>{copy.theme}</span>
        <select
          data-testid="appearance-theme"
          value={bootstrap.theme}
          disabled={pending}
          onChange={(event) => void update({ theme: event.target.value as Theme })}
        >
          <option value="system">{copy.system}</option>
          <option value="light">{copy.light}</option>
          <option value="dark">{copy.dark}</option>
        </select>
      </label>
      {error ? <span className="control-error" role="status">{copy.appearanceError}: {error}</span> : null}
    </div>
  )
}
