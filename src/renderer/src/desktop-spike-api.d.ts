import type { DesktopSpikeApi } from '../../shared/desktop-spike'
import type { QuietDeskApi } from '../../shared/ipc-contract'

declare global {
  interface Window {
    quietDesk: QuietDeskApi
    quietDeskDesktopSpike: DesktopSpikeApi
  }
}

export {}
