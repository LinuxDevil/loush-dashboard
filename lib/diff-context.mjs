import { isObj, str, arr } from './event-shared.mjs'

const MAX_SCAN_LINE = 400

const NOT_A_NAME = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'else', 'do', 'try', 'finally', 'return', 'new', 'await',
  'with', 'match', 'case', 'defer', 'select', 'using', 'in', 'is', 'not', 'and', 'or', 'lambda',
  'import', 'from', 'package', 'throw', 'throws', 'yield', 'typeof', 'instanceof', 'delete', 'void',
  'function', 'class', 'def', 'fn', 'func', 'impl', 'struct', 'enum', 'trait', 'interface', 'type',
  'const', 'let', 'var', 'async', 'export', 'default', 'extends', 'implements', 'public', 'private',
  'protected', 'static', 'final', 'abstract', 'synchronized', 'pub', 'unsafe', 'extern', 'mut',
  'self', 'this', 'super', 'assert', 'print', 'println', 'require', 'go', 'chan', 'map', 'range',
])

const MODIFIERS =
  '(?:export\\s+|default\\s+|public\\s+|private\\s+|protected\\s+|static\\s+|final\\s+|abstract\\s+|synchronized\\s+|native\\s+|strictfp\\s+|open\\s+|override\\s+|inline\\s+|const\\s+|pub(?:\\s*\\([^)]*\\))?\\s+|unsafe\\s+|extern\\s+(?:"[^"]*"\\s+)?)*'

const DECLARATION_PATTERNS = [
  {
    re: /^\s*func\s*\(\s*\w+\s+[*]?(\w+)\s*\)\s*([A-Za-z_]\w*)\s*\(/,
    pick: m => `${m[1]}.${m[2]}`,
  },
  {
    re: new RegExp(`^\\s*${MODIFIERS}(?:async\\s+)?(?:function\\s*\\*?|def|fn|func|sub)\\s+([A-Za-z_$][\\w$]*)`),
    pick: m => m[1],
  },
  {
    re: new RegExp(`^\\s*${MODIFIERS}(?:class|struct|enum|trait|interface|impl|record|namespace|module|type)(?:<[^>]*>)?\\s+([A-Za-z_$][\\w$]*)`),
    pick: m => m[1],
  },
  {
    re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s+)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=>)/,
    pick: m => m[1],
  },
  {
    re: /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|native|strictfp|default)\s+)+(?:[A-Za-z_$][\w$.<>,\[\]\s]*\s+)?([A-Za-z_$][\w$]*)\s*\(/,
    pick: m => m[1],
  },
  {
    re: /^[ \t]+(?:(?:async|get|set|static|override|public|private|protected)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^;=]*\)\s*(?::[^{;=]+)?\{\s*$/,
    pick: m => m[1],
  },
]

const declarationName = line => {
  const s = str(line)
  if (!s || s.length > MAX_SCAN_LINE) return null
  for (const { re, pick } of DECLARATION_PATTERNS) {
    const m = re.exec(s)
    if (!m) continue
    const name = pick(m)
    if (!name) continue
    const head = name.split('.')[0]
    const tail = name.split('.').pop()
    if (NOT_A_NAME.has(head) || NOT_A_NAME.has(tail)) continue
    return name
  }
  return null
}

const normalizeHunk = hunk => {
  if (typeof hunk === 'string') {
    const all = hunk.split('\n')
    const m = /^@@[^@]*@@\s?(.*)$/.exec(all[0] ?? '')
    if (m) return { header: m[1].trim() || null, lines: all.slice(1) }
    return { header: null, lines: all }
  }
  if (Array.isArray(hunk)) return { header: null, lines: hunk }
  if (isObj(hunk)) {
    const rawHeader = str(hunk.header) ?? str(hunk.section) ?? str(hunk.context) ?? null
    const m = rawHeader ? /^@@[^@]*@@\s?(.*)$/.exec(rawHeader) : null
    return {
      header: (m ? m[1].trim() : rawHeader?.trim()) || null,
      lines: arr(hunk.lines),
    }
  }
  return { header: null, lines: [] }
}

export function firstEnclosingContext(hunk) {
  try {
    const { header, lines } = normalizeHunk(hunk)
    if (header) {
      const fromHeader = declarationName(header)
      if (fromHeader) return fromHeader
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = str(lines[i])
      if (raw == null) continue
      if (raw.startsWith('\\') || raw.startsWith('@@') || raw.startsWith('+++') || raw.startsWith('---')) continue
      const text = /^[ +-]/.test(raw) ? raw.slice(1) : raw
      const name = declarationName(text)
      if (name) return name
    }
    return null
  } catch {
    return null
  }
}

export function countHunks(structuredPatch) {
  const hunks = arr(structuredPatch)
  let added = 0
  let removed = 0
  let counted = 0
  for (const h of hunks) {
    const lines = Array.isArray(h?.lines) ? h.lines : null
    if (!lines) continue
    counted++
    for (const l of lines) {
      if (typeof l !== 'string') continue
      if (l.startsWith('+')) added++
      else if (l.startsWith('-')) removed++
    }
  }
  return { hunks: hunks.length, counted, added, removed }
}
