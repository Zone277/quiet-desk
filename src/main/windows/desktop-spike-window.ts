import { BrowserWindow, powerMonitor, screen, type Display, type Rectangle } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { release } from 'node:os'
import type {
  DesktopHostStatus,
  DisplaySnapshot,
  NativeHostSnapshot,
  RectangleSnapshot
} from '../../shared/desktop-spike'
import { createDesktopHostAdapter, type DesktopHostAdapter } from '../platform/desktop-host'

const DEFAULT_WIDTH = 480
const DEFAULT_HEIGHT = 420
const MIN_WIDTH = 320
const MIN_HEIGHT = 240
const SAVE_DEBOUNCE_MS = 250
const HOST_HEALTH_INTERVAL_MS = 10_000

interface StoredWindowState {
  version: 1
  bounds: RectangleSnapshot
  displayId: string
  scaleFactor: number
}

export interface DesktopSpikeWindowOptions {
  preloadPath: string
  rendererUrl?: string
  rendererFile: string
  statePath: string
  forceFallback: boolean
}

export interface DesktopSpikeController {
  window: BrowserWindow
  getStatus(): DesktopHostStatus
  retryHost(trigger: string): Promise<DesktopHostStatus>
  dispose(): Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseStoredState(value: unknown): StoredWindowState | undefined {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.bounds)) {
    return undefined
  }

  const { x, y, width, height } = value.bounds
  if (
    !isFiniteNumber(x) || !isFiniteNumber(y) ||
    !isFiniteNumber(width) || !isFiniteNumber(height)
  ) {
    return undefined
  }
  if (typeof value.displayId !== 'string' || !isFiniteNumber(value.scaleFactor)) {
    return undefined
  }

  return {
    version: 1,
    bounds: {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height)
    },
    displayId: value.displayId,
    scaleFactor: value.scaleFactor
  }
}

async function loadStoredState(statePath: string): Promise<StoredWindowState | undefined> {
  try {
    const contents = await readFile(statePath, 'utf8')
    return parseStoredState(JSON.parse(contents) as unknown)
  } catch (error) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined
    if (code !== 'ENOENT') {
      console.warn('QUIETDESK_WINDOW_STATE_READ_ERROR', error)
    }
    return undefined
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function clampBoundsToWorkArea(bounds: RectangleSnapshot, workArea: Rectangle): RectangleSnapshot {
  const width = clamp(Math.round(bounds.width), Math.min(MIN_WIDTH, workArea.width), workArea.width)
  const height = clamp(Math.round(bounds.height), Math.min(MIN_HEIGHT, workArea.height), workArea.height)
  const maxX = workArea.x + workArea.width - width
  const maxY = workArea.y + workArea.height - height

  return {
    x: clamp(Math.round(bounds.x), workArea.x, maxX),
    y: clamp(Math.round(bounds.y), workArea.y, maxY),
    width,
    height
  }
}

function displayForStoredState(state: StoredWindowState): Display {
  const savedDisplay = screen.getAllDisplays().find((display) => String(display.id) === state.displayId)
  return savedDisplay ?? screen.getDisplayMatching(state.bounds)
}

function displaySnapshot(display: Display): DisplaySnapshot {
  return {
    id: String(display.id),
    scaleFactor: display.scaleFactor,
    bounds: { ...display.bounds },
    workArea: { ...display.workArea }
  }
}

function readNativeHandle(window: BrowserWindow): string {
  const bytes = window.getNativeWindowHandle()
  if (bytes.length >= 8) {
    return bytes.readBigUInt64LE(0).toString(10)
  }
  if (bytes.length >= 4) {
    return String(bytes.readUInt32LE(0))
  }
  throw new Error(`Unsupported native window handle width: ${bytes.length}`)
}

function fallbackNativeSnapshot(error: unknown): NativeHostSnapshot {
  return {
    bridge: 'none',
    operation: 'fallback',
    success: false,
    error: error instanceof Error ? error.message : String(error)
  }
}

function statusReason(snapshot: NativeHostSnapshot): string {
  if (snapshot.success) {
    return `Attached through ${snapshot.route ?? 'an inspected Windows Shell host'}`
  }
  return snapshot.error ?? 'Windows desktop host validation failed'
}

async function persistWindowState(statePath: string, state: StoredWindowState): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true })
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, statePath)
}

