import type { DailyLog, DailyLogItem } from '../shared/model'

const sections: Array<{ key: DailyLogItem['section']; heading: string }> = [
  { key: 'completed', heading: '当天完成' },
  { key: 'pending-at-boundary', heading: '截至日界线仍待办' },
  { key: 'planned', heading: '当天安排（计划）' },
  { key: 'notes', heading: '当天笔记' }
]

export function formatDailyLogInstant(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date(instant))
}

export function dailyLogToMarkdown(log: DailyLog): string {
  const lines = [`# Daily Log · ${log.logDate}`, '', `时区：${log.attributionTimeZone}`, '']
  for (const section of sections) {
    lines.push(`## ${section.heading}`, '')
    const items = log.autoItems.filter((item) => item.section === section.key)
    if (items.length === 0) lines.push('（无）', '')
    else for (const item of items) lines.push(item.snapshotMarkdown, '')
  }
  lines.push('## 手写补充', '', log.manualMarkdown, '')
  return lines.join('\n')
}
