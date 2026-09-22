import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { copyFor } from './i18n'
import { MarkdownView } from './MarkdownView'

describe('MarkdownView', () => {
  it('renders GFM while skipping raw HTML and replacing images', () => {
    const markdown = [
      '# 标题',
      '',
      '- [ ] 文档清单',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '![远程图](https://example.com/private.png)',
      '',
      '<script>window.bad = true</script>',
      '',
      '[外链](https://example.com/path)'
    ].join('\n')

    const html = renderToStaticMarkup(<MarkdownView markdown={markdown} copy={copyFor('zh-CN')} />)

    expect(html).toContain('<table>')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('远程图片已阻止')
    expect(html).toContain('href="https://example.com/path"')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('window.bad')
  })
})
