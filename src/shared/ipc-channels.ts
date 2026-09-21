export const IPC_CONTRACT_VERSION = 2 as const

export const QUIETDESK_CHANNELS = {
  bootstrap: 'quietdesk:v2:bootstrap',
  widgetSnapshot: 'quietdesk:v2:widget:snapshot',
  daySnapshot: 'quietdesk:v2:library:day',
  getEntity: 'quietdesk:v2:entities:get',
  getHistory: 'quietdesk:v2:entities:history',
  listTrash: 'quietdesk:v2:entities:trash-list',
  createTask: 'quietdesk:v2:tasks:create',
  updateTask: 'quietdesk:v2:tasks:update',
  setTaskCompletion: 'quietdesk:v2:tasks:set-completion',
  rescheduleTask: 'quietdesk:v2:tasks:reschedule',
  createNote: 'quietdesk:v2:notes:create',
  getNote: 'quietdesk:v2:notes:get',
  updateNote: 'quietdesk:v2:notes:update',
  createSchedule: 'quietdesk:v2:schedules:create',
  updateSchedule: 'quietdesk:v2:schedules:update',
  getDraft: 'quietdesk:v2:drafts:get',
  saveDraft: 'quietdesk:v2:drafts:save',
  trashEntity: 'quietdesk:v2:entities:trash',
  restoreEntity: 'quietdesk:v2:entities:restore',
  permanentlyDeleteEntity: 'quietdesk:v2:entities:permanent-delete',
  updateAppearance: 'quietdesk:v2:settings:appearance',
  showWindow: 'quietdesk:v2:windows:show',
  hideWindow: 'quietdesk:v2:windows:hide',
  windowContext: 'quietdesk:v2:windows:context',
  changed: 'quietdesk:v2:changed'
} as const
