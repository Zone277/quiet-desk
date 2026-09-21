import type { Locale } from '../../shared/ipc-contract'

export interface Copy {
  appName: string
  widget: string
  capture: string
  library: string
  today: string
  loading: string
  retry: string
  save: string
  saving: string
  saved: string
  saveFailed: string
  unsaved: string
  create: string
  creating: string
  close: string
  cancel: string
  delete: string
  restore: string
  permanentlyDelete: string
  confirmPermanentDelete: string
  permanentDeleteHint: string
  currentTasks: string
  todaySchedule: string
  recentNotes: string
  completedToday: string
  noTasks: string
  noSchedules: string
  noNotes: string
  noCompleted: string
  more: (count: number) => string
  overdue: string
  planned: string
  due: string
  completed: string
  allDay: string
  continuesFromBefore: string
  continuesAfter: string
  openCapture: string
  openLibrary: string
  browseDate: string
  note: string
  task: string
  timedSchedule: string
  allDaySchedule: string
  title: string
  details: string
  planDate: string
  dueDate: string
  start: string
  end: string
  draftReady: string
  draftIncomplete: string
  draftConflict: string
  captureStageNotice: string
  created: string
  language: string
  theme: string
  system: string
  light: string
  dark: string
  appearanceError: string
  previousDate: string
  nextDate: string
  dayTasks: string
  daySchedules: string
  dayNotes: string
  history: string
  noHistory: string
  trash: string
  trashEmpty: string
  itemDetails: string
  selectItem: string
  moveToTrash: string
  refresh: string
  localOnly: string
  fallbackHost: string
  desktopHost: string
  hostChecking: string
  operationFailed: string
  invalidForm: string
  noteNeedsContent: string
  scheduleTimeZoneHint: (timeZone: string) => string
  revision: (revision: number) => string
}

const ZH: Copy = {
  appName: 'QuietDesk',
  widget: '桌面小组件',
  capture: '快捷捕获',
  library: '资料库',
  today: '今天',
  loading: '正在读取本地数据…',
  retry: '重试',
  save: '保存草稿',
  saving: '保存中…',
  saved: '草稿已保存',
  saveFailed: '草稿保存失败，内容仍保留在窗口中',
  unsaved: '尚未保存',
  create: '创建',
  creating: '正在创建…',
  close: '收起',
  cancel: '取消',
  delete: '删除',
  restore: '恢复',
  permanentlyDelete: '永久删除',
  confirmPermanentDelete: '确认永久删除？',
  permanentDeleteHint: '应用管理的正文与关联历史快照将被清除。此操作不会改写外部导出或备份。',
  currentTasks: '当前待办',
  todaySchedule: '今日安排',
  recentNotes: '最近笔记',
  completedToday: '今日已完成',
  noTasks: '当前没有待办',
  noSchedules: '今天没有安排',
  noNotes: '还没有最近笔记',
  noCompleted: '今天还没有完成事项',
  more: (count) => `还有 ${count} 项`,
  overdue: '已到期',
  planned: '计划',
  due: '截止',
  completed: '完成',
  allDay: '全天',
  continuesFromBefore: '此前开始',
  continuesAfter: '之后继续',
  openCapture: '打开快捷捕获',
  openLibrary: '打开资料库',
  browseDate: '按日期浏览',
  note: '笔记',
  task: '任务',
  timedSchedule: '定时日程',
  allDaySchedule: '全天日程',
  title: '标题',
  details: 'Markdown 内容',
  planDate: '计划日期',
  dueDate: '截止日期',
  start: '开始',
  end: '结束（不包含）',
  draftReady: '草稿已恢复',
  draftIncomplete: '请补齐必填字段后保存草稿',
  draftConflict: '草稿已在其他窗口更新，请检查后重试',
  captureStageNotice: '本阶段使用按钮创建；IME 与 Ctrl+Enter 完整行为留待阶段 4。',
  created: '已保存到本地数据库',
  language: '语言',
  theme: '主题',
  system: '自动',
  light: '浅色',
  dark: '深色',
  appearanceError: '外观设置保存失败',
  previousDate: '前一天',
  nextDate: '后一天',
  dayTasks: '当日任务',
  daySchedules: '当日日程',
  dayNotes: '当日笔记',
  history: '操作历史',
  noHistory: '没有可显示的操作历史',
  trash: '回收站',
  trashEmpty: '回收站为空',
  itemDetails: '项目详情',
  selectItem: '选择一个项目查看详情与历史',
  moveToTrash: '移到回收站',
  refresh: '刷新',
  localOnly: '本地数据',
  fallbackHost: '开发降级模式',
  desktopHost: '桌面宿主已连接',
  hostChecking: '检查桌面宿主',
  operationFailed: '操作失败',
  invalidForm: '请检查必填字段和日期范围',
  noteNeedsContent: '请输入标题或正文',
  scheduleTimeZoneHint: (timeZone) => `时间按应用时区 ${timeZone} 输入`,
  revision: (revision) => `版本 ${revision}`
}

