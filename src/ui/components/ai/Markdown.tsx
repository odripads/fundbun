import { Fragment, type ReactNode } from 'react'
import styles from './Markdown.module.css'

/**
 * A small, safe Markdown view for answers from the user's own AI: paragraphs, headings, lists, code blocks,
 * inline code, bold and italic. Nothing is ever inserted as HTML (React escapes every string), links are shown
 * as text with their address rather than made clickable, and images are not loaded.
 */
export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'quote'; text: string }

const FENCE = /^\s{0,3}(```|~~~)\s*([A-Za-z0-9_+.#-]*)\s*$/
const BULLET = /^\s{0,6}[-*+]\s+(.*)$/
const NUMBERED = /^\s{0,6}\d{1,3}[.)]\s+(.*)$/

export function parseMarkdown(source: string): Block[] {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join('\n') })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = FENCE.exec(line)
    if (fence) {
      flush()
      const body: string[] = []
      i++
      while (i < lines.length && !new RegExp(`^\\s{0,3}${fence[1]}\\s*$`).test(lines[i])) body.push(lines[i++])
      blocks.push({ kind: 'code', lang: fence[2] ?? '', text: body.join('\n') })
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      flush()
      blocks.push({ kind: 'h', level: heading[1].length, text: heading[2] })
      continue
    }
    const list = BULLET.test(line) ? { kind: 'ul' as const, re: BULLET } : NUMBERED.test(line) ? { kind: 'ol' as const, re: NUMBERED } : null
    if (list) {
      flush()
      const items: string[] = []
      while (i < lines.length && (list.re.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const m = list.re.exec(lines[i])
        if (m) items.push(m[1])
        else items[items.length - 1] += ` ${lines[i].trim()}`
        i++
      }
      i--
      blocks.push(list.kind === 'ul' ? { kind: 'ul', items } : { kind: 'ol', items })
      continue
    }
    if (/^\s{0,3}>\s?/.test(line)) {
      flush()
      const quoted: string[] = []
      while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i])) quoted.push(lines[i++].replace(/^\s{0,3}>\s?/, ''))
      i--
      blocks.push({ kind: 'quote', text: quoted.join('\n') })
      continue
    }
    para.push(line)
  }
  flush()
  return blocks
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(!?\[[^\]\n]+\]\([^)\s]+\))/g

export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const token = m[0]
    if (m[1]) out.push(<code key={key++} className={styles.code}>{token.slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={key++}>{token.slice(2, -2)}</strong>)
    else if (m[3]) out.push(<em key={key++}>{token.slice(1, -1)}</em>)
    else {
      // a link or an image: the words, then the address as plain text — nothing to click, nothing fetched
      const link = /^!?\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)
      out.push(link ? `${link[1]} (${link[2]})` : token)
    }
    last = at + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text)
  return (
    <div className={styles.md}>
      {blocks.map((b, i) => {
        if (b.kind === 'code') {
          return (
            <pre key={i} className={styles.pre} tabIndex={0} aria-label={b.lang ? `${b.lang} code` : 'Code'}>
              <code>{b.text}</code>
            </pre>
          )
        }
        if (b.kind === 'h') return <p key={i} className={styles.heading} role="heading" aria-level={Math.min(6, b.level + 2)}>{inline(b.text)}</p>
        if (b.kind === 'ul' || b.kind === 'ol') {
          const items = b.items.map((it, j) => <li key={j}>{inline(it)}</li>)
          return b.kind === 'ul' ? <ul key={i} className={styles.list}>{items}</ul> : <ol key={i} className={styles.list}>{items}</ol>
        }
        if (b.kind === 'quote') return <blockquote key={i} className={styles.quote}>{inline(b.text)}</blockquote>
        return (
          <p key={i} className={styles.p}>
            {b.text.split('\n').map((line, j, all) => <Fragment key={j}>{inline(line)}{j < all.length - 1 ? <br /> : null}</Fragment>)}
          </p>
        )
      })}
    </div>
  )
}
