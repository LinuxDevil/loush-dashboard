// Event grouping + per-tool-call summary renderers (FEATURE_OPPORTUNITIES 054).
//
// Raw transcript rows are close to useless in a timeline: a row that says "Edit" tells a reader
// nothing they did not already know. This module turns a tool-call record into a short, specific
// title ("Edit src/App.jsx"), a one-line summary, and a structured `detail` object — and collapses
// a flat event list into groups a human can scan.
//
// Honesty rules this module follows (same as the rest of lib/):
//   - Unknown is a value. An unrecognised tool gets a truthful generic summary that NAMES the tool
//     and says no renderer exists, rather than a plausible-sounding invented description.
//     firstEnclosingContext() returns null rather than a guess, because a reader will believe a
//     function name that is printed next to a diff, and a wrong one is worse than none.
//   - No silent caps. Every place a string or a list is cut reports the cut: `truncated: true`,
//     `omitted: n`, and for hunks a `counted` that differs from `hunks` when some were malformed.
//   - Never throws on a malformed record. Every entry point is total: garbage in, an honest
//     "unknown" object out.
//   - Pure. Records in, plain objects out. No fs, no network, no clock, no mutation of the input.
//
// ---------------------------------------------------------------------------------------------
// SECRET SAFETY — what we include from tool INPUT and why.
//
// Tool inputs routinely carry credentials: `Bash.command` may be `curl -H "Authorization: Bearer
// sk-..."` or `AWS_SECRET_ACCESS_KEY=... terraform apply`; a WebFetch URL may carry a signed query
// string; an Edit's new_string may be the .env line being written. Anything this module puts in
// `title`/`summary`/`detail` is expected to be rendered in a UI, logged, and possibly exported, so
// the rule is allowlist-by-shape, not blocklist-by-pattern (regex secret detection always misses):
//
//   INCLUDED — file paths; the tool name; a shell command's FIRST WORD plus its subcommand for a
//   known multiplexer binary (`git commit`, `npm test`); a URL's HOSTNAME only; search
//   patterns/queries (short, structured needles — truncated, and required to make Grep/WebSearch
//   rows meaningful at all); counts, lengths, line numbers, booleans, enum-ish flags; and the
//   KEY NAMES (never values) of an unrecognised tool's input.
//
//   EXCLUDED — the full command string and every argument after the subcommand (this also drops
//   leading `FOO=token cmd` env assignments, a common credential carrier); pipeline stages beyond
//   the first; Edit `old_string`/`new_string`; Write/NotebookEdit `content`; Task `prompt`;
//   WebFetch `prompt` and the URL path/query/fragment; TodoWrite item text; and every value of an
//   unrecognised tool's input. Where prose is dropped we report its size, so "wrote 1.2 KB" is
//   still available without the bytes themselves.

const MAX_NEEDLE = 48 // chars kept from a search pattern / query before truncation is reported
const MAX_PREVIEW = 120 // chars kept from assistant/user prose in a text group
const MAX_SCAN_LINE = 400 // declaration matching is skipped past this width, to bound regex work

const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v)
const str = v => (typeof v === 'string' ? v : null)
const arr = v => (Array.isArray(v) ? v : [])
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// Cut a string to `max`, reporting the cut instead of hiding it.
const clip = (s, max) => {
  const t = str(s)
  if (t == null) return { text: null, truncated: false, fullLength: 0 }
  if (t.length <= max) return { text: t, truncated: false, fullLength: t.length }
  return { text: t.slice(0, max) + '…', truncated: true, fullLength: t.length }
}

// Paths in transcripts are absolute and long. Keep the last two segments: enough to disambiguate
// (`sections/App.jsx` vs `lib/App.jsx`) without spending a whole timeline row on `/home/user/...`.
export const shortPath = p => {
  const s = str(p)
  if (!s) return null
  const parts = s.split(/[\\/]/).filter(Boolean)
  if (parts.length === 0) return s
  // A trailing separator is meaningful — `src/` reads as a directory, `src` reads as a file.
  const trailing = /[\\/]$/.test(s) ? '/' : ''
  return parts.slice(-2).join('/') + trailing
}