export class DesktopSpikeWindowController implements DesktopSpikeController {
  readonly window: BrowserWindow

  private nativeSnapshot: NativeHostSnapshot = {
    bridge: 'none',
    operation: 'fallback',
    success: false,
    error: 'Desktop host has not been attempted yet'
  }
  private recoveryAttempts = 0
  private lastRecoveryTrigger: string | undefined
  private lastRecoveryResult: string | undefined
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private healthTimer: ReturnType<typeof setInterval> | undefined
  private retryPromise: Promise<DesktopHostStatus> | undefined
  private healthPromise: Promise<void> | undefined
  private savePromise: Promise<void> = Promise.resolve()
  private disposePromise: Promise<void> | undefined
  private disposed = false

  private readonly onResume = (): void => {
    if (!this.disposed && !this.window.isDestroyed()) {
      void this.retryHost('resume').catch((error: unknown) => console.warn('QUIETDESK_HOST_RESUME_ERROR', error))
    }
  }

  private readonly handle: string
  private readonly onMoveOrResize = (): void => this.scheduleStateSave()
  private readonly onDisplayTopologyChange = (): void => {
    if (this.disposed || this.window.isDestroyed()) return
    this.ensureWindowIsVisible()
    this.scheduleStateSave()
    void this.retryHost('display-topology-change').catch((error: unknown) => console.warn('QUIETDESK_HOST_DISPLAY_ERROR', error))
  }
  private readonly onDisplayMetricsChanged = (
    _event: Electron.Event,
    _display: Display,
    changedMetrics: string[]
  ): void => {
    if (this.disposed || this.window.isDestroyed()) return
    if (changedMetrics.some((metric) => metric === 'bounds' || metric === 'workArea' || metric === 'scaleFactor')) {
      this.ensureWindowIsVisible()
      this.scheduleStateSave()
      void this.retryHost(`display-metrics:${changedMetrics.join(',')}`)
        .catch((error: unknown) => console.warn('QUIETDESK_HOST_DISPLAY_ERROR', error))
    }
  }

  constructor(
    window: BrowserWindow,
    private readonly adapter: DesktopHostAdapter,
    private readonly statePath: string,
    private readonly initialSize: { width: number; height: number } = { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
  ) {
    this.window = window
    this.handle = readNativeHandle(window)

    window.on('move', this.onMoveOrResize)
    window.on('resize', this.onMoveOrResize)
    screen.on('display-added', this.onDisplayTopologyChange)
    screen.on('display-removed', this.onDisplayTopologyChange)
    screen.on('display-metrics-changed', this.onDisplayMetricsChanged)
    powerMonitor.on('resume', this.onResume)
  }

  async initialize(): Promise<void> {
    const desired = { ...this.window.getBounds(), ...this.initialSize }
    await this.restoreExactBounds(desired)
    await this.retryHost('startup')
    this.window.showInactive()
    await this.restoreExactBounds(desired)
    await this.saveStateNow()
    this.emitStatus()

    if (this.adapter.kind !== 'fallback') {
      this.healthTimer = setInterval(() => {
        if (this.healthPromise || this.retryPromise || this.disposed) return
        this.healthPromise = this.checkHostHealth()
          .catch((error: unknown) => console.warn('QUIETDESK_HOST_HEALTH_ERROR', error))
          .finally(() => { this.healthPromise = undefined })
      }, HOST_HEALTH_INTERVAL_MS)
    }
  }

  getStatus(): DesktopHostStatus {
    const bounds = this.window.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const attached = this.nativeSnapshot.success &&
      (this.nativeSnapshot.parentClass === 'WorkerW' || this.nativeSnapshot.parentClass === 'Progman')

    return {
      mode: attached ? 'desktop' : 'fallback',
      attached,
      reason: statusReason(this.nativeSnapshot),
      updatedAt: new Date().toISOString(),
      platform: process.platform,
      osRelease: release(),
      windowsBuild: process.platform === 'win32' ? release().split('.').at(-1) : undefined,
      nativeHandle: this.handle,
      windowBounds: { ...bounds },
      contentBounds: { ...this.window.getContentBounds() },
      display: displaySnapshot(display),
      windowOptions: {
        alwaysOnTop: this.window.isAlwaysOnTop(),
        skipTaskbar: true,
        focusable: this.window.isFocusable(),
        resizable: this.window.isResizable(),
        transparent: false
      },
      visible: this.window.isVisible(),
      focused: this.window.isFocused(),
      statePath: this.statePath,
      recovery: {
        attempts: this.recoveryAttempts,
        lastTrigger: this.lastRecoveryTrigger,
        lastResult: this.lastRecoveryResult
      },
      native: { ...this.nativeSnapshot }
    }
  }

  async retryHost(trigger: string): Promise<DesktopHostStatus> {
    if (this.disposed || this.window.isDestroyed()) {
      throw new Error('Desktop controller is disposed or its window is destroyed')
    }
    if (this.retryPromise) {
      return await this.retryPromise
    }

    this.retryPromise = this.performHostRetry(trigger)
    try {
      return await this.retryPromise
    } finally {
      this.retryPromise = undefined
    }
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.disposed = true

    this.disposePromise = this.finishDispose()
    return this.disposePromise
  }

  private async finishDispose(): Promise<void> {

    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = undefined
    }
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = undefined
    }

