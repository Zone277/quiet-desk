export class IdempotencyConflictError extends Error {
  readonly code = 'CONFLICT' as const

  constructor(readonly idempotencyKey: string) {
    super(`Idempotency key ${idempotencyKey} is already bound to a different command`)
    this.name = 'IdempotencyConflictError'
  }
}

export class EntityNotFoundError extends Error {
  readonly code = 'NOT_FOUND' as const

  constructor(
    readonly entityType: string,
    readonly entityId: string,
    message = `${entityType} ${entityId} was not found`
  ) {
    super(message)
    this.name = 'EntityNotFoundError'
  }
}

export class StorageConflictError extends Error {
  readonly code = 'CONFLICT' as const

  constructor(
    readonly reason: string,
    message: string
  ) {
    super(message)
    this.name = 'StorageConflictError'
  }
}
