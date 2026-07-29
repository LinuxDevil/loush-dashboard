// Capability provenance — features 115 (framework attribution), 116 (frontmatter linting) and
// 117 (declared dependencies), built as one module because all three read the same bytes.
//
// A capability is a markdown file with YAML frontmatter: skills live at `<dir>/<name>/SKILL.md`,
// commands and agents are `<dir>/<name>.md` and may be namespaced in subdirectories
// (`~/.claude/commands/sc/implement.md` is addressed as `sc:implement`). A disabled item carries
// a `.off` suffix. Those conventions are `server/index.mjs`'s (`parseFM`, `KINDS`, `walkFlatKind`);
// this module re-reads them rather than importing, so it stays pure and directly testable — but it
// must not disagree with them, and the delimiter regex below is deliberately the same one.
//
// The three questions, per capability file:
//
//   115  Who installed this?           detectFramework(file, fm, content, opts)
//   116  Is Claude Code even seeing     lintFrontmatter(raw, { file, kind })
//        the frontmatter?
//   117  What does it declare needing?  declaredDependencies(fm) + checkDependencies(...)
//
// `analyzeCapability()` at the bottom runs all three over one read, which is the shape the
// Capability Ledger wants for a row.
//
// House rules applied here:
//
//   1. "Unknown is a value." Framework attribution returns `null` when the evidence does not
//      identify a framework — including when the *only* evidence is weak. Mislabelling a
//      hand-written command as vendor-installed is worse than an empty cell: an empty cell makes
//      the reader look, a wrong label ends the question. Same rule in `checkDependencies`: if the
//      caller does not say what is installed, "missing" is `null`, never `[]`.
//   2. "No silent caps." Every bound this module applies (head-scan line count, byte ceiling) is
//      a named export and is reported back in the result under `limits`.
//   3. Nothing here throws on malformed input. Malformed frontmatter is the *thing being
//      detected* — a parser that dies on it is useless — so every entry point is total: bad
//      types, empty strings, `null`, binary junk all come back as findings or nulls.

import YAML from 'yaml'

// ---------------------------------------------------------------------------
// shared: paths, names, frontmatter block extraction
// ---------------------------------------------------------------------------

/** Line budget for the "is there frontmatter *near* the top?" scan in 116. Reported in `limits`. */
export const HEAD_SCAN_LINES = 40
/** Bytes of a file this module will inspect. Anything past this is not read; reported in `limits`. */
export const MAX_SCAN_BYTES = 256 * 1024
/** The disabled-item suffix, matching `OFF` in server/index.mjs. */
export const OFF_SUFFIX = '.off'

const str = v => (typeof v === 'string' ? v : '')
/** Windows paths and posix paths compare the same once separators are normalised. */
const posix = p => str(p).replaceAll('\\', '/')
const segments = p => posix(p).split('/').filter(Boolean)

/** Strip the `.off` disabled marker and the `.md` extension from a file's basename. */
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
    // `<dir>/<name>/SKILL.md`, or a bare `<name>/SKILL.md`; a `.off` may sit on either part.
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

/** lowercase / trim / spaces and underscores to dashes — for "same name, different styling". */
const slug = s => str(s).trim().toLowerCase().replace(/[\s_]+/g, '-')

// Byte-for-byte the delimiter regex in server/index.mjs's parseFM. Deliberately not "improved":
// if this were more permissive, the lint would call a file healthy that the loader in fact skips.
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
// 115 — framework attribution
// ---------------------------------------------------------------------------
//
// Evidence is split into two kinds, and the distinction is the whole design:
//
//   ATTRIBUTING evidence ties *this file* to a framework — it sits in a directory that
//   framework owns, or its body carries a banner that framework stamps on every file.
//
//   CORROBORATING evidence says only that the framework is installed on this machine — a
//   `settings.json` plugin entry, a gateway directory. It can raise confidence in an
//   attribution but can never create one: "SuperClaude is installed" is not a reason to
//   believe that *this* command came from it.
//
// Attributing evidence is `strong` (a path or marker no hand-written file lands on by accident)
// or `weak` (a name that a framework happens to use and a human might too — `pm`, `brainstorm`).
//
// The verdict ladder, and the reason for each rung:
//   >=1 strong                → 'high'   the path/marker is the provenance
//   >=2 weak                  → 'medium' two independent coincidences is not a coincidence
//    1 weak + corroborating   → 'low'    plausible and the framework is in fact installed
//   anything else             → null     including weak-alone and corroborating-alone
//
// 'high' is the ceiling: extra corroboration on top of a strong hit does not invent a new level.

/** SuperClaude's six installable skills (RESEARCH_MERGED.md, install_skill.py). Weak on their own. */
export const SUPERCLAUDE_SKILLS = ['brainstorm', 'confidence-check', 'deep-research', 'pm', 'token-efficiency', 'troubleshoot']

