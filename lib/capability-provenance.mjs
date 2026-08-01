
import YAML from 'yaml'

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

export const HEAD_SCAN_LINES = 40
export const MAX_SCAN_BYTES = 256 * 1024
export const OFF_SUFFIX = '.off'

const str = v => (typeof v === 'string' ? v : '')
const posix = p => str(p).replaceAll('\\', '/')
const segments = p => posix(p).split('/').filter(Boolean)

const stripSuffixes = base => {
  let b = str(base)
  if (b.endsWith(OFF_SUFFIX)) b = b.slice(0, -OFF_SUFFIX.length)
  if (b.endsWith('.md')) b = b.slice(0, -3)
  return b
}

/**
 * The name a file *should* declare, derived from its own path, per the KINDS layout.
 * skills → the directory holding SKILL.md; commands/agents → the basename.
 * Returns null when the path gives us nothing to compare against — unknown, not a guess.
 */
export function expectedNameFromPath(file, kind) {
  const segs = segments(file)
  if (!segs.length) return null
  const base = stripSuffixes(segs[segs.length - 1])
  if (kind === 'skills') {
    if (segs.length < 2) return null
    if (base.toUpperCase() !== 'SKILL') return null
    let dir = segs[segs.length - 2]
    if (dir.endsWith(OFF_SUFFIX)) dir = dir.slice(0, -OFF_SUFFIX.length)
    return dir || null
  }
  return base || null
}

/**
 * The namespaced address Claude Code uses for a flat-kind file, e.g. `sc/implement.md` under
 * `~/.claude/commands` → `sc:implement`. `scopeDir` is the kind's root; without it we cannot
 * know how much of the path is namespace, so only the leaf is returned.
 */
export function namespacedName(file, kind, scopeDir) {
  const segs = segments(file)
  if (!segs.length) return null
  if (kind === 'skills') return expectedNameFromPath(file, kind)
  const root = segments(scopeDir)
  const under = root.length && segs.length > root.length && root.every((s, i) => segs[i] === s)
  const rel = under ? segs.slice(root.length) : [segs[segs.length - 1]]
  rel[rel.length - 1] = stripSuffixes(rel[rel.length - 1])
  return rel.filter(Boolean).join(':') || null
}

const slug = s => str(s).trim().toLowerCase().replace(/[\s_]+/g, '-')

const FM_DELIM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * `server/index.mjs`'s parseFM, re-stated so this module can be exercised without a server.
 * Total: never throws, and a YAML error surfaces as `_parse_error` exactly as it does there.
 */
