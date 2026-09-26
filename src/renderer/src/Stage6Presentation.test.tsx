import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EntityRecord } from '../../shared/model'
import { copyFor } from './i18n'
import { entityTitle } from './ui-utils'
import { DailyLogSections } from './DailyLogPanel'
import type { DailyLog } from '../../shared/model'

describe('Stage 6 presentation boundaries', () => {
  it('localizes the empty entity fallback while preserving mixed user content', () => {
    const record: EntityRecord = {
      type: 'note', value: {
        id: '00000000-0000-4000-8000-000000000001', title: '', bodyMarkdown: '', revision: 1,
        createdAtUtc: '2026-09-26T04:00:00.000Z', updatedAtUtc: '2026-09-26T04:00:00.000Z', deletedAtUtc: null
      }
    }
    expect(entityTitle(record, copyFor('zh-CN').untitled)).toBe('无标题')
    expect(entityTitle(record, copyFor('en-US').untitled)).toBe('Untitled')
    record.value.bodyMarkdown = '用户笔记 / Mixed content 📝'
    expect(entityTitle(record, copyFor('en-US').untitled)).toBe('用户笔记 / Mixed content 📝')
  })

  it('keeps Daily Log source text intact when changing interface language', () => {
    const instant = '2026-09-26T04:00:00.000Z'
    const log: DailyLog = {
      id: '00000000-0000-4000-8000-000000000001', logDate: '2026-09-26', attributionTimeZone: 'Asia/Shanghai',
      generatedAtUtc: instant, generationVersion: 1, createdAtUtc: instant, updatedAtUtc: instant,
      manualMarkdown: '', manualRevision: 0,
      autoItems: [{ id: '00000000-0000-4000-8000-000000000002', section: 'notes', sourceEntityType: 'note',
        sourceEntityId: '00000000-0000-4000-8000-000000000003', sourceOperationId: null,
        stableOrder: 1, snapshotMarkdown: '计划 / planned 是我记录的原文 📝' }]
    }
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const html = renderToStaticMarkup(<DailyLogSections log={log} copy={copyFor(locale)} />)
      expect(html).toContain('计划 / planned 是我记录的原文 📝')
      expect(html).toContain(copyFor(locale).logNotes)
    }
  })
})
