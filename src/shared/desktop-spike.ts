export const DESKTOP_SPIKE_CHANNELS = {
  getStatus: 'desktop-spike:get-status',
  retryHost: 'desktop-spike:retry-host'
} as const

export interface RectangleSnapshot {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplaySnapshot {
  id: string
  scaleFactor: number
  bounds: RectangleSnapshot
  workArea: RectangleSnapshot
}

export interface NativeHostSnapshot {
  bridge: 'python-ctypes' | 'win32-helper' | 'none'
  operation: 'attach' | 'inspect' | 'fallback'
  success: boolean
  route?: string
  targetHandle?: string
  targetClass?: string
  parentHandle?: string
  parentClass?: string
  styleHex?: string
  exStyleHex?: string
  error?: string
}

export type DesktopHostMode = 'desktop' | 'fallback'

export interface DesktopHostStatus {
  mode: DesktopHostMode
  attached: boolean
  reason: string
  updatedAt: string
  platform: NodeJS.Platform
  osRelease: string
  windowsBuild?: string
  nativeHandle: string
  windowBounds: RectangleSnapshot
  contentBounds: RectangleSnapshot
  display: DisplaySnapshot
  windowOptions: {
    alwaysOnTop: boolean
    skipTaskbar: boolean
    focusable: boolean
    resizable: boolean
    transparent: boolean
  }
  visible: boolean
  focused: boolean
  statePath: string
  recovery: {
    attempts: number
    lastTrigger?: string
    lastResult?: string
  }
  native: NativeHostSnapshot
}

export interface DesktopSpikeApi {
  getStatus(): Promise<DesktopHostStatus>
  retryHost(): Promise<DesktopHostStatus>
}
