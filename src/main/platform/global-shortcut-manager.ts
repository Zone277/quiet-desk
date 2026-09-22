import {
  defaultCaptureShortcut,
  shortcutAcceleratorSchema,
  type CaptureShortcutStatus
} from '../../shared/ipc-contract'

export interface GlobalShortcutRegistrar {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export interface GlobalShortcutManagerOptions {
  registrar: GlobalShortcutRegistrar
  persistAccelerator(accelerator: string): void | Promise<void>
  onActivate(): void
  initialAccelerator?: string
}

type ShortcutFailure = CaptureShortcutStatus['failure']

/**
 * Owns the single global shortcut registration used to activate Quick Capture.
 * Persistence is injected so this platform boundary does not access SQLite.
 */
export class GlobalShortcutManager {
  private accelerator: string
  private registered = false
  private failure: ShortcutFailure = null
  private pendingCandidate: string | undefined
  private disposed = false
  private transition: Promise<void> = Promise.resolve()

  private readonly registrar: GlobalShortcutRegistrar
  private readonly persistAccelerator: GlobalShortcutManagerOptions['persistAccelerator']
  private readonly onActivate: GlobalShortcutManagerOptions['onActivate']
  private readonly activationCallback = (): void => {
    if (!this.disposed) this.onActivate()
  }

  constructor(options: GlobalShortcutManagerOptions) {
    this.registrar = options.registrar
    this.persistAccelerator = options.persistAccelerator
    this.onActivate = options.onActivate

    const initial = shortcutAcceleratorSchema.safeParse(
      options.initialAccelerator ?? defaultCaptureShortcut
    )
    this.accelerator = initial.success ? initial.data : defaultCaptureShortcut
    this.failure = initial.success ? null : 'invalid'
  }

  getStatus(): CaptureShortcutStatus {
    return {
      accelerator: this.accelerator,
      defaultAccelerator: defaultCaptureShortcut,
      registered: this.registered,
      failure: this.failure
    }
  }

  register(): CaptureShortcutStatus {
    if (this.disposed) {
      this.failure = 'unavailable'
      return this.getStatus()
    }
    if (this.registered) return this.getStatus()

    const failure = this.tryRegister(this.accelerator)
    if (failure) {
      this.failure = failure
      return this.getStatus()
    }

    this.registered = true
    this.failure = null
    return this.getStatus()
  }

  reconfigure(candidate: string): Promise<CaptureShortcutStatus> {
    const operation = this.transition.then(async () => await this.performReconfigure(candidate))
    this.transition = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    const registrations = new Set<string>()
    if (this.registered) registrations.add(this.accelerator)
    if (this.pendingCandidate) registrations.add(this.pendingCandidate)

    for (const accelerator of registrations) {
      try {
        this.registrar.unregister(accelerator)
      } catch {
        // Electron exposes no recovery action if unregister itself fails during exit.
      }
    }

    this.pendingCandidate = undefined
    this.registered = false
    this.failure = 'unavailable'
  }

  private async performReconfigure(candidate: string): Promise<CaptureShortcutStatus> {
    if (this.disposed) {
      this.failure = 'unavailable'
      return this.getStatus()
    }

    const parsed = shortcutAcceleratorSchema.safeParse(candidate)
    if (!parsed.success) {
      this.failure = 'invalid'
      return this.getStatus()
    }

    const nextAccelerator = parsed.data
    if (nextAccelerator === this.accelerator) {
      if (!this.registered) return this.register()
      this.failure = null
      return this.getStatus()
    }

    const registrationFailure = this.tryRegister(nextAccelerator)
    if (registrationFailure) {
      this.failure = registrationFailure
      return this.getStatus()
    }

    this.pendingCandidate = nextAccelerator
    try {
      await this.persistAccelerator(nextAccelerator)
    } catch (error) {
      this.unregisterPendingCandidate(nextAccelerator)
      throw error
    }

    if (this.disposed) {
      this.unregisterPendingCandidate(nextAccelerator)
      return this.getStatus()
    }

    const previousAccelerator = this.accelerator
    const previousWasRegistered = this.registered
    if (previousWasRegistered) this.registrar.unregister(previousAccelerator)

    this.pendingCandidate = undefined
    this.accelerator = nextAccelerator
    this.registered = true
    this.failure = null
    return this.getStatus()
  }

  private tryRegister(accelerator: string): Exclude<ShortcutFailure, 'invalid' | null> | null {
    try {
      return this.registrar.register(accelerator, this.activationCallback) ? null : 'conflict'
    } catch {
      return 'unavailable'
    }
  }

  private unregisterPendingCandidate(accelerator: string): void {
    if (this.pendingCandidate !== accelerator) return
    try {
      this.registrar.unregister(accelerator)
    } finally {
      this.pendingCandidate = undefined
    }
  }
}
