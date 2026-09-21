export class IdempotencyConflictError extends Error {
  readonly code = 'CONFLICT' as const

  constructor(readonly idempotencyKey: string) {
    super(`Idempotency key ${idempotencyKey} is already bound to a different command`)
    this.name = 'IdempotencyConflictError'
  }
}
