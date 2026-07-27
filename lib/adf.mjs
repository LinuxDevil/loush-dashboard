// lib/adf.mjs — Atlassian Document Format → plain text.
//
// WHY THIS EXISTS
// JIRA Cloud REST v3 returns rich text as ADF: a ProseMirror JSON tree,
// `{type:'doc', version:1, content:[…]}`. `expand=renderedFields` renders the DESCRIPTION to HTML
// but does NOT render COMMENT bodies — those come back as raw ADF. server/eng.mjs did not know
// that, and passed every comment body to htmlToText(), whose first act is `String(html)`:
//
//     htmlToText({type:'doc', …})  ->  "[object Object]"
//
// That string was not merely displayed. genPrompt() interpolates each comment body into the
// acceptance-criteria and test-case prompts, so every artifact this app has generated was built
// from `- Alice: [object Object]` for each comment — silently discarding the clarifying discussion,
// which on a thin ticket is the most requirement-dense content available. The output still looked
// confident and well-formed, which is why nothing surfaced it.
//
// So: walk the tree instead of stringifying it. `warnings` is deliberately part of the return value
// rather than a console.log — a caller that drops content must be able to SAY that it dropped
// content (README.md "Honesty rules" §2: no green tick over an absent source).
//
// Pure, no I/O, no dependencies — see test/lib/adf.test.mjs.

/** Is this an ADF document (as opposed to a rendered-HTML string)? */
// Deliberately NOT `&& Array.isArray(v.content)`: an ADF doc that arrives without a content key
// would then fall through to htmlToText and reproduce "[object Object]" — the exact bug this module
// exists to kill. Any non-string object here is richer than a string and belongs to the walker.
export const isAdf = v => !!v && typeof v === 'object' && !Array.isArray(v) && v.type === 'doc'

// Nodes whose children are laid out inline (no line break between them).
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
  // A string here is already rendered HTML or plain text — not this module's job.
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
        // Only `code` earns a marker; bold/italic/link markers add noise to a prompt without
        // adding meaning, and the link href is preserved below.
        for (const m of node.marks || []) {
          if (m.type === 'code') t = '`' + t + '`'
          else if (m.type === 'link' && m.attrs?.href && m.attrs.href !== t) t = `${t} (${m.attrs.href})`
        }
        return t
      }
      case 'hardBreak': return '\n'
      case 'emoji': return node.attrs?.text || node.attrs?.shortName || ''
      // A mention with no text is an accountId nobody can read — name it as unresolved rather
      // than emitting an empty string that silently changes the meaning of a sentence.
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
        // Continuation lines that already carry their own list marker (a nested list) keep their
        // indentation; plain wrapped text is indented to sit under the marker.
        return [marker + head, ...rest.map(l => (/^\s*([•]|\d+\.)\s/.test(l) ? l : '  '.repeat(depth + 1) + l))].join('\n')
      }
      // taskList is where teams actually write acceptance criteria — dropping it would remove the
      // single most valuable block type on a well-specified ticket.
      case 'taskList': return kids.map(k => walk(k, depth)).filter(Boolean).join('\n')
      case 'taskItem': return `${'  '.repeat(depth)}- [${node.attrs?.state === 'DONE' ? 'x' : ' '}] ${joinInline(depth)}`
      case 'decisionList': return kids.map(k => walk(k, depth)).filter(Boolean).join('\n')
      case 'decisionItem': return `${'  '.repeat(depth)}- (decision) ${joinInline(depth)}`

      // ---- tables ----
      // Rendered as pipe rows: structure is what carries meaning in a requirements table, and a
      // flattened table is how a requirement stated in a cell gets lost.
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
        // Unknown type: recurse rather than drop. An unrecognised wrapper around real text must
        // not silently delete that text — that is the exact failure this module exists to fix.
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
      i++ // closing fence (or EOF — an unterminated fence still yields its content)
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

    // Plain paragraph: absorb following non-blank, non-structural lines.
    const para = [line.trim()]
    i++
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```)/.test(lines[i]) && !isBullet(lines[i]) && !isOrdered(lines[i])) {
      para.push(lines[i].trim())
      i++
    }
    content.push({ type: 'paragraph', content: textNode(para.join(' ')) })
  }
  // An empty doc is invalid to JIRA; a single empty paragraph is the legal minimum.
  return { type: 'doc', version: 1, content: content.length ? content : [{ type: 'paragraph', content: [] }] }
}