const bytes = n => {
  if (n == null) return null
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const countLines = s => (typeof s === 'string' ? (s === '' ? 0 : s.split('\n').length) : null)

// ---------------------------------------------------------------------------------------------
// Shell headlines
//
// `git` alone is a useless row title; `git commit` is a good one. A fixed set of binaries whose
// first positional argument is a subcommand gets two words, everything else gets one. This is the
// only place a shell command's text reaches the output, and it is bounded to those two tokens.
export const SUBCOMMAND_BINARIES = new Set([
  'git', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno', 'cargo', 'go', 'docker', 'docker-compose',
  'kubectl', 'gh', 'glab', 'pip', 'pip3', 'uv', 'poetry', 'brew', 'apt', 'apt-get', 'systemctl',
  'terraform', 'aws', 'gcloud', 'az', 'dotnet', 'nix', 'make', 'rustup', 'composer', 'gem',
  'bundle', 'swift', 'flutter', 'firebase', 'vercel', 'heroku', 'helm', 'gradle', 'mvn',
])

export function parseShellHeadline(command) {
  const s = str(command)
  if (!s || !s.trim()) return { headline: null, binary: null, subcommand: null, stages: 0 }
  // Split on pipeline/sequence operators and describe only the first stage. Later stages are
  // counted, never quoted — `| curl -H "Authorization: ..."` must not reach the UI.
  const stages = s.split(/\|\||&&|;|\||\n/).map(x => x.trim()).filter(Boolean)
  const first = stages[0] ?? ''
  // Drop leading `FOO=bar` env assignments outright. They are the single most likely place for a
  // token to sit on a command line, and the assignment tells a reader nothing anyway.
  const tokens = first.split(/\s+/).filter(Boolean)
  let i = 0
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++
  const rawBin = tokens[i]
  if (!rawBin) return { headline: null, binary: null, subcommand: null, stages: stages.length }
  const binary = rawBin.split(/[\\/]/).filter(Boolean).pop() ?? rawBin
  let subcommand = null
  if (SUBCOMMAND_BINARIES.has(binary)) {
    // Scan a few tokens, not just the next one, so `git -C /repo commit` still reads as
    // "git commit". Bounded to 4 tokens and to a subcommand-shaped word (no slashes, no quotes,
    // no `=`), which keeps free-form argument text — the part that can carry a secret — out.
    const stop = Math.min(tokens.length, i + 5)
    for (let j = i + 1; j < stop; j++) {
      const t = tokens[j]
      if (t.startsWith('-')) continue
      if (/^[A-Za-z][\w:.-]*$/.test(t)) { subcommand = t; break }
    }
  }
  return {
    headline: subcommand ? `${binary} ${subcommand}` : binary,
    binary,
    subcommand,
    stages: stages.length,
  }
}

// Hostname only. A URL's path and query are where signed tokens live (`?X-Amz-Signature=...`).
const urlHost = u => {
  const s = str(u)
  if (!s) return null
  const m = /^[a-zA-Z][\w+.-]*:\/\/([^/?#\s]+)/.exec(s.trim())
  if (m) return m[1].replace(/^[^@]*@/, '') // strip userinfo — that is a credential by definition
  const bare = /^([\w.-]+\.[a-zA-Z]{2,})(?:[/?#]|$)/.exec(s.trim())
  return bare ? bare[1] : null
}

// ---------------------------------------------------------------------------------------------
// firstEnclosingContext
//
// "Which function did this diff touch?" A unified-diff header often already answers it: git puts a
// heuristic context line after the closing `@@`. When it does not (or when the hunk came from a
// structuredPatch, which has no header text at all), we scan the hunk's own lines backwards for a
// plausible declaration.
//
// The hard requirement is NEVER to guess. Everything below either matches a declaration shape or
// returns null; there is no "closest identifier wins" fallback, because a name printed beside a
// diff is read as fact.
//
// Known limitation, stated rather than hidden: with only the hunk in hand we can see the nearest
// declaration TEXTUALLY INSIDE OR ABOVE the hunk's own lines. If a hunk contains no declaration
// and its header carries none, the true enclosing function lives above the hunk in a part of the
// file we were not given, and we return null instead of reaching for something else.

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

// Ordered: the first shape that matches wins. Each entry returns a name or null.
const DECLARATION_PATTERNS = [
  // Go method with a receiver: `func (s *Server) Handle(w http.ResponseWriter) {` → Server.Handle
  {
    re: /^\s*func\s*\(\s*\w+\s+[*]?(\w+)\s*\)\s*([A-Za-z_]\w*)\s*\(/,
    pick: m => `${m[1]}.${m[2]}`,
  },
  // function / def / fn / func / sub — JS, TS, Python, Rust, Go, PHP.
  {
    re: new RegExp(`^\\s*${MODIFIERS}(?:async\\s+)?(?:function\\s*\\*?|def|fn|func|sub)\\s+([A-Za-z_$][\\w$]*)`),
    pick: m => m[1],
  },
  // class / struct / enum / trait / interface / impl / record / type — JS, TS, Python, Go, Rust, Java.
  {
    re: new RegExp(`^\\s*${MODIFIERS}(?:class|struct|enum|trait|interface|impl|record|namespace|module|type)(?:<[^>]*>)?\\s+([A-Za-z_$][\\w$]*)`),
    pick: m => m[1],
  },
  // JS/TS function assigned to a binding: `export const useThing = (a) => {`, `const f = function(`
  {
    re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s+)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=>)/,
    pick: m => m[1],
  },
  // Java-style method: at least one modifier, an optional return type, then `name(`.
  {
    re: /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|native|strictfp|default)\s+)+(?:[A-Za-z_$][\w$.<>,\[\]\s]*\s+)?([A-Za-z_$][\w$]*)\s*\(/,
    pick: m => m[1],
  },
  // Class-body / object-literal method shorthand: indented, ends in `{`, no `=` or `;`.
  // Deliberately strict — an unindented or unbraced line is more likely a call than a definition.
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

// Accepts: a raw hunk string (with or without an `@@ ... @@ context` header), an array of lines,
// or a structuredPatch hunk object `{ oldStart, lines, header? }`.
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
      // A context (' '), added ('+') or removed ('-') line all describe real file text; strip the
      // marker and match against the code itself.
      const text = /^[ +-]/.test(raw) ? raw.slice(1) : raw
      const name = declarationName(text)
      if (name) return name
    }
    return null
  } catch {
    return null
  }
}

// {hunks, counted, added, removed}. `counted` differs from `hunks` when some entries had no usable
// `lines` array — a malformed hunk is reported, not silently skipped.
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

// ---------------------------------------------------------------------------------------------
// summarizeToolCall

const unknownResult = (reason, extra = {}) => ({
  title: 'Unknown event',
  summary: 'This record carries no recognisable tool call.',
  detail: { reason, ...extra },
  kind: 'unknown',
})

// Pull the tool_use block out of whatever shape the caller had: the block itself, a transcript
// record with `message.content[]`, or a bare `{content:[]}`.
export function extractToolUseBlock(record) {
  if (!isObj(record)) return null
  if (record.type === 'tool_use' && str(record.name)) return record
  if (str(record.name) && isObj(record.input) && !record.type) return record
  const content = isObj(record.message) ? record.message.content : record.content
  for (const b of arr(content)) {
    if (isObj(b) && b.type === 'tool_use' && str(b.name)) return b
  }
  return null
}

const needle = (v, label) => {
  const c = clip(v, MAX_NEEDLE)
  return c.text == null ? null : { label, ...c }
}

const RENDERERS = {
  Read: input => {
    const p = shortPath(input.file_path ?? input.path ?? input.notebook_path)
    const offset = num(input.offset)
    const limit = num(input.limit)
    const range = offset != null || limit != null
      ? ` (from line ${offset ?? 1}${limit != null ? `, ${limit} lines` : ''})`
      : ''
    return {
      kind: 'read',
      title: p ? `Read ${p}` : 'Read',
      summary: p ? `Read ${p}${range}.` : 'Read a file; no path was recorded on the call.',
      detail: { path: input.file_path ?? input.path ?? null, offset, limit },
    }
  },

  Edit: input => {
    const p = shortPath(input.file_path ?? input.path)
    // Lengths only — old_string/new_string are file content and may be the secret being edited.
    const oldLen = typeof input.old_string === 'string' ? input.old_string.length : null
    const newLen = typeof input.new_string === 'string' ? input.new_string.length : null
    const delta = oldLen != null && newLen != null ? newLen - oldLen : null
    const all = input.replace_all === true
    const parts = []
    if (delta != null) parts.push(delta === 0 ? 'same length' : `${delta > 0 ? '+' : ''}${delta} chars`)
    if (all) parts.push('all occurrences')
    return {
      kind: 'edit',
      title: p ? `Edit ${p}` : 'Edit',
      summary: p
        ? `Edited ${p}${parts.length ? ` (${parts.join(', ')})` : ''}.`
        : 'Edited a file; no path was recorded on the call.',
      detail: {
        path: input.file_path ?? input.path ?? null,
        oldLength: oldLen,
        newLength: newLen,
        delta,
        replaceAll: all,
      },
    }
  },

  MultiEdit: input => {
    const p = shortPath(input.file_path ?? input.path)
    const n = arr(input.edits).length
    return {
      kind: 'edit',
      title: p ? `MultiEdit ${p}` : 'MultiEdit',
      summary: p ? `Applied ${n} edit${n === 1 ? '' : 's'} to ${p}.` : `Applied ${n} edits; no path recorded.`,
      detail: { path: input.file_path ?? input.path ?? null, edits: n },
    }
  },

  Write: input => {
    const p = shortPath(input.file_path ?? input.path)
    const len = typeof input.content === 'string' ? input.content.length : null
    const lines = countLines(input.content)
    const size = len != null ? ` (${lines} line${lines === 1 ? '' : 's'}, ${bytes(len)})` : ''
    return {
      kind: 'write',
      title: p ? `Write ${p}` : 'Write',
      summary: p ? `Wrote ${p}${size}.` : 'Wrote a file; no path was recorded on the call.',
      detail: { path: input.file_path ?? input.path ?? null, contentLength: len, contentLines: lines },
    }
  },

  Bash: input => {
    const { headline, binary, subcommand, stages } = parseShellHeadline(input.command)
    const desc = clip(input.description, MAX_PREVIEW) // agent-authored label, not the command
    const extraStages = Math.max(0, stages - 1)
    const tail = extraStages ? ` ${extraStages} further pipeline stage${extraStages === 1 ? '' : 's'} not shown.` : ''
    return {
      kind: 'shell',
      title: headline ? `Bash ${headline}` : 'Bash',
      summary: headline
        ? `Ran a shell command (${headline}); arguments withheld.${tail}`
        : 'Ran a shell command; no command text was recorded on the call.',
      detail: {
        binary,
        subcommand,
        headline,
        pipelineStages: stages,
        stagesOmitted: extraStages,
        argumentsWithheld: true,
        background: input.run_in_background === true,
        description: desc.text,
        descriptionTruncated: desc.truncated,
      },
    }
  },

  Grep: input => {
    const pat = needle(input.pattern, 'pattern')
    const where = shortPath(input.path) ?? (str(input.path) ? input.path : null)
    const scope = where ? ` in ${where}` : ''
    return {
      kind: 'search',
      title: pat ? `Grep "${pat.text}"${scope}` : 'Grep',
      summary: pat
        ? `Searched${scope || ' the working directory'} for ${JSON.stringify(pat.text)}${pat.truncated ? ' (pattern truncated for display)' : ''}.`
        : 'Ran a content search; no pattern was recorded on the call.',
      detail: {
        pattern: pat?.text ?? null,
        patternTruncated: pat?.truncated ?? false,
        path: input.path ?? null,
        glob: str(input.glob) ?? null,
        outputMode: str(input.output_mode) ?? null,
        caseInsensitive: input['-i'] === true,
      },
    }
  },

  Glob: input => {
    const pat = needle(input.pattern, 'pattern')
    const where = shortPath(input.path)
    return {
      kind: 'search',
      title: pat ? `Glob ${pat.text}${where ? ` in ${where}` : ''}` : 'Glob',
      summary: pat
        ? `Listed files matching ${JSON.stringify(pat.text)}${where ? ` under ${where}` : ''}.`
        : 'Listed files by pattern; no pattern was recorded on the call.',
      detail: { pattern: pat?.text ?? null, patternTruncated: pat?.truncated ?? false, path: input.path ?? null },
    }
  },

  Task: input => {
    const agent = str(input.subagent_type)
    const desc = clip(input.description, MAX_PREVIEW) // short agent-authored label; prompt excluded
    const label = agent ?? desc.text
    return {
      kind: 'agent',
      title: label ? `Task ${label}` : 'Task',
      summary: agent
        ? `Delegated to the ${agent} subagent${desc.text ? `: ${desc.text}` : ''}.`
        : desc.text
          ? `Delegated to a subagent: ${desc.text}.`
          : 'Delegated to a subagent; neither agent type nor description was recorded.',
      detail: {
        subagentType: agent,
        description: desc.text,
        descriptionTruncated: desc.truncated,
        promptWithheld: typeof input.prompt === 'string',
        promptLength: typeof input.prompt === 'string' ? input.prompt.length : null,
      },
    }
  },

  WebFetch: input => {
    const host = urlHost(input.url)
    return {
      kind: 'web',
      title: host ? `WebFetch ${host}` : 'WebFetch',
      summary: host
        ? `Fetched a page from ${host}; the full URL and the prompt are withheld.`
        : 'Fetched a web page; no usable URL was recorded on the call.',
      detail: { host, urlWithheld: typeof input.url === 'string', promptWithheld: typeof input.prompt === 'string' },
    }
  },

  WebSearch: input => {
    const q = needle(input.query, 'query')
    return {
      kind: 'web',
      title: q ? `WebSearch "${q.text}"` : 'WebSearch',
      summary: q
        ? `Searched the web for ${JSON.stringify(q.text)}${q.truncated ? ' (query truncated for display)' : ''}.`
        : 'Searched the web; no query was recorded on the call.',
      detail: { query: q?.text ?? null, queryTruncated: q?.truncated ?? false },
    }
  },

  TodoWrite: input => {
    const todos = arr(input.todos)
    const tally = { completed: 0, in_progress: 0, pending: 0, other: 0 }
    for (const t of todos) {
      const s = str(t?.status)
      if (s && Object.prototype.hasOwnProperty.call(tally, s)) tally[s]++
      else tally.other++
    }
    const bits = [
      tally.completed ? `${tally.completed} done` : null,
      tally.in_progress ? `${tally.in_progress} in progress` : null,
      tally.pending ? `${tally.pending} pending` : null,
      tally.other ? `${tally.other} with an unrecognised status` : null,
    ].filter(Boolean)
    return {
      kind: 'todo',
      // Item text is free-form prose an agent may have pasted from anywhere — counts only.
      title: `TodoWrite ${todos.length} todo${todos.length === 1 ? '' : 's'}`,
      summary: todos.length
        ? `Updated the todo list: ${todos.length} item${todos.length === 1 ? '' : 's'}${bits.length ? ` (${bits.join(', ')})` : ''}. Item text withheld.`
        : 'Updated the todo list; it recorded no items.',
      detail: { total: todos.length, ...tally, itemTextWithheld: true },
    }
  },

  NotebookEdit: input => {
    const p = shortPath(input.notebook_path ?? input.file_path ?? input.path)
    const mode = str(input.edit_mode) ?? 'replace'
    const cellType = str(input.cell_type)
    const cellId = str(input.cell_id)
    const len = typeof input.new_source === 'string' ? input.new_source.length : null
    return {
      kind: 'notebook',
      title: p ? `NotebookEdit ${p}` : 'NotebookEdit',
      summary: p
        ? `${mode === 'insert' ? 'Inserted' : mode === 'delete' ? 'Deleted' : 'Replaced'} a ${cellType ?? 'notebook'} cell${cellId ? ` (${cellId})` : ''} in ${p}${len != null ? `, ${bytes(len)} of source` : ''}.`
        : 'Edited a notebook; no path was recorded on the call.',
      detail: { path: input.notebook_path ?? input.file_path ?? null, editMode: mode, cellType, cellId, sourceLength: len },
    }
  },
}

// Aliases for tools that are the same thing under a different name in older transcripts.
RENDERERS.Bash_tool = RENDERERS.Bash
RENDERERS.StrReplace = RENDERERS.Edit
RENDERERS.Agent = RENDERERS.Task

// The single per-call entry point. Returns {title, summary, detail, kind} for any input.
export function summarizeToolCall(record) {
  let block
  try {
    block = extractToolUseBlock(record)
  } catch {
    return unknownResult('extract-failed')
  }
  if (!block) return unknownResult(isObj(record) ? 'no-tool-use-block' : 'not-a-record')

  const name = str(block.name)
  if (!name) {
    return {
      title: 'Unnamed tool',
      summary: 'A tool call was recorded without a tool name, so it cannot be described.',
      detail: { reason: 'missing-tool-name' },
      kind: 'unknown',
    }
  }

  const input = isObj(block.input) ? block.input : {}
  const render = Object.prototype.hasOwnProperty.call(RENDERERS, name) ? RENDERERS[name] : null

  if (!render) {
    // Truthful generic. Names the tool and says plainly that no renderer exists — never invents a
    // description from the tool's name. Input KEYS are listed (they are schema, not data); values
    // are withheld because an unknown tool has unknown secret-carrying fields.
    const keys = Object.keys(input)
    const shown = keys.slice(0, 8)
    const omitted = keys.length - shown.length
    return {
      title: name,
      summary: `Ran the "${name}" tool. No per-tool summary renderer exists for it, so nothing more is known about what it did.`,
      detail: {
        tool: name,
        rendered: false,
        inputKeys: shown,
        inputKeysOmitted: omitted,
        inputValuesWithheld: true,
      },
      kind: 'unknown',
    }
  }

  try {
    const out = render(input)
    return { title: out.title, summary: out.summary, detail: out.detail ?? {}, kind: out.kind ?? 'unknown' }
  } catch {
    // A renderer that trips over a malformed input must not cost the caller the row.
    return {
      title: name,
      summary: `Ran the "${name}" tool. Its input could not be read, so no summary is available.`,
      detail: { tool: name, rendered: false, reason: 'renderer-failed' },
      kind: 'unknown',
    }
  }
}

// ---------------------------------------------------------------------------------------------
// groupEvents

const blocksOf = record => {
  const content = isObj(record?.message) ? record.message.content : record?.content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return arr(content).filter(isObj)
}

const resultIdOf = block => str(block?.tool_use_id) ?? str(block?.toolUseId) ?? str(block?.toolUseID)

// Which tool_use spawned this record's agent. `parentToolUseId` is the documented name, but real
// `subagents/agent-*.jsonl` files written by current Claude Code use `sourceToolUseID` instead —
// verified against transcripts on this machine. Both are read so nesting works either way.
const parentIdOf = rec =>
  str(rec?.parentToolUseId) ?? str(rec?.parent_tool_use_id) ??
  str(rec?.sourceToolUseID) ?? str(rec?.sourceToolUseId) ?? null

// Target used to decide whether two consecutive calls are "the same thing again": a file path for
// file tools, the shell headline for Bash, the pattern for search tools.
const targetOf = (name, detail) =>
  str(detail?.path) ?? str(detail?.headline) ?? str(detail?.pattern) ?? str(detail?.host) ??
  str(detail?.query) ?? str(detail?.subagentType) ?? null

const roleOf = record =>
  str(record?.message?.role) ?? (record?.type === 'user' ? 'user' : record?.type === 'assistant' ? 'assistant' : null)

/**
 * Collapse a flat transcript event list into readable groups.
 *
 * Returns:
 *   {
 *     groups,       // top-level groups, in first-seen order; subagent work nests in `children`
 *     unpaired,     // every tool_use with no matching tool_result — reported, never dropped
 *     orphans,      // subagent events whose parentToolUseId matched no tool_use we saw
 *     counts,       // { records, blocks, toolCalls, groups, malformed }
 *     truncated,    // null, or { limit, omitted } when opts.maxGroups cut the list
 *   }
 */
export function groupEvents(records, opts = {}) {
  const options = isObj(opts) ? opts : {}
  const collapse = options.collapse !== false
  const maxGroups = num(options.maxGroups)
  const includeText = options.includeText !== false

  const list = arr(records)
  const counts = { records: list.length, blocks: 0, toolCalls: 0, groups: 0, malformed: 0 }

  // Pass 1: index every tool_result by the tool_use_id it answers.
  const results = new Map()
  for (const rec of list) {
    if (!isObj(rec)) { counts.malformed++; continue }
    for (const b of blocksOf(rec)) {
      if (b.type !== 'tool_result') continue
      const id = resultIdOf(b) ?? resultIdOf(rec)
      if (!id) { counts.malformed++; continue }
      results.set(id, { block: b, record: rec })
    }
  }

  // Pass 2: build one item per interesting block.
  const items = []
  for (let i = 0; i < list.length; i++) {
    const rec = list[i]
    if (!isObj(rec)) continue
    const meta = {
      uuid: str(rec.uuid),
      parentUuid: str(rec.parentUuid),
      parentToolUseId: str(rec.parentToolUseId) ?? str(rec.parent_tool_use_id),
      isSidechain: rec.isSidechain === true,
      timestamp: str(rec.timestamp),
      index: i,
      role: roleOf(rec),
    }

    if (rec.type === 'system') {
      items.push({
        kind: 'system',
        tool: null,
        title: str(rec.subtype) ? `System: ${rec.subtype}` : 'System event',
        summary: str(rec.subtype) === 'compact_boundary'
          ? 'The conversation was compacted at this point.'
          : 'A system record was written at this point.',
        detail: { subtype: str(rec.subtype) },
        status: 'ok',
        meta,
      })
      continue
    }

    for (const b of blocksOf(rec)) {
      counts.blocks++
      if (b.type === 'tool_result') continue // consumed by pairing

      if (b.type === 'tool_use') {
        counts.toolCalls++
        const s = summarizeToolCall(b)
        const id = str(b.id) ?? str(rec.toolUseID)
        const paired = id ? results.get(id) : undefined
        const status = !paired ? 'running' : paired.block?.is_error === true ? 'error' : 'ok'
        const detail = { ...s.detail }

        // If the paired result carried a structuredPatch, fold in what it says about the change.
        // This is derived shape (counts + a declaration name), never the patch text itself.
        const tur = paired?.record?.toolUseResult
        const patch = isObj(tur) ? tur.structuredPatch : null
        if (Array.isArray(patch)) {
          detail.patch = countHunks(patch)
          detail.enclosingContext = firstEnclosingContext(patch[0] ?? null)
        }

        items.push({
          isToolUse: true,
          kind: s.kind,
          tool: str(b.name),
          title: s.title,
          summary: s.summary,
          detail,
          status,
          toolUseId: id,
          resultIsError: paired ? paired.block?.is_error === true : null,
          meta,
        })
        continue
      }

      if (!includeText) continue

      if (b.type === 'thinking' || b.type === 'redacted_thinking') {
        const text = str(b.thinking) ?? ''
        items.push({
          kind: 'thinking',
          tool: null,
          title: 'Thinking',
          summary: `${text.length} characters of extended thinking (not shown).`,
          detail: { length: text.length, redacted: b.type === 'redacted_thinking' },
          status: 'ok',
          meta,
        })
        continue
      }

      if (b.type === 'text') {
        const c = clip(b.text, MAX_PREVIEW)
        if (c.text == null || c.text.trim() === '') continue
        items.push({
          kind: 'text',
          tool: null,
          title: meta.role === 'user' ? 'User message' : 'Assistant message',
          summary: c.text,
          detail: { length: c.fullLength, truncated: c.truncated },
          status: 'ok',
          meta,
        })
        continue
      }

      // A block type we do not model. Named, not dropped.
      items.push({
        kind: 'unknown',
        tool: null,
        title: str(b.type) ? `Unrecognised block: ${b.type}` : 'Unrecognised block',
        summary: 'This content block has a type this build does not render.',
        detail: { blockType: str(b.type) },
        status: 'ok',
        meta,
      })
    }
  }

  // Pass 3: split subagent items away from the main thread by parentToolUseId.
  const knownToolUseIds = new Set(items.filter(it => it.toolUseId).map(it => it.toolUseId))
  const top = []
  const byParent = new Map()
  const orphans = []
  for (const it of items) {
    const pid = it.meta.parentToolUseId
    if (pid && knownToolUseIds.has(pid)) {
      if (!byParent.has(pid)) byParent.set(pid, [])
      byParent.get(pid).push(it)
    } else if (pid) {
      // The parent tool_use is not in this slice of the transcript. Keep the event visible at top
      // level, flagged, instead of nesting it under a parent we cannot prove exists.
      const flagged = { ...it, orphanParentToolUseId: pid }
      orphans.push({ toolUseId: it.toolUseId ?? null, tool: it.tool, title: it.title, index: it.meta.index, parentToolUseId: pid })
      top.push(flagged)
    } else {
      top.push(it)
    }
  }

  const built = collapseItems(top, collapse)

  // Attach each subagent's events under the Task (or whatever tool) that spawned them.
  const attach = groups => {
    for (const g of groups) {
      const kids = []
      for (const id of g.toolUseIds) {
        const bucket = byParent.get(id)
        if (bucket) kids.push(...collapseItems(bucket, collapse))
      }
      if (kids.length) {
        attach(kids)
        g.children = kids
      }
    }
  }
  attach(built)

  // Every tool_use without a result is reported. Two distinct reasons, because they mean different
  // things to a reader: "still running / result not in this slice" vs "this record can never be
  // paired because it carries no id at all".
  const unpaired = []
  for (const it of items) {
    if (!it.isToolUse) continue
    if (!it.toolUseId) {
      unpaired.push({ toolUseId: null, tool: it.tool, title: it.title, index: it.meta.index, reason: 'missing-tool-use-id' })
    } else if (it.status === 'running') {
      unpaired.push({ toolUseId: it.toolUseId, tool: it.tool, title: it.title, index: it.meta.index, reason: 'no-tool-result' })
    }
  }

  let groups = built
  let truncated = null
  if (maxGroups != null && maxGroups >= 0 && built.length > maxGroups) {
    groups = built.slice(0, maxGroups)
    truncated = { limit: maxGroups, omitted: built.length - maxGroups }
  }
  counts.groups = built.length

  return { groups, unpaired, orphans, counts, truncated }
}

// Consecutive items of the same kind+tool+target become one group carrying a count. Text and
// thinking never merge — two assistant messages are two events, not one repeated one.
function collapseItems(items, collapse) {
  const out = []
  for (const it of items) {
    const target = it.tool ? targetOf(it.tool, it.detail) : null
    const prev = out[out.length - 1]
    const mergeable =
      collapse && prev && it.tool && prev.tool === it.tool && prev.target === target && target != null
    if (mergeable) {
      prev.count++
      prev.items.push(it)
      if (it.toolUseId) prev.toolUseIds.push(it.toolUseId)
      prev.status = prev.status === it.status ? prev.status : 'mixed'
      prev.summary = `${prev.count} consecutive ${it.tool} calls on ${target}.`
      prev.lastIndex = it.meta.index
      continue
    }
    out.push({
      kind: it.kind,
      tool: it.tool,
      target,
      title: it.title,
      summary: it.summary,
      detail: it.detail,
      status: it.status,
      count: 1,
      toolUseIds: it.toolUseId ? [it.toolUseId] : [],
      items: [it],
      children: [],
      firstIndex: it.meta.index,
      lastIndex: it.meta.index,
      isSidechain: it.meta.isSidechain,
      parentToolUseId: it.meta.parentToolUseId ?? null,
      orphanParentToolUseId: it.orphanParentToolUseId ?? null,
      timestamp: it.meta.timestamp,
    })
  }
  return out
}
