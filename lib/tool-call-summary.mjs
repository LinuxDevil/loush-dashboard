import { isObj, str, arr, num } from './event-shared.mjs'

const MAX_NEEDLE = 48
export const MAX_PREVIEW = 120

const clip = (s, max) => {
  const t = str(s)
  if (t == null) return { text: null, truncated: false, fullLength: 0 }
  if (t.length <= max) return { text: t, truncated: false, fullLength: t.length }
  return { text: t.slice(0, max) + '…', truncated: true, fullLength: t.length }
}

export const shortPath = p => {
  const s = str(p)
  if (!s) return null
  const parts = s.split(/[\\/]/).filter(Boolean)
  if (parts.length === 0) return s
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
export const SUBCOMMAND_BINARIES = new Set([
  'git', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno', 'cargo', 'go', 'docker', 'docker-compose',
  'kubectl', 'gh', 'glab', 'pip', 'pip3', 'uv', 'poetry', 'brew', 'apt', 'apt-get', 'systemctl',
  'terraform', 'aws', 'gcloud', 'az', 'dotnet', 'nix', 'make', 'rustup', 'composer', 'gem',
  'bundle', 'swift', 'flutter', 'firebase', 'vercel', 'heroku', 'helm', 'gradle', 'mvn',
])

export function parseShellHeadline(command) {
  const s = str(command)
  if (!s || !s.trim()) return { headline: null, binary: null, subcommand: null, stages: 0 }
  const stages = s.split(/\|\||&&|;|\||\n/).map(x => x.trim()).filter(Boolean)
  const first = stages[0] ?? ''
  const tokens = first.split(/\s+/).filter(Boolean)
  let i = 0
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++
  const rawBin = tokens[i]
  if (!rawBin) return { headline: null, binary: null, subcommand: null, stages: stages.length }
  const binary = rawBin.split(/[\\/]/).filter(Boolean).pop() ?? rawBin
  let subcommand = null
  if (SUBCOMMAND_BINARIES.has(binary)) {
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

const urlHost = u => {
  const s = str(u)
  if (!s) return null
  const m = /^[a-zA-Z][\w+.-]*:\/\/([^/?#\s]+)/.exec(s.trim())
  if (m) return m[1].replace(/^[^@]*@/, '')
  const bare = /^([\w.-]+\.[a-zA-Z]{2,})(?:[/?#]|$)/.exec(s.trim())
  return bare ? bare[1] : null
}

const unknownResult = (reason, extra = {}) => ({
  title: 'Unknown event',
  summary: 'This record carries no recognisable tool call.',
  detail: { reason, ...extra },
  kind: 'unknown',
})

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
    const desc = clip(input.description, MAX_PREVIEW)
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
    const desc = clip(input.description, MAX_PREVIEW)
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

RENDERERS.Bash_tool = RENDERERS.Bash
RENDERERS.StrReplace = RENDERERS.Edit
RENDERERS.Agent = RENDERERS.Task

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
    return {
      title: name,
      summary: `Ran the "${name}" tool. Its input could not be read, so no summary is available.`,
      detail: { tool: name, rendered: false, reason: 'renderer-failed' },
      kind: 'unknown',
    }
  }
}

export { clip }