export function parseFrontmatter(src) {
  const s = str(src)
  const m = FM_DELIM.exec(s)
  if (!m) return { fm: {}, body: s, delimited: false, raw: null }
  let fm = {}
  try { fm = YAML.parse(m[1]) || {} } catch (e) { fm = { _parse_error: e?.message || String(e) } }
  return { fm, body: s.slice(m[0].length), delimited: true, raw: m[1] }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

export const SUPERCLAUDE_SKILLS = ['brainstorm', 'confidence-check', 'deep-research', 'pm', 'token-efficiency', 'troubleshoot']

const SUPERCLAUDE_AGENT_BANNER = /^>\s*\*\*Context Framework Note\*\*:/m

const ev = (code, strength, detail) => ({ code, strength, detail })

/**
 * Signature table. Each entry is `{ id, name, attributing(ctx) -> evidence[], corroborating(ctx) -> evidence[] }`.
 * Exported so a caller can see exactly what is being matched — and so adding a framework is data,
 * not control flow.
 */
export const FRAMEWORK_SIGNATURES = [
  {
    id: 'superclaude',
    name: 'SuperClaude',
    attributing({ segs, fm, content, kind }) {
      const out = []
      const ci = segs.indexOf('commands')
      if (ci >= 0 && segs[ci + 1] === 'sc') out.push(ev('path:commands/sc', 'strong', 'file sits under commands/sc/, where `superclaude install` copies its 30 commands'))
      if (SUPERCLAUDE_AGENT_BANNER.test(str(content))) out.push(ev('body:context-framework-note', 'strong', 'body carries SuperClaude\'s "> **Context Framework Note**:" banner'))
      const si = segs.indexOf('skills')
      if (si >= 0 && SUPERCLAUDE_SKILLS.includes(slug(segs[si + 1] || '').replace(OFF_SUFFIX, '')))
        out.push(ev('path:skill-name', 'weak', `skill directory "${segs[si + 1]}" is one of SuperClaude's six installable skills, but a hand-written skill could use the same name`))
      if (kind !== 'skills' && isPlainObject(fm)) {
        const keys = Object.keys(fm).filter(k => k !== '_parse_error')
        if (keys.includes('category') && keys.length <= 3 && keys.every(k => ['name', 'description', 'category'].includes(k)))
          out.push(ev('fm:name-description-category', 'weak', 'frontmatter is exactly name/description/category, SuperClaude\'s agent shape'))
      }
      return out
    },
    corroborating({ settings, presentPaths }) {
      const out = []
      const plugins = isPlainObject(settings?.enabledPlugins) ? settings.enabledPlugins : {}
      for (const [key, on] of Object.entries(plugins))
        if (on && slug(key).startsWith('superclaude'))
          out.push(ev('settings:enabledPlugins', 'corroborating', `settings.json enables the plugin "${key}"`))
      for (const p of presentPaths)
        if (posix(p).includes('/.superclaude/'))
          out.push(ev('path-present:.superclaude', 'corroborating', `${p} exists, so the SuperClaude installer has run on this machine`))
      return out
    },
  },
]

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * A marketplace plugin's own directory *is* its provenance — `~/.claude/plugins/<plugin>@<market>/…`
 * — so this is derived from the path rather than listed in the table above, and covers every
 * plugin including ones we have never heard of.
 */
function pluginFromPath(segs) {
  const i = segs.indexOf('plugins')
  if (i < 0) return null
  for (const seg of segs.slice(i + 1, i + 3)) {
    const m = /^([^@/]+)@([^@/]+)$/.exec(seg)
    if (m) return { id: `plugin:${m[1]}@${m[2]}`, name: m[1], marketplace: m[2] }
  }
  return null
}

/**
 * Framework attribution for one capability file. Pure — it reads no filesystem; `opts.presentPaths`
 * is how a caller feeds in paths it has already stat'ed (e.g. `~/.superclaude/airis-mcp-gateway/`).
 *
 * @param {string} file        path to the capability file (SKILL.md, or <name>.md)
 * @param {object} frontmatter parsed frontmatter (may be `{}`, may carry `_parse_error`)
 * @param {string} content     the file's full text
 * @param {object} [opts]      { kind, settings, presentPaths, provenance }
 *                             `provenance` is a parsed `.openskills.json` sidecar, if one exists.
 * @returns {{framework:string, name:string, confidence:'high'|'medium'|'low', basis:object[]}|null}
 *          null means "we do not know", which is a real answer and must be rendered as one.
 */
export function detectFramework(file, frontmatter, content, opts = {}) {
  try {
    const segs = segments(file)
    const ctx = {
      segs,
      fm: isPlainObject(frontmatter) ? frontmatter : {},
      content: str(content).slice(0, MAX_SCAN_BYTES),
      kind: opts.kind ?? null,
      settings: isPlainObject(opts.settings) ? opts.settings : null,
      presentPaths: Array.isArray(opts.presentPaths) ? opts.presentPaths.filter(p => typeof p === 'string') : [],
    }

    const prov = isPlainObject(opts.provenance) ? opts.provenance : null
    const provSource = str(prov?.source || prov?.repo || prov?.origin).trim()
    if (provSource) {
      return {
        framework: `sidecar:${provSource}`,
        name: provSource,
        confidence: 'high',
        basis: [ev('sidecar:.openskills.json', 'strong', `an installed-by sidecar records source "${provSource}"`)],
      }
    }

    const plugin = pluginFromPath(segs)
    if (plugin) {
      return {
        framework: plugin.id,
        name: plugin.name,
        confidence: 'high',
        basis: [ev('path:plugins/<plugin>@<marketplace>', 'strong', `file lives inside the marketplace plugin directory "${plugin.name}@${plugin.marketplace}"`)],
      }
    }

    let best = null
    for (const sig of FRAMEWORK_SIGNATURES) {
      let attributing = []
      let corroborating = []
      try { attributing = sig.attributing(ctx) || [] } catch { attributing = [] }
      try { corroborating = sig.corroborating(ctx) || [] } catch { corroborating = [] }
      const strong = attributing.filter(e => e.strength === 'strong')
      const weak = attributing.filter(e => e.strength === 'weak')

      let confidence = null
      if (strong.length) confidence = 'high'
      else if (weak.length >= 2) confidence = 'medium'
      else if (weak.length === 1 && corroborating.length) confidence = 'low'
      if (!confidence) continue

      const basis = [...strong, ...weak, ...(confidence === 'high' ? [] : corroborating)]
      const cand = { framework: sig.id, name: sig.name, confidence, basis }
      if (!best || RANK[cand.confidence] > RANK[best.confidence]) best = cand
    }
    return best
  } catch {
    return null
  }
}

const RANK = { low: 1, medium: 2, high: 3 }

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

export const SEVERITIES = ['error', 'warn', 'info']

const finding = (severity, code, message, fix, extra = {}) => ({ severity, code, message, fix, ...extra })

const YAML_KEY_LINE = /^[A-Za-z_][\w.-]*\s*:(?:\s|$)/
const FENCE_LINE = /^\s{0,3}(?:```|~~~)/

/**
 * Lint one capability file's frontmatter.
 *
 * @param {string} rawContent the file's text. Any type is accepted; a non-string is a finding.
 * @param {object} [ctx]      { file, kind } — used for the filename/`name:` agreement checks.
 * @returns {{ok:boolean, findings:object[], fm:object|null, delimited:boolean, limits:object}}
 *          `ok` is "no error-severity finding". `fm` is null when nothing parsed.
 */
export function lintFrontmatter(rawContent, ctx = {}) {
  const limits = { headScanLines: HEAD_SCAN_LINES, maxScanBytes: MAX_SCAN_BYTES, truncated: false }
  const findings = []
  const file = str(ctx?.file)
  const kind = ctx?.kind ?? null

  if (typeof rawContent !== 'string') {
    findings.push(finding('error', 'FM_UNREADABLE',
      `File content is ${rawContent === null ? 'null' : typeof rawContent}, not text — nothing could be checked.`,
      'Confirm the file exists and is UTF-8 text.'))
    return { ok: false, findings, fm: null, delimited: false, limits }
  }

  let src = rawContent
  if (src.length > MAX_SCAN_BYTES) {
    src = src.slice(0, MAX_SCAN_BYTES)
    limits.truncated = true
    findings.push(finding('info', 'FM_SCAN_TRUNCATED',
      `Only the first ${MAX_SCAN_BYTES} bytes were inspected; the file is ${rawContent.length} bytes.`,
      'Frontmatter lives at the top of the file, so this rarely changes the result.'))
  }

  if (src.charCodeAt(0) === 0xfeff) {
    findings.push(finding('error', 'FM_BOM_BEFORE_DELIMITER',
      'The file starts with a UTF-8 byte-order mark, so the opening `---` is not the first thing on line 1 and the frontmatter block is not recognised.',
      'Re-save the file as UTF-8 without a BOM.'))
    src = src.slice(1)
  }

  const parsed = parseFrontmatter(src)
  const lines = src.split(/\r?\n/)
  const head = lines.slice(0, HEAD_SCAN_LINES)

  if (!parsed.delimited) {
    const firstFence = head.findIndex(l => FENCE_LINE.test(l))
    const firstDelim = head.findIndex(l => /^---[ \t]*$/.test(l))
    const firstContent = head.findIndex(l => l.trim() !== '')

    if (firstFence >= 0 && firstDelim > firstFence) {
      findings.push(finding('error', 'FM_IN_CODE_FENCE',
        `The frontmatter block is inside a code fence opened on line ${firstFence + 1}, so it is documentation, not metadata. Claude Code loads the whole file as prompt text and never sees the \`description\`.`,
        'Delete the fence lines so the `---` block starts on line 1 of the file.',
        { line: firstFence + 1 }))
    } else if (firstDelim > 0 && head.slice(0, firstDelim).some(l => YAML_KEY_LINE.test(l))) {
      findings.push(finding('error', 'FM_MISSING_OPEN_DELIMITER',
        `YAML keys appear before the first \`---\` (line ${firstDelim + 1}) with no opening delimiter above them, so the block never parses as frontmatter. Claude Code treats those lines as the first lines of the prompt.`,
        'Add a `---` line at the very top of the file, above the first key.',
        { line: 1 }))
    } else if (firstContent >= 0 && /^---[ \t]*$/.test(head[firstContent]) && firstContent > 0) {
      findings.push(finding('error', 'FM_DELIMITER_NOT_FIRST_LINE',
        `The opening \`---\` is on line ${firstContent + 1}; the loader only matches it at the very start of the file.`,
        'Remove the blank lines above the opening `---`.',
        { line: firstContent + 1 }))
    } else if (/^---[ \t]*$/.test(lines[0] || '') && /^---[ \t]*$/.test(lines[1] || '')) {
      findings.push(finding('error', 'FM_EMPTY_BLOCK',
        'The file opens with two consecutive `---` lines and no keys between them, which does not match as a frontmatter block at all.',
        'Put the keys between the delimiters, starting with `description:`.',
        { line: 1 }))
    } else if (/^---[ \t]*$/.test(lines[0] || '')) {
      findings.push(finding('error', 'FM_UNCLOSED',
        'The file opens with `---` but no closing `---` was found, so the block is not frontmatter and the whole file is read as prompt text.',
        'Add a closing `---` line after the last key.',
        { line: 1 }))
    } else {
      findings.push(finding('warn', 'FM_ABSENT',
        'No YAML frontmatter. Without a `description` this capability has nothing to match on when Claude Code decides whether to load it.',
        'Add a `---` block at the top with at least `description:`.'))
    }
    return { ok: !findings.some(f => f.severity === 'error'), findings, fm: null, delimited: false, limits }
  }

  const fm = parsed.fm
  if (isPlainObject(fm) && typeof fm._parse_error === 'string') {
    const tabbed = /^\t| \t|\n\t/.test(parsed.raw || '')
    findings.push(finding('error', 'FM_PARSE_ERROR',
      `The frontmatter block is not valid YAML (${fm._parse_error}), so every key in it is lost and the file loads as plain prompt text.`,
      tabbed
        ? 'The block contains a tab character — YAML forbids tabs for indentation. Replace tabs with spaces.'
        : 'Fix the YAML; unquoted values containing `:` are the usual cause.'))
    return { ok: false, findings, fm: null, delimited: true, limits }
  }
  if (!isPlainObject(fm)) {
    findings.push(finding('error', 'FM_NOT_MAPPING',
      `The frontmatter parsed as ${Array.isArray(fm) ? 'a list' : typeof fm}, not a set of key/value pairs, so there are no fields to read.`,
      'Write the block as `key: value` lines.'))
    return { ok: false, findings, fm: null, delimited: true, limits }
  }
  if (!Object.keys(fm).length) {
    findings.push(finding('warn', 'FM_EMPTY',
      'The frontmatter block is present but empty, so it contributes nothing — same practical effect as having none.',
      'Add at least `description:`.'))
  }

  const expected = expectedNameFromPath(file, kind)
  const declared = typeof fm.name === 'string' ? fm.name.trim() : null
  if (expected && declared) {
    if (declared !== expected) {
      const equivalent = slug(declared) === slug(expected)
      findings.push(equivalent
        ? finding('info', 'FM_NAME_NOT_SLUG',
            `\`name: ${declared}\` is a prose form of the ${kind === 'skills' ? 'directory' : 'file'} name "${expected}". They resolve to the same slug, but the two spellings will not compare equal anywhere they are joined by name.`,
            `Set \`name: ${expected}\` to match the path exactly.`,
            { declared, expected })
        : finding('warn', 'FM_NAME_MISMATCH',
            `\`name: ${declared}\` disagrees with the ${kind === 'skills' ? 'directory' : 'file'} name "${expected}". The path wins — this capability is invoked as "${expected}".`,
            `Rename the ${kind === 'skills' ? 'directory' : 'file'} to "${declared}", or set \`name: ${expected}\`.`,
            { declared, expected }))
    }
  } else if (expected && fm.name != null && typeof fm.name !== 'string') {
    findings.push(finding('warn', 'FM_NAME_NOT_STRING',
      `\`name\` is ${Array.isArray(fm.name) ? 'a list' : typeof fm.name}, not text, so it cannot be compared with the filename "${expected}".`,
      `Quote it: \`name: "${expected}"\`.`))
  }

  return { ok: !findings.some(f => f.severity === 'error'), findings, fm, delimited: true, limits }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