const EN: Copy = {
  appName: 'QuietDesk',
  widget: 'Desktop widget',
  capture: 'Quick Capture',
  library: 'Library',
  today: 'Today',
  loading: 'Reading local data…',
  retry: 'Retry',
  save: 'Save draft',
  saving: 'Saving…',
  saved: 'Draft saved',
  saveFailed: 'Draft save failed. Your text remains in this window.',
  unsaved: 'Not saved yet',
  create: 'Create',
  creating: 'Creating…',
  close: 'Hide',
  cancel: 'Cancel',
  delete: 'Delete',
  restore: 'Restore',
  permanentlyDelete: 'Delete permanently',
  confirmPermanentDelete: 'Permanently delete this item?',
  permanentDeleteHint: 'Managed content and associated history snapshots will be removed. External exports and backups are unchanged.',
  currentTasks: 'Current tasks',
  todaySchedule: 'Today’s schedule',
  recentNotes: 'Recent notes',
  completedToday: 'Completed today',
  noTasks: 'No current tasks',
  noSchedules: 'Nothing scheduled today',
  noNotes: 'No recent notes yet',
  noCompleted: 'Nothing completed today',
  more: (count) => `${count} more`,
  overdue: 'Due',
  planned: 'Planned',
  due: 'Due',
  completed: 'Completed',
  allDay: 'All day',
  continuesFromBefore: 'Started earlier',
  continuesAfter: 'Continues',
  openCapture: 'Open Quick Capture',
  openLibrary: 'Open Library',
  browseDate: 'Browse by date',
  note: 'Note',
  task: 'Task',
  timedSchedule: 'Timed schedule',
  allDaySchedule: 'All-day schedule',
  title: 'Title',
  details: 'Markdown content',
  planDate: 'Plan date',
  dueDate: 'Due date',
  start: 'Start',
  end: 'End (exclusive)',
  draftReady: 'Draft restored',
  draftIncomplete: 'Complete the required fields before saving this draft',
  draftConflict: 'This draft changed in another window. Review it and retry.',
  captureStageNotice: 'This stage creates with the button. Complete IME and Ctrl+Enter behavior is reserved for stage 4.',
  created: 'Saved to the local database',
  language: 'Language',
  theme: 'Theme',
  system: 'Auto',
  light: 'Light',
  dark: 'Dark',
  appearanceError: 'Could not save appearance settings',
  previousDate: 'Previous day',
  nextDate: 'Next day',
  dayTasks: 'Tasks for this day',
  daySchedules: 'Schedule for this day',
  dayNotes: 'Notes for this day',
  history: 'Operation history',
  noHistory: 'No operation history to show',
  trash: 'Trash',
  trashEmpty: 'Trash is empty',
  itemDetails: 'Item details',
  selectItem: 'Select an item to view details and history',
  moveToTrash: 'Move to trash',
  refresh: 'Refresh',
  localOnly: 'Local data',
  fallbackHost: 'Development fallback',
  desktopHost: 'Desktop host attached',
  hostChecking: 'Checking desktop host',
  operationFailed: 'Operation failed',
  invalidForm: 'Check the required fields and date range',
  noteNeedsContent: 'Enter a title or some content',
  scheduleTimeZoneHint: (timeZone) => `Times use the application time zone: ${timeZone}`,
  revision: (revision) => `Revision ${revision}`
}

export function copyFor(locale: Locale): Copy {
  return locale === 'zh-CN' ? ZH : EN
}
