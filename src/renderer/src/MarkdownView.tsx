import { useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Copy } from './i18n'
import { ipcError, newRequestId, unknownError } from './ui-utils'

interface MarkdownViewProps {
  markdown: string
  copy: Copy
  className?: string
}

export function MarkdownView({ markdown, copy, className }: MarkdownViewProps): React.JSX.Element {
  const [linkError, setLinkError] = useState<string>()

  const openExternal = async (url: string): Promise<void> => {
    setLinkError(undefined)
    try {
      const result = await window.quietDesk.links.openExternal({
        requestId: newRequestId(),
        payload: { url }
      })
      if (!result.ok) setLinkError(ipcError(result))
    } catch (reason) {
      setLinkError(unknownError(reason))
    }
  }

  const components: Components = {
    a: ({ href, children, node: _node, ...props }) => (
      <a
        {...props}
        href={href}
        onClick={(event) => {
          event.preventDefault()
          if (href) void openExternal(href)
        }}
      >
        {children}
      </a>
    ),
    img: ({ alt }) => (
      <span
        className="markdown-image-blocked"
        data-testid="markdown-image-blocked"
        role="img"
        aria-label={copy.remoteImageBlocked}
      >
        {copy.remoteImageBlocked}{alt ? ` · ${alt}` : ''}
      </span>
    )
  }

  return (
    <div className={['markdown-view', className].filter(Boolean).join(' ')} data-testid="markdown-view">
      {markdown.trim() ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
          {markdown}
        </ReactMarkdown>
      ) : <p className="markdown-empty">{copy.emptyPreview}</p>}
      {linkError ? <p className="inline-error markdown-link-error" role="alert">{copy.openLinkFailed}: {linkError}</p> : null}
    </div>
  )
}