export const MCP_KEYS = ['mcp-servers', 'mcpServers', 'mcp_servers', 'mcp']
export const AGENT_KEYS = ['personas', 'agents', 'subagents', 'sub-agents']
export const EMPTY_DECLARATIONS = ['none', 'n/a', 'na', '-', 'null']

export function normalizeDependencyName(name) {
  let s = str(name).trim().toLowerCase().replace(/^mcp__/, '')
  const idx = s.indexOf('__')
  if (idx > 0) s = s.slice(0, idx)
  return s.replace(/[\s_]+/g, '-')
}

function collect(fm, keys, out) {
  for (const key of keys) {
    if (!(key in fm)) continue
    const raw = fm[key]
    if (raw == null) { out.sources.push({ key, empty: true }); continue }
    const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,;]/) : [raw]
    let took = 0
    for (const item of items) {
      let name = null
      if (typeof item === 'string') name = item.trim()
      else if (typeof item === 'number' || typeof item === 'boolean') name = String(item)
      else if (isPlainObject(item)) name = str(item.name || item.server || item.id).trim() || null
      if (!name) { out.unparsed.push({ key, value: item, reason: 'no name could be read from this entry' }); continue }
      if (EMPTY_DECLARATIONS.includes(name.toLowerCase())) {
        out.ignored.push({ key, value: name, reason: 'placeholder meaning "no dependencies"' })
        continue
      }
      if (out.names.some(n => normalizeDependencyName(n) === normalizeDependencyName(name))) continue
      out.names.push(name)
      took++
    }
    out.sources.push({ key, count: took })
  }
}

