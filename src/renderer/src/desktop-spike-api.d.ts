import type { DesktopSpikeApi } from '../../shared/desktop-spike'

declare global {
  interface Window {
    quietDeskDesktopSpike: DesktopSpikeApi
  }
}

export {}