    screen.off('display-added', this.onDisplayTopologyChange)
    screen.off('display-removed', this.onDisplayTopologyChange)
    screen.off('display-metrics-changed', this.onDisplayMetricsChanged)
    powerMonitor.off('resume', this.onResume)
    this.window.off('move', this.onMoveOrResize)
    this.window.off('resize', this.onMoveOrResize)

    // Drain attach/inspect before detach so a late helper cannot reparent during quit.
    await this.retryPromise?.catch(() => undefined)
    await this.healthPromise?.catch(() => undefined)

    if (!this.window.isDestroyed()) {
      await this.saveStateNow()
      await this.adapter.detach(this.handle)
    }
  }

  private async performHostRetry(trigger: string): Promise<DesktopHostStatus> {
    const desiredBounds = this.window.getBounds()
    this.recoveryAttempts += 1
    this.lastRecoveryTrigger = trigger

    try {
      this.nativeSnapshot = await this.adapter.attach(this.handle)
    } catch (error) {
      this.nativeSnapshot = fallbackNativeSnapshot(error)
    }

    if (this.disposed || this.window.isDestroyed()) {
      // dispose drains this operation before detaching; do not touch a dead HWND.
      throw new Error('Desktop recovery interrupted by disposal')
    }

    // FRAMECHANGED and SetParent can change Chromium's outer-frame accounting.
    // Keep the actual DIP outer bounds, including non-preset restored sizes.
    await this.restoreExactBounds(desiredBounds)
    if (this.disposed || this.window.isDestroyed()) throw new Error('Desktop recovery interrupted by disposal')

    this.lastRecoveryResult = this.nativeSnapshot.success ? 'attached' : 'fallback'
    this.emitStatus()
    return this.getStatus()
  }

  private async checkHostHealth(): Promise<void> {
    if (this.disposed || this.window.isDestroyed()) {
      return
    }

    try {
      const inspection = await this.adapter.inspect(this.handle)
      if (this.disposed || this.window.isDestroyed()) return
      if (inspection.success) {
        this.nativeSnapshot = inspection
        return
      }
      this.nativeSnapshot = inspection
    } catch (error) {
      if (this.disposed || this.window.isDestroyed()) return
      this.nativeSnapshot = fallbackNativeSnapshot(error)
    }

    this.emitStatus()
    await this.retryHost('host-health-check')
  }

  private ensureWindowIsVisible(): void {
    if (this.disposed || this.window.isDestroyed()) {
      return
    }
    const current = this.window.getBounds()
    const display = screen.getDisplayMatching(current)
    const safe = clampBoundsToWorkArea(current, display.workArea)
    if (
      current.x !== safe.x || current.y !== safe.y ||
      current.width !== safe.width || current.height !== safe.height
    ) {
      this.window.setBounds(safe, false)
    }
  }

  private scheduleStateSave(): void {
    if (this.disposed || this.window.isDestroyed()) {
      return
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      void this.saveStateNow()
    }, SAVE_DEBOUNCE_MS)
  }

  private async saveStateNow(): Promise<void> {
    if (this.window.isDestroyed()) {
      return
    }
    const bounds = this.window.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const state: StoredWindowState = {
      version: 1,
      bounds: { ...bounds },
      displayId: String(display.id),
      scaleFactor: display.scaleFactor
    }

    // Serialize atomic replacements: an older debounced write cannot win over quit.
    this.savePromise = this.savePromise.then(async () => {
      try {
        await persistWindowState(this.statePath, state)
      } catch (error) {
        console.warn('QUIETDESK_WINDOW_STATE_WRITE_ERROR', error)
      }
    })
    await this.savePromise
  }

  private async restoreExactBounds(desired: Rectangle): Promise<void> {
    let requested = { ...desired }
    let canAdjust = this.adapter.adjustSize !== undefined
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (this.disposed || this.window.isDestroyed()) return
      this.window.setBounds(requested, false)
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 0))
      if (this.disposed || this.window.isDestroyed()) return
      const actual = this.window.getBounds()
      if (actual.x === desired.x && actual.y === desired.y &&
          actual.width === desired.width && actual.height === desired.height) return
      if (canAdjust && this.adapter.adjustSize) {
        const scale = screen.getDisplayMatching(actual).scaleFactor
        try {
          await this.adapter.adjustSize(this.handle,
            Math.round((desired.width - actual.width) * scale),
            Math.round((desired.height - actual.height) * scale))
        } catch (error) {
          canAdjust = false
          console.warn('QUIETDESK_WINDOW_GEOMETRY_HELPER_ERROR', error)
        }
        if (this.disposed || this.window.isDestroyed()) return
        const corrected = this.window.getBounds()
        if (corrected.x === desired.x && corrected.y === desired.y &&
            corrected.width === desired.width && corrected.height === desired.height) return
      }
      requested = {
        x: requested.x + desired.x - actual.x,
        y: requested.y + desired.y - actual.y,
        width: requested.width + desired.width - actual.width,
        height: requested.height + desired.height - actual.height
      }
    }
    console.warn('QUIETDESK_WINDOW_GEOMETRY_MISMATCH', { desired, actual: this.window.getBounds() })
  }

  private emitStatus(): void {
    if (this.disposed || this.window.isDestroyed()) return
    console.info(`QUIETDESK_DESKTOP_STATUS ${JSON.stringify(this.getStatus())}`)
  }
}