/**
 * Read the dependencies a capability declares in its frontmatter.
 *
 * @param {object} frontmatter parsed frontmatter; anything non-object yields empty lists.
 * @returns {{mcpServers:string[], agents:string[], declared:boolean, sources:object, unparsed:object[], ignored:object[]}}
 *          `declared` is false when the file says nothing at all — distinct from declaring `[]`,
 *          which is an author stating there are no dependencies.
 */
export function declaredDependencies(frontmatter) {
  const empty = { mcpServers: [], agents: [], declared: false, sources: { mcpServers: [], agents: [] }, unparsed: [], ignored: [] }
  if (!isPlainObject(frontmatter)) return empty
  try {
    const mcp = { names: [], sources: [], unparsed: [], ignored: [] }
    const agents = { names: [], sources: [], unparsed: [], ignored: [] }
    collect(frontmatter, MCP_KEYS, mcp)
    collect(frontmatter, AGENT_KEYS, agents)
    return {
      mcpServers: mcp.names,
      agents: agents.names,
      declared: mcp.sources.length > 0 || agents.sources.length > 0,
      sources: { mcpServers: mcp.sources, agents: agents.sources },
      unparsed: [...mcp.unparsed, ...agents.unparsed],
      ignored: [...mcp.ignored, ...agents.ignored],
    }
  } catch {
    return empty
  }
}

