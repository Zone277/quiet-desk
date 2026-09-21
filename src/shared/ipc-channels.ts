export const IPC_CONTRACT_VERSION = 1 as const

export const QUIETDESK_CHANNELS = {
  bootstrap: 'quietdesk:v1:bootstrap',
  createNote: 'quietdesk:v1:notes:create',
  getNote: 'quietdesk:v1:notes:get',
  changed: 'quietdesk:v1:changed'
} as const