/** The banner SuperClaude stamps into its agent bodies. Strong: nothing else writes this. */
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
      // `superclaude install` copies commands to ~/.claude/commands/sc/ (install_commands.py).
      const ci = segs.indexOf('commands')
      if (ci >= 0 && segs[ci + 1] === 'sc') out.push(ev('path:commands/sc', 'strong', 'file sits under commands/sc/, where `superclaude install` copies its 30 commands'))
      if (SUPERCLAUDE_AGENT_BANNER.test(str(content))) out.push(ev('body:context-framework-note', 'strong', 'body carries SuperClaude\'s "> **Context Framework Note**:" banner'))
      // Its skills go to ~/.claude/skills/<name>/ under names a human could also pick.
      const si = segs.indexOf('skills')
      if (si >= 0 && SUPERCLAUDE_SKILLS.includes(slug(segs[si + 1] || '').replace(OFF_SUFFIX, '')))
        out.push(ev('path:skill-name', 'weak', `skill directory "${segs[si + 1]}" is one of SuperClaude's six installable skills, but a hand-written skill could use the same name`))
      // Its agent frontmatter is exactly name+description+category.
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

    // A provenance sidecar beats every heuristic: the installer wrote down where it came from.
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
      // weak-alone and corroborating-alone deliberately fall through to null: see the ladder above.
      if (!confidence) continue

      const basis = [...strong, ...weak, ...(confidence === 'high' ? [] : corroborating)]
      const cand = { framework: sig.id, name: sig.name, confidence, basis }
      if (!best || RANK[cand.confidence] > RANK[best.confidence]) best = cand
    }
    return best
  } catch {
    // Attribution must never be the reason a ledger row fails to render.
    return null
  }
}

const RANK = { low: 1, medium: 2, high: 3 }

// ---------------------------------------------------------------------------
// 116 — frontmatter linting
// ---------------------------------------------------------------------------
//
// What makes this worth a screen: a capability with broken frontmatter does not *look* broken.
// Claude Code's loader wants `---` on line 1; when it does not find it, the file still loads —
// as prompt text. The YAML the author wrote becomes three lines of prose in the model's context,
// the `description` never reaches the selector, and the capability is invisibly inert. Nothing
// errors, nothing warns, and the file reads fine to a human.
//
// The two shapes below (`FM_MISSING_OPEN_DELIMITER`, `FM_IN_CODE_FENCE`) are the ones found in
// the wild, in shipped framework files, and they are the fixtures the tests are built on.

/** Severity ordering, for callers that want to sort or threshold. */
export const SEVERITIES = ['error', 'warn', 'info']

const finding = (severity, code, message, fix, extra = {}) => ({ severity, code, message, fix, ...extra })

/** A line that could plausibly open a YAML mapping: `key:` or `key: value`, no leading space. */
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
    // Not a silent cap: the caller is told, in a finding, that it only saw the head.
    findings.push(finding('info', 'FM_SCAN_TRUNCATED',
      `Only the first ${MAX_SCAN_BYTES} bytes were inspected; the file is ${rawContent.length} bytes.`,
      'Frontmatter lives at the top of the file, so this rarely changes the result.'))
  }

  // A UTF-8 BOM before `---` defeats the loader's line-1 match just as surely as a blank line.
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
    // Nothing parsed. Work out *why*, because "no frontmatter" and "frontmatter Claude Code
    // cannot see" are completely different problems for the reader.
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
      // `---` immediately followed by `---`. The loader's block match needs at least one line
      // between the delimiters, so this is not an empty frontmatter block — it is no block.
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

  // A block was found. Did it parse, and does it agree with its own filename?
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

  // `name:` disagreeing with the filename. Claude Code addresses the capability by its path, so a
  // mismatched `name` is not a hard failure — it is a rename the author probably meant to make,
  // and a display name that will not match anything a user types.
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
// 117 — declared dependencies
// ---------------------------------------------------------------------------
//
// SuperClaude's command frontmatter carries `mcp-servers: []` and `personas: []`. Nothing native
// records this, and it is what turns a flat capability list into a graph — enabling both
// "this command declares `serena`, which you do not have" and MCP-level ROI ("you have `morphllm`
// installed; two commands reference it and neither has fired").
//
// Key spellings are accepted generously because the convention is de-facto, not specified; the key
// that actually matched is reported back in `sources` so the UI never has to guess which one the
// author used.

/** Frontmatter keys read as MCP-server dependencies, in precedence order. */
export const MCP_KEYS = ['mcp-servers', 'mcpServers', 'mcp_servers', 'mcp']
/** Frontmatter keys read as agent/persona dependencies, in precedence order. */
export const AGENT_KEYS = ['personas', 'agents', 'subagents', 'sub-agents']
/** Values that mean "declared, and the answer is none" rather than a dependency named "none". */
export const EMPTY_DECLARATIONS = ['none', 'n/a', 'na', '-', 'null']

/** Normalised form used only for comparison: `mcp__serena__find_symbol` and `Serena` both → `serena`. */
export function normalizeDependencyName(name) {
  // Order matters: the `__` separators have to be read before spaces/underscores collapse to `-`.
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
        // "none" is an author saying zero, not a server called none. Recorded, never silent.
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
  // No inventory supplied → we do not know what is missing. `null`, never `[]`: an empty array
  // would render as "all dependencies satisfied", which is a claim we have no basis for.
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
// one pass over one file
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