const asList = v => (Array.isArray(v) ? v : v instanceof Set ? [...v] : null)

function diff(declaredNames, installedList) {
  const installed = asList(installedList)
  if (!installed) return { missing: null, satisfied: null, unknown: true }
  const have = new Set(installed.map(x => normalizeDependencyName(isPlainObject(x) ? x.name || x.id : x)).filter(Boolean))
  const missing = [], satisfied = []
  for (const n of declaredNames) (have.has(normalizeDependencyName(n)) ? satisfied : missing).push(n)
  return { missing, satisfied, unknown: false }
}

/**
 * Cross-check declared dependencies against what is actually installed.
 *
 * @param {object} declared  output of `declaredDependencies`, or any `{mcpServers, agents}` shape
 * @param {object} installed { mcpServers, agents } — arrays, Sets, or arrays of `{name}`.
 *                           Omit a side (or pass null) to say "we do not know" for it.
 * @returns {{missing:{mcpServers:string[]|null, agents:string[]|null}, satisfied:{...}, unknown:string[], ok:boolean|null}}
 *          `ok` is null when any side is unknown — not `true`, which would read as "checked, fine".
 */
export function checkDependencies(declared, installed) {
  const d = isPlainObject(declared) ? declared : {}
  const i = isPlainObject(installed) ? installed : {}
  const mcp = diff(Array.isArray(d.mcpServers) ? d.mcpServers : [], i.mcpServers)
  const agents = diff(Array.isArray(d.agents) ? d.agents : [], i.agents)
  const unknown = [...(mcp.unknown ? ['mcpServers'] : []), ...(agents.unknown ? ['agents'] : [])]
  return {
    missing: { mcpServers: mcp.missing, agents: agents.missing },
    satisfied: { mcpServers: mcp.satisfied, agents: agents.satisfied },
    unknown,
    ok: unknown.length ? null : !(mcp.missing.length || agents.missing.length),
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

/**
 * Run all three analyses over a single read of a capability file — the shape a Capability Ledger
 * row wants. Total: any malformed input comes back as findings and nulls, never a throw.
 *
 * @param {object} input { file, kind, content, scopeDir, settings, presentPaths, provenance, installed }
 * @returns {{name, file, kind, framework, lint, dependencies, dependencyCheck, enabled, limits}}
 */
export function analyzeCapability(input = {}) {
  const file = str(input?.file)
  const kind = input?.kind ?? null
  const content = typeof input?.content === 'string' ? input.content : ''
  const lint = lintFrontmatter(input?.content, { file, kind })
  const fm = lint.fm || {}
  const dependencies = declaredDependencies(fm)
  return {
    name: namespacedName(file, kind, input?.scopeDir) ?? expectedNameFromPath(file, kind),
    file,
    kind,
    enabled: !posix(file).split('/').some(s => s.endsWith(OFF_SUFFIX)),
    framework: detectFramework(file, fm, content, {
      kind,
      settings: input?.settings,
      presentPaths: input?.presentPaths,
      provenance: input?.provenance,
    }),
    lint,
    dependencies,
    dependencyCheck: checkDependencies(dependencies, input?.installed),
    limits: lint.limits,
  }
}
