import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DailyLog, DailyLogItem } from '../../shared/model'
import { DailyLogSections } from './DailyLogPanel'
import { copyFor } from './i18n'

const id = '00000000-0000-4000-8000-000000000001'
const instant = '2026-09-24T04:00:00.000Z'

function item(section: DailyLogItem['section'], markdown: string, stableOrder: number): DailyLogItem {
  return {
    id: `00000000-0000-4000-8000-${String(stableOrder).padStart(12, '0')}`,
    section, sourceEntityType: section === 'notes' ? 'note' : section === 'planned' ? 'schedule' : 'task',
    sourceEntityId: id, sourceOperationId: null, stableOrder, snapshotMarkdown: markdown
  }
}

describe('DailyLogSections', () => {
  it('renders four server-provided sections with the planned label and safe Markdown', () => {
    const log: DailyLog = {
      id, logDate: '2026-09-24', attributionTimeZone: 'Asia/Shanghai',
      generatedAtUtc: instant, generationVersion: 1, createdAtUtc: instant, updatedAtUtc: instant,
      manualMarkdown: '', manualRevision: 0,
      autoItems: [
        item('notes', '![remote](https://example.com/image.png)', 4),
        item('planned', 'Meeting **planned**', 3),
        item('pending-at-boundary', 'Open task', 2),
        item('completed', 'Done task', 1)
      ]
    }
    const html = renderToStaticMarkup(<DailyLogSections log={log} copy={copyFor('en-US')} />)
    expect(html).toContain('data-testid="daily-log-completed"')
    expect(html).toContain('data-testid="daily-log-pending-at-boundary"')
    expect(html).toContain('data-testid="daily-log-planned"')
    expect(html).toContain('data-testid="daily-log-notes"')
    expect(html).toContain('Schedule (planned)')
    expect(html).toContain('<strong>planned</strong>')
    expect(html).toContain('Remote image blocked')
    expect(html).not.toContain('<img')
  })
})
