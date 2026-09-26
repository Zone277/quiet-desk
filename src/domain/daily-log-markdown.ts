import type { DailyLog, DailyLogItem } from '../shared/model'

const sections: Array<{ key: DailyLogItem['section']; heading: string }> = [
  { key: 'completed', heading: '当天完成' },
  { key: 'pending-at-boundary', heading: '截至日界线仍待办' },
  { key: 'planned', heading: '当天安排（计划）' },
  { key: 'notes', heading: '当天笔记' }
]

const englishHeadings: Record<DailyLogItem['section'], string> = {
  completed: 'Completed today',
  'pending-at-boundary': 'Pending at day boundary',
  planned: 'Schedules (planned)',
  notes: 'Notes today'
}

export function formatDailyLogInstant(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(instant))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`
}

export function dailyLogToMarkdown(log: DailyLog, locale: 'zh-CN' | 'en-US' = 'zh-CN'): string {
  const english = locale === 'en-US'
  const lines = [
    `# Daily Log · ${log.logDate}`, '',
    `${english ? 'Time zone: ' : '时区：'}${log.attributionTimeZone}`, ''
  ]
  for (const section of sections) {
    lines.push(`## ${english ? englishHeadings[section.key] : section.heading}`, '')
    const items = log.autoItems.filter((item) => item.section === section.key)
    if (items.length === 0) lines.push(english ? '(None)' : '（无）', '')
    else for (const item of items) lines.push(item.snapshotMarkdown, '')
  }
  lines.push(english ? '## Manual notes' : '## 手写补充', '', log.manualMarkdown, '')
  return lines.join('\n')
}