export async function createDesktopSpikeWindow(
  options: DesktopSpikeWindowOptions
): Promise<DesktopSpikeController> {
  const storedState = await loadStoredState(options.statePath)
  const initialBounds = storedState
    ? clampBoundsToWorkArea(storedState.bounds, displayForStoredState(storedState).workArea)
    : undefined

  const window = new BrowserWindow({
    width: initialBounds?.width ?? DEFAULT_WIDTH,
    height: initialBounds?.height ?? DEFAULT_HEIGHT,
    x: initialBounds?.x,
    y: initialBounds?.y,
    center: initialBounds === undefined,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    backgroundColor: '#f1eee8',
    transparent: false,
    resizable: true,
    movable: true,
    focusable: true,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  window.setSkipTaskbar(true)
  window.setAlwaysOnTop(false)

  const readyToShow = new Promise<void>((resolvePromise) => {
    window.once('ready-to-show', () => resolvePromise())
  })

  if (options.rendererUrl) {
    await window.loadURL(options.rendererUrl)
  } else {
    await window.loadFile(options.rendererFile)
  }
  await readyToShow

  // Electron's constructor can add DPI-dependent non-client insets. Apply the
  // intended outer size after renderer readiness, before the native attach reads it.
  window.setBounds({ ...window.getBounds(),
    width: initialBounds?.width ?? DEFAULT_WIDTH,
    height: initialBounds?.height ?? DEFAULT_HEIGHT
  }, false)

  const controller = new DesktopSpikeWindowController(
    window,
    createDesktopHostAdapter({ forceFallback: options.forceFallback }),
    options.statePath,
    { width: initialBounds?.width ?? DEFAULT_WIDTH, height: initialBounds?.height ?? DEFAULT_HEIGHT }
  )
  await controller.initialize()
  return controller
}
