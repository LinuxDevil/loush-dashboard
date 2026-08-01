
export const isAdf = v => !!v && typeof v === 'object' && !Array.isArray(v) && v.type === 'doc'

const INLINE = new Set(['text', 'emoji', 'mention', 'inlineCard', 'status', 'date', 'hardBreak'])

const bullet = depth => '  '.repeat(depth) + '• '
const numbered = (depth, i) => '  '.repeat(depth) + `${i}. `

/**
 * ADF → readable plain text.
 * @returns {{text: string, warnings: string[]}} warnings names every node type that carried no
 *          extractable content, so callers can report incompleteness instead of implying none.
 */
export function adfToText(doc) {
  if (doc == null) return { text: '', warnings: [] }
  if (typeof doc === 'string') return { text: doc, warnings: [] }
  const warnings = new Set()

  const walk = (node, depth = 0, listIndex = null) => {
    if (!node || typeof node !== 'object') return ''
    const kids = Array.isArray(node.content) ? node.content : []
    const joinBlocks = (d = depth) => kids.map(k => walk(k, d)).filter(s => s !== '').join('\n')
    const joinInline = (d = depth) => kids.map(k => walk(k, d)).join('')

    switch (node.type) {
      case 'doc': return joinBlocks()

      // ---- inline ----
      case 'text': {
        let t = typeof node.text === 'string' ? node.text : ''
        for (const m of node.marks || []) {
          if (m.type === 'code') t = '`' + t + '`'
          else if (m.type === 'link' && m.attrs?.href && m.attrs.href !== t) t = `${t} (${m.attrs.href})`
        }
        return t
      }
      case 'hardBreak': return '\n'
      case 'emoji': return node.attrs?.text || node.attrs?.shortName || ''
      case 'mention': return node.attrs?.text || (node.attrs?.id ? '@unknown' : '')
      case 'date': return node.attrs?.timestamp ? new Date(Number(node.attrs.timestamp)).toISOString().slice(0, 10) : ''
      case 'status': return node.attrs?.text ? `[${node.attrs.text}]` : ''
      case 'inlineCard': return node.attrs?.url || ''
      case 'mediaInline':
      case 'media': { warnings.add('media'); return '' }

      // ---- blocks ----
      case 'paragraph': return joinInline()
      case 'heading': return `${'#'.repeat(Math.min(6, node.attrs?.level || 1))} ${joinInline()}`
      case 'blockquote': return joinBlocks().split('\n').map(l => '> ' + l).join('\n')
      case 'rule': return '---'
      case 'codeBlock': {
        const lang = node.attrs?.language || ''
        return '```' + lang + '\n' + joinInline() + '\n```'
      }
      case 'panel': {
        const kind = node.attrs?.panelType || 'info'
        return joinBlocks().split('\n').map(l => `[${kind}] ${l}`).join('\n')
      }
      case 'expand':
      case 'nestedExpand': {
        const title = node.attrs?.title || 'details'
        return `${title}:\n${joinBlocks(depth)}`
      }

      // ---- lists ----
      case 'bulletList': return kids.map(k => walk(k, depth, null)).filter(Boolean).join('\n')
      case 'orderedList': {
        const start = Number(node.attrs?.order ?? 1) || 1
        return kids.map((k, i) => walk(k, depth, start + i)).filter(Boolean).join('\n')
      }
      case 'listItem': {
        const body = joinBlocks(depth + 1)
        if (body === '') return ''
        const [head, ...rest] = body.split('\n')
        const marker = listIndex == null ? bullet(depth) : numbered(depth, listIndex)
        return [marker + head, ...rest.map(l => (/^\s*([•]|\d+\.)\s/.test(l) ? l : '  '.repeat(depth + 1) + l))].join('\n')
      }
      case 'taskList': return kids.map(k => walk(k, depth)).filter(Boolean).join('\n')
      case 'taskItem': return `${'  '.repeat(depth)}- [${node.attrs?.state === 'DONE' ? 'x' : ' '}] ${joinInline(depth)}`
      case 'decisionList': return kids.map(k => walk(k, depth)).filter(Boolean).join('\n')
      case 'decisionItem': return `${'  '.repeat(depth)}- (decision) ${joinInline(depth)}`

      // ---- tables ----
      case 'table': {
        const rows = kids.map(r => walk(r, depth)).filter(Boolean)
        if (!rows.length) return ''
        const cols = (kids[0]?.content || []).length
        const isHeader = (kids[0]?.content || []).some(c => c.type === 'tableHeader')
        return isHeader && cols
          ? [rows[0], '| ' + Array(cols).fill('---').join(' | ') + ' |', ...rows.slice(1)].join('\n')
          : rows.join('\n')
      }
      case 'tableRow': return '| ' + kids.map(c => walk(c, depth).replace(/\n+/g, ' ').trim()).join(' | ') + ' |'
      case 'tableHeader':
      case 'tableCell': return joinBlocks()

      default: {
        if (kids.length) return kids.some(k => INLINE.has(k.type)) ? joinInline() : joinBlocks()
        if (typeof node.text === 'string') return node.text
        if (node.type) warnings.add(node.type)
        return ''
      }
    }
  }

  const text = walk(doc).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return { text, warnings: [...warnings] }
}

/**
 * Markdown → minimal ADF, for writing a comment back to JIRA.
 * v3 comment bodies accept NEITHER html NOR markdown — the body must be an ADF document — so
 * posting generated acceptance criteria requires this direction too.
 * Deliberately minimal: paragraphs, headings, bullet/ordered lists, fenced code. Anything else is
 * emitted as a paragraph rather than dropped.
 */
export function markdownToAdf(md) {
  const lines = String(md == null ? '' : md).split('\n')
  const content = []
  let i = 0
  const textNode = s => (s ? [{ type: 'text', text: s }] : [])
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }

    const fence = /^```(\w*)\s*$/.exec(line)
    if (fence) {
      const body = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++])
      i++
      content.push({ type: 'codeBlock', ...(fence[1] ? { attrs: { language: fence[1] } } : {}), content: textNode(body.join('\n')) })
      continue
    }

    const head = /^(#{1,6})\s+(.*)$/.exec(line)
    if (head) {
      content.push({ type: 'heading', attrs: { level: head[1].length }, content: textNode(head[2].trim()) })
      i++
      continue
    }

    const isBullet = l => /^\s*[-*+]\s+/.test(l)
    const isOrdered = l => /^\s*\d+[.)]\s+/.test(l)
    if (isBullet(line) || isOrdered(line)) {
      const ordered = isOrdered(line)
      const items = []
      while (i < lines.length && (ordered ? isOrdered(lines[i]) : isBullet(lines[i]))) {
        const t = lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/, '').trim()
        items.push({ type: 'listItem', content: [{ type: 'paragraph', content: textNode(t) }] })
        i++
      }
      content.push({ type: ordered ? 'orderedList' : 'bulletList', content: items })
      continue
    }

    const para = [line.trim()]
    i++
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```)/.test(lines[i]) && !isBullet(lines[i]) && !isOrdered(lines[i])) {
      para.push(lines[i].trim())
      i++
    }
    content.push({ type: 'paragraph', content: textNode(para.join(' ')) })
  }
  return { type: 'doc', version: 1, content: content.length ? content : [{ type: 'paragraph', content: [] }] }
}
