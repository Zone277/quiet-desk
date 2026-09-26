import type { Locale } from '../../shared/ipc-contract'

export interface Copy {
  appName: string
  widget: string
  capture: string
  library: string
  today: string
  loading: string
  startupError: string
  wrongWindow: string
  untitled: string
  schedule: string
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
  captureHint: string
  created: string
  source: string
  preview: string
  markdownViewMode: string
  emptyPreview: string
  remoteImageBlocked: string
  openLinkFailed: string
  captureShortcut: string
  currentShortcut: string
  shortcutCandidate: string
  shortcutHint: string
  saveShortcut: string
  shortcutRegistered: string
  shortcutNotRegistered: string
  shortcutConflict: string
  shortcutInvalid: string
  shortcutUnavailable: string
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
  dailyLog: string
  logCompleted: string
  logPending: string
  logPlanned: string
  logNotes: string
  logNoItems: string
  logManual: string
  logConflict: string
  logUseMyText: string
  logExport: string
  logExporting: string
  logExportSaved: string
  logExportCancelled: string
  logExportFailed: string
  logIndependentCopyWarning: string
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
  startupError: '启动失败',
  wrongWindow: '启动信息与当前窗口不匹配。',
  untitled: '无标题',
  schedule: '日程',
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
  captureHint: 'Enter 换行 · Ctrl+Enter 提交 · Esc 保存并收起',
  created: '已保存到本地数据库',
  source: '源码',
  preview: '预览',
  markdownViewMode: 'Markdown 视图',
  emptyPreview: '暂无可预览内容',
  remoteImageBlocked: '远程图片已阻止',
  openLinkFailed: '无法打开链接',
  captureShortcut: '快捷捕获快捷键',
  currentShortcut: '当前',
  shortcutCandidate: '新快捷键',
  shortcutHint: '至少包含一个修饰键，例如 Ctrl+Shift+Space',
  saveShortcut: '应用快捷键',
  shortcutRegistered: '已注册',
  shortcutNotRegistered: '未注册',
  shortcutConflict: '该快捷键已被占用；当前快捷键和 Widget 捕获入口保持可用。',
  shortcutInvalid: '快捷键格式无效；请使用允许的修饰键和按键。',
  shortcutUnavailable: '系统快捷键当前不可用；仍可从 Widget 打开快捷捕获。',
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
  dailyLog: '每日日志',
  logCompleted: '当天完成',
  logPending: '截至日界线仍待办',
  logPlanned: '当天安排（计划）',
  logNotes: '当天记录的笔记',
  logNoItems: '本区暂无内容',
  logManual: '手写补充（Markdown）',
  logConflict: '手写区有其他版本，输入已保留',
  logUseMyText: '以我的文字替换并保存',
  logExport: '导出 Markdown',
  logExporting: '正在导出…',
  logExportSaved: '导出已保存',
  logExportCancelled: '已取消导出',
  logExportFailed: '导出失败',
  logIndependentCopyWarning: '已导出的文件及外部备份是独立副本；之后的删除不会自动修改它们。',
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
  startupError: 'Startup error',
  wrongWindow: 'Startup information does not match this window.',
  untitled: 'Untitled',
  schedule: 'Schedule',
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
  overdue: 'Overdue',
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
  captureHint: 'Enter for a new line · Ctrl+Enter to submit · Esc to save and hide',
  created: 'Saved to the local database',
  source: 'Source',
  preview: 'Preview',
  markdownViewMode: 'Markdown view',
  emptyPreview: 'Nothing to preview yet',
  remoteImageBlocked: 'Remote image blocked',
  openLinkFailed: 'Could not open link',
  captureShortcut: 'Quick Capture shortcut',
  currentShortcut: 'Current',
  shortcutCandidate: 'New shortcut',
  shortcutHint: 'Include at least one modifier, for example Ctrl+Shift+Space',
  saveShortcut: 'Apply shortcut',
  shortcutRegistered: 'Registered',
  shortcutNotRegistered: 'Not registered',
  shortcutConflict: 'That shortcut is already in use. The current shortcut and Widget entry remain available.',
  shortcutInvalid: 'The shortcut format is invalid. Use a supported modifier and key.',
  shortcutUnavailable: 'The system shortcut is unavailable. Quick Capture is still available from the Widget.',
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
  dailyLog: 'Daily Log',
  logCompleted: 'Completed that day',
  logPending: 'Pending at day boundary',
  logPlanned: 'Schedule (planned)',
  logNotes: 'Notes recorded that day',
  logNoItems: 'Nothing in this section',
  logManual: 'Manual addition (Markdown)',
  logConflict: 'The manual section changed elsewhere; your text is preserved',
  logUseMyText: 'Replace saved version and save my text',
  logExport: 'Export Markdown',
  logExporting: 'Exporting…',
  logExportSaved: 'Export saved',
  logExportCancelled: 'Export cancelled',
  logExportFailed: 'Export failed',
  logIndependentCopyWarning: 'Exported files and external backups are independent copies; later deletions do not update them.',
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
