// lib/config-lint.mjs — a lint catalogue for `.claude` config files.
//
// WHY THIS AND NOT `agnix`
// The obvious upstream is the `agnix` Rust binary. It is not installed here and shelling out to a
// binary we cannot guarantee exists would make the whole feature return "no diagnostics" on every
// machine that lacks it — which reads identically to "your config is clean". That is the exact
// dishonesty this repo's house rules forbid, so the rules live here, in Node, in-process.
//
// WHAT MAKES A RULE LEGITIMATE HERE
// Every rule below is grounded in code in THIS repo that actually reads the file, and the message
// names the reader it breaks. Rules were derived by reading:
//
//   server/index.mjs:148-155  parseFM()          — frontmatter regex + YAML.parse; on error it sets
//                                                  `_parse_error` and `fm.description` becomes ''.
//   server/index.mjs:178      itemFile()         — a skill is keyed by its DIRECTORY name, not by
//                                                  the `name:` field.
//   server/index.mjs:344-348  GET /api/hooks     — bare `JSON.parse` with no try/catch → 500.
//   server/index.mjs:1382-84  harnessResolve()   — `Array.isArray(matchers) ? matchers : []`, so a
//                                                  non-array hooks[event] silently yields no gates.
//   server/index.mjs:1402     CLAUDE.md read     — read RAW. Never frontmatter-parsed.
//   server/index.mjs:1535-37  layer list         — CLAUDE.md and .claude/CLAUDE.md are BOTH loaded.
//   server/index.mjs:1512     skill trigger      — `String(fm.description||'').slice(0,160)`.
//   server/index.mjs:263-289  MCP servers        — `Object.entries(cj.mcpServers||{})`.
//   server/index.mjs:474-475  MCP enable/disable — `_disabledMcpServers` ⇄ `mcpServers`.
//   server/index.mjs:488-492  hook enable/disable— `settings.hooks` ⇄ `settings._disabledHooks`.
//   server/index.mjs:3648     POST /api/hooks/test — invalid matcher regex FALLS BACK to exact match.
//   src/sections/HooksSection.jsx:66-67          — `(groups||[]).flatMap(g => (g.hooks||[]).map(...))`.
//   server/index.mjs:1331     alwaysLoadedBudget.softCap = 8000 — the always-on token budget.
//   server/index.mjs:569      tokens()           — the repo's own ~4 chars/token heuristic.
//
// HOUSE RULES ENFORCED HERE
//  · A file we cannot parse yields a `parse-error` diagnostic and `parsed:false`. It NEVER yields
//    zero diagnostics, because zero diagnostics is how this tool says "clean".
//  · Line numbers are located, never guessed. When a location is not determinable we emit
//    `line: null` with `lineReason` saying why.
//  · Autofixes are PROPOSALS: `{fix: {kind:'patch', ...}}` with the replacement text. Nothing here
//    writes to disk. Applying is the caller's explicit act.
//  · Never throws. Every entry point returns a result object.

import fsDefault from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { lintFrontmatter } from './capability-provenance.mjs'

export const SEVERITY = { ERROR: 'error', WARN: 'warn', INFO: 'info' }

// Bounds, all reported when hit.
export const MAX_FILE_BYTES = 2_000_000
export const MAX_DIAGNOSTICS = 500
// server/index.mjs:1331 HARNESS_DEFAULTS.context.alwaysLoadedBudget.softCap
export const CLAUDE_MD_SOFT_CAP_TOKENS = 8000
// Claude Code's documented ceiling for a skill `description`. The dashboard additionally truncates
// the visible trigger at 160 chars (server/index.mjs:1512).
export const SKILL_DESCRIPTION_MAX = 1024
export const SKILL_DESCRIPTION_VISIBLE = 160

// Hook events Claude Code dispatches. An event outside this set is not "custom" — nothing ever
// looks it up, so the hook is dead config.
export const HOOK_EVENTS = new Set([
  'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification',
  'Stop', 'SubagentStop', 'SubagentStart', 'PreCompact', 'SessionStart', 'SessionEnd',
])
// Events where a `matcher` is meaningful (tool-name matching). Elsewhere it is silently ignored.
const MATCHER_EVENTS = new Set(['PreToolUse', 'PostToolUse'])

const tokens = s => Math.ceil((s || '').length / 4) // same heuristic as server/index.mjs:569

// ---------------------------------------------------------------------------
// diagnostics
// ---------------------------------------------------------------------------
function diag(id, severity, message, o = {}) {
  return {
    id, severity, message,
    file: o.file ?? null,
    line: o.line ?? null,
    // Every null line says WHY it is null, so a reader can tell "not locatable" from "forgot to set".
    lineReason: o.line == null ? (o.lineReason || 'this rule is about the file as a whole, not a single line') : null,
    evidence: o.evidence ?? null,
    fix: o.fix ?? null,
  }
}

/** A proposed patch. Never applied here. */
const patch = (description, o = {}) => ({
  kind: 'patch', applied: false, description,
  target: o.target ?? null, before: o.before ?? null, after: o.after ?? null,
  note: 'proposed only — review before applying; nothing was written to disk',
})

// Locate a JSON key's line HONESTLY: only when the quoted key occurs exactly once in the source.
// Two occurrences means we cannot tell which one the diagnostic is about, and pointing at the wrong
// one is worse than pointing at nothing.
function jsonKeyLine(src, key) {
  if (typeof src !== 'string') return { line: null, reason: 'source text not available' }
  const needle = `"${key}"`
  const lines = src.split('\n')
  const hits = []
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(needle)) hits.push(i + 1)
  if (hits.length === 1) return { line: hits[0], reason: null }
  if (hits.length === 0) return { line: null, reason: `key ${needle} not found literally in the source text` }
  return { line: null, reason: `key ${needle} appears on ${hits.length} lines (${hits.slice(0, 5).join(', ')}${hits.length > 5 ? '…' : ''}) — ambiguous, not guessing` }
}

// Line of a key inside a YAML frontmatter block that starts at file line 1.
function fmKeyLine(fmText, key, offset) {
  const lines = String(fmText).split('\n')
  for (let i = 0; i < lines.length; i++) if (new RegExp(`^\\s*${key}\\s*:`).test(lines[i])) return offset + i
  return null
}

const readText = (file, fs) => {
  try {
    const st = fs.statSync(file)
    if (st.size > MAX_FILE_BYTES) return { ok: true, text: fs.readFileSync(file, 'utf8').slice(0, MAX_FILE_BYTES), capped: { limit: MAX_FILE_BYTES, size: st.size, note: 'file truncated for linting; rules below saw only the first bytes' } }
    return { ok: true, text: fs.readFileSync(file, 'utf8'), capped: null }
  } catch (e) {
    return { ok: false, reason: e.code === 'ENOENT' ? 'not-found' : `unreadable: ${e.message}`, code: e.code || null }
  }
}

// ---------------------------------------------------------------------------
// frontmatter — deliberately IDENTICAL to server/index.mjs:148 parseFM()
// ---------------------------------------------------------------------------
// This is copied byte-for-byte in behaviour on purpose. A linter that parses frontmatter more
// leniently than the reader would pass files the reader silently drops, which is worse than no
// linter at all. (See INTEGRATION-misc.md: server/index.mjs should import THIS instead of keeping
// its own copy, so the two can never drift.)
export function parseFrontmatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src)
  if (!m) return { present: false, fm: {}, body: src, raw: null, error: null }
  let fm = {}, error = null
  try { fm = YAML.parse(m[1]) } catch (e) { error = e.message; fm = null }
  return { present: true, fm, body: src.slice(m[0].length), raw: m[1], error, blockLines: m[0].split('\n').length }
}

// ---------------------------------------------------------------------------
// CLAUDE.md
// ---------------------------------------------------------------------------
export function lintClaudeMd(file, opts = {}) {
  const fs = opts.fs || fsDefault
  const out = []
  const r = readText(file, fs)
  if (!r.ok) {
    if (r.reason === 'not-found') return { ok: true, file, parsed: false, exists: false, diagnostics: [], note: 'file does not exist — nothing linted, and this is NOT a clean result' }
    return { ok: true, file, parsed: false, exists: true, diagnostics: [diag('claude-md/unreadable', SEVERITY.ERROR, `Cannot read ${file} (${r.reason}). Fix the permissions or the path; until then the always-on rules this file holds are NOT reaching the model and this linter cannot tell you what is in it.`, { file })] }
  }
  const src = r.text
  const lines = src.split('\n')

  if (!src.trim())
    out.push(diag('claude-md/empty', SEVERITY.WARN, `${path.basename(file)} is empty. Either write the project's rules into it or delete it — an empty CLAUDE.md still shows as configured in the harness view (server/index.mjs:1418 counts it as "create CLAUDE.md" done) while contributing nothing.`, { file, line: null, lineReason: 'whole-file property' }))

  // CLAUDE.md is read raw (server/index.mjs:1402). A frontmatter block is not stripped — it is fed
  // to the model verbatim as literal `---` and YAML text.
  const fmHere = /^---\r?\n/.test(src)
  if (fmHere)
    out.push(diag('claude-md/frontmatter-not-supported', SEVERITY.WARN, `${path.basename(file)} starts with a \`---\` YAML frontmatter block. CLAUDE.md is read raw (server/index.mjs:1402) and never frontmatter-parsed, so this YAML is sent to the model as literal text and burns always-on tokens. Fix: delete the block, or convert its contents to a markdown section.`, { file, line: 1, evidence: lines[0], fix: patch('remove the frontmatter block from CLAUDE.md', { target: file, before: src.slice(0, (/^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(src) || [''])[0].length), after: '' }) }))

  const tok = tokens(src)
  if (tok > CLAUDE_MD_SOFT_CAP_TOKENS)
    out.push(diag('claude-md/oversized', SEVERITY.WARN, `${path.basename(file)} is ~${tok} tokens, over the always-loaded soft cap of ${CLAUDE_MD_SOFT_CAP_TOKENS} (server/index.mjs:1331 alwaysLoadedBudget.softCap). This is paid on EVERY turn of every session. Fix: move reference material into a skill or a linked file and keep CLAUDE.md to rules the model must always have.`, { file, line: null, lineReason: 'size is a whole-file property', evidence: { tokens: tok, cap: CLAUDE_MD_SOFT_CAP_TOKENS, chars: src.length } }))

  // `@path` imports — Claude Code inlines these. A missing target is silently dropped, so a rule the
  // author believes is loaded is not.
  const dir = path.dirname(file)
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*@([^\s`]+)\s*$/.exec(lines[i])
    if (!m) continue
    const t = m[1].startsWith('~') ? path.join(process.env.HOME || '', m[1].slice(1)) : path.resolve(dir, m[1])
    let exists = false
    try { exists = fs.existsSync(t) } catch {}
    if (!exists)
      out.push(diag('claude-md/missing-import', SEVERITY.ERROR, `\`@${m[1]}\` on line ${i + 1} points at ${t}, which does not exist. The import resolves to nothing and is dropped silently — whatever rules you think it contributes are not loaded. Fix: correct the path or remove the line.`, { file, line: i + 1, evidence: lines[i].trim() }))
  }

  // splitSections() (server/index.mjs:151) anchors provenance on `^#{1,3} `. With no such heading
  // the whole file collapses into one "(preamble)" block and PlanGraph's per-rule lookup
  // (src/sections/PlanGraph.jsx:66) can never find a matching section.
  if (src.trim() && !lines.some(l => /^#{1,3} /.test(l)))
    out.push(diag('claude-md/no-headings', SEVERITY.INFO, `${path.basename(file)} has no \`#\`/\`##\`/\`###\` headings. Provenance splitting (server/index.mjs:151 splitSections) anchors on those, so the whole file becomes one "(preamble)" block and PlanGraph cannot cite a specific rule. Fix: add \`## \` headings around each group of rules.`, { file, line: null, lineReason: 'absence of a construct has no line' }))

  return { ok: true, file, parsed: true, exists: true, tokens: tok, diagnostics: capDiags(out), ...(r.capped ? { caps: { file: r.capped } } : {}) }
}

/** Both `CLAUDE.md` and `.claude/CLAUDE.md` in one project are both loaded — see index.mjs:1535-37. */
export function lintClaudeMdLayers(projectDir, opts = {}) {
  const fs = opts.fs || fsDefault
  const a = path.join(projectDir, 'CLAUDE.md'), b = path.join(projectDir, '.claude', 'CLAUDE.md')
  let ea = false, eb = false
  try { ea = fs.existsSync(a) } catch {}
  try { eb = fs.existsSync(b) } catch {}
  const out = []
  if (ea && eb)
    out.push(diag('claude-md/duplicate-location', SEVERITY.WARN, `Both \`CLAUDE.md\` and \`.claude/CLAUDE.md\` exist in ${projectDir}. Both are loaded as separate layers (server/index.mjs:1535-1537), so their contents are sent together and you pay for both on every turn — and when they disagree, the model sees the contradiction with no precedence marker. Fix: keep one and delete or merge the other.`, { file: a, line: null, lineReason: 'this is a relationship between two files', evidence: { files: [a, b] } }))
  return { ok: true, projectDir, diagnostics: out, files: { root: ea ? a : null, dotClaude: eb ? b : null } }
}

// ---------------------------------------------------------------------------
// SKILL.md
// ---------------------------------------------------------------------------
export function lintSkill(file, opts = {}) {
  const fs = opts.fs || fsDefault
  const out = []
  const r = readText(file, fs)
  if (!r.ok) {
    if (r.reason === 'not-found') return { ok: true, file, parsed: false, exists: false, diagnostics: [], note: 'file does not exist — nothing linted' }
    return { ok: true, file, parsed: false, exists: true, diagnostics: [diag('skill/unreadable', SEVERITY.ERROR, `Cannot read ${file} (${r.reason}). This skill is invisible to the harness until that is fixed.`, { file })] }
  }
  const src = r.text
  const dirName = path.basename(path.dirname(file))

  // A BOM defeats the `^---` anchor in parseFM (server/index.mjs:149), so the ENTIRE frontmatter is
  // treated as body: no name, no description, no trigger. The file looks fine in an editor.
  if (src.charCodeAt(0) === 0xfeff) {
    out.push(diag('skill/bom', SEVERITY.ERROR, `${file} starts with a UTF-8 BOM. parseFM anchors on \`^---\` (server/index.mjs:149), so the BOM makes the frontmatter unparseable and the skill loses its name and description entirely while still looking correct in an editor. Fix: re-save the file as UTF-8 without BOM.`, { file, line: 1, fix: patch('strip the leading BOM', { target: file, before: '\\uFEFF---', after: '---' }) }))
    return { ok: true, file, parsed: false, exists: true, diagnostics: capDiags(out) }
  }

  const fmr = parseFrontmatter(src)

  if (!fmr.present) {
    const leadingBlank = /^\s*\n\s*---/.test(src)
    out.push(diag('skill/no-frontmatter', SEVERITY.ERROR, leadingBlank
      ? `${file} has a \`---\` block but not on line 1. parseFM's regex is anchored (\`^---\\r?\\n\`, server/index.mjs:149), so a leading blank line makes the whole block invisible and the skill gets no name and no description. Fix: delete the blank line(s) before \`---\`.`
      : `${file} has no YAML frontmatter. Without it the skill has no \`description\`, which is the trigger text the harness matches on (server/index.mjs:1512) — the skill will never fire. Fix: add a \`---\` block with \`name:\` and \`description:\` at the very top.`,
      { file, line: 1, fix: patch('add frontmatter at line 1', { target: file, before: '', after: `---\nname: ${dirName}\ndescription: <one sentence describing exactly when to use this skill>\n---\n\n` }) }))
    return { ok: true, file, parsed: false, exists: true, diagnostics: capDiags(out) }
  }

  if (fmr.error) {
    // parseFM swallows this into `_parse_error` and every consumer then reads `fm.description` as
    // undefined → ''. The skill silently loses its trigger; nothing in the UI says why.
    out.push(diag('skill/parse-error', SEVERITY.ERROR, `The YAML frontmatter in ${file} does not parse: ${fmr.error}. server/index.mjs:151 catches this and stores \`_parse_error\`, so \`description\` reads as empty and the skill silently stops triggering — with no error anywhere in the UI. Fix the YAML (usually an unquoted \`:\` inside a value, or bad indentation).`, { file, line: 2, evidence: fmr.error, lineReason: null }))
    return { ok: true, file, parsed: false, exists: true, diagnostics: capDiags(out) }
  }

  if (fmr.fm == null || typeof fmr.fm !== 'object' || Array.isArray(fmr.fm)) {
    out.push(diag('skill/frontmatter-not-mapping', SEVERITY.ERROR, `The frontmatter in ${file} parses to ${Array.isArray(fmr.fm) ? 'a list' : typeof fmr.fm} rather than a key/value mapping, so \`fm.description\` is undefined and every consumer reads it as empty. Fix: make the block a set of \`key: value\` lines.`, { file, line: 2 }))
    return { ok: true, file, parsed: false, exists: true, diagnostics: capDiags(out) }
  }

  const fm = fmr.fm
  const at = k => fmKeyLine(fmr.raw, k, 2)

  const desc = fm.description
  if (desc == null || String(desc).trim() === '')
    out.push(diag('skill/missing-description', SEVERITY.ERROR, `${file} has no \`description\`. That field IS the trigger — it is what the harness shows and matches on (server/index.mjs:1512 \`String(fm.description||'').slice(0,160)\`). Without it the skill loads but never fires. Fix: add a one-sentence \`description:\` saying exactly when to use this skill.`, { file, line: at('description'), lineReason: at('description') == null ? 'the key is absent, so it has no line' : null, fix: patch('add a description key to the frontmatter', { target: file, before: null, after: 'description: <when to use this skill>' }) }))
  else if (String(desc).length > SKILL_DESCRIPTION_MAX)
    out.push(diag('skill/description-too-long', SEVERITY.WARN, `\`description\` is ${String(desc).length} chars, over the ${SKILL_DESCRIPTION_MAX}-char limit; and the dashboard shows only the first ${SKILL_DESCRIPTION_VISIBLE} (server/index.mjs:1512), so everything past that is invisible to a human reviewing triggers. Fix: put the trigger conditions in the first sentence and move the rest into the skill body.`, { file, line: at('description'), evidence: { length: String(desc).length, max: SKILL_DESCRIPTION_MAX, visible: SKILL_DESCRIPTION_VISIBLE } }))

  if (fm.name == null || String(fm.name).trim() === '')
    out.push(diag('skill/missing-name', SEVERITY.WARN, `${file} has no \`name\`. The harness keys this skill by its DIRECTORY name (\`${dirName}\`, server/index.mjs:178), so it still works — but nothing in the file says what it is, and a rename of the directory silently renames the skill. Fix: add \`name: ${dirName}\`.`, { file, line: null, lineReason: 'the key is absent, so it has no line', fix: patch('add a name key matching the directory', { target: file, before: null, after: `name: ${dirName}` }) }))
  else if (String(fm.name).trim() !== dirName)
    out.push(diag('skill/name-mismatch', SEVERITY.ERROR, `\`name: ${fm.name}\` does not match the directory name \`${dirName}\`. Every lookup path in this repo resolves a skill by its directory (server/index.mjs:178 itemFile, :1016, :1508), so the declared name is never used — it just makes the file lie about what it is, and anyone invoking \`${fm.name}\` gets nothing. Fix: rename the field to \`${dirName}\` or rename the directory to \`${fm.name}\`.`, { file, line: at('name'), evidence: { declared: String(fm.name), directory: dirName }, fix: patch(`set name to the directory name`, { target: file, before: `name: ${fm.name}`, after: `name: ${dirName}` }) }))

  for (const key of ['allowed-tools', 'tools']) {
    if (!(key in fm)) continue
    const v = fm[key]
    if (typeof v !== 'string' && !Array.isArray(v))
      out.push(diag('skill/tools-type', SEVERITY.WARN, `\`${key}\` is ${v === null ? 'null' : typeof v}; it must be a comma-separated string or a YAML list. Consumers do \`Array.isArray(x) ? x : String(x||'').split(',')\` (server/index.mjs:1521), so anything else stringifies into a single garbage tool name and the restriction silently does nothing. Fix: write \`${key}: Read, Grep, Glob\` or a \`- \` list.`, { file, line: at(key) }))
  }

  if (!String(fmr.body || '').trim())
    out.push(diag('skill/empty-body', SEVERITY.WARN, `${file} has frontmatter but no body. The body is the instruction text the model reads once the skill triggers, so this skill can fire and then say nothing. Fix: write the procedure under the frontmatter, or delete the skill.`, { file, line: null, lineReason: 'absence of content has no line' }))

  // The repo already has a frontmatter linter (lib/capability-provenance.mjs). Seven of the
  // skill/* rules above restate its FM_* rules, and two linters that can disagree about the same
  // file is worse than either alone — a user shown "clean" by one and "broken" by the other
  // learns to trust neither. So its findings are merged in, and the ones already covered by a
  // more specific skill/* message emitted above are suppressed rather than doubled.
  //
  // It is kept because it catches five cases these rules do not: frontmatter inside a code fence,
  // a delimiter that is not on line 1, an unclosed block, a non-slug name, and a scan that hit
  // its byte cap.
  const COVERED = {
    FM_ABSENT: 'skill/no-frontmatter', FM_PARSE_ERROR: 'skill/parse-error',
    FM_NOT_MAPPING: 'skill/frontmatter-not-mapping', FM_NAME_MISMATCH: 'skill/name-mismatch',
    FM_BOM_BEFORE_DELIMITER: 'skill/bom', FM_UNREADABLE: 'skill/unreadable',
    FM_NAME_NOT_STRING: 'skill/missing-name', FM_EMPTY: 'skill/no-frontmatter',
    FM_EMPTY_BLOCK: 'skill/no-frontmatter',
  }
  const emitted = new Set(out.map(d => d.id))
  try {
    const fmLint = lintFrontmatter(r.text, { file, kind: 'skills' })
    for (const f of fmLint.findings || []) {
      const dupOf = COVERED[f.code]
      if (dupOf && emitted.has(dupOf)) continue
      out.push(diag(`skill/fm-${String(f.code).toLowerCase().replace(/^fm_/, '').replace(/_/g, '-')}`,
        f.severity === 'error' ? SEVERITY.ERROR : SEVERITY.WARN,
        `${f.message}${f.fix ? ` Fix: ${f.fix}` : ''}`,
        { file, line: null, lineReason: 'reported by the shared frontmatter linter, which does not track line numbers' }))
    }
    // A truncated scan means the checks below it saw only part of the file. Silent is not an option.
    if (fmLint.limits?.truncated) {
      out.push(diag('skill/fm-scan-truncated', SEVERITY.WARN,
        `Frontmatter scanning stopped at ${fmLint.limits.maxScanBytes} bytes, so anything past that was not checked.`, { file, line: null }))
    }
  } catch (e) {
    // A crash in the shared linter must not silently reduce this file's diagnostics to the subset
    // above — that would read as "cleaner than it is".
    out.push(diag('skill/fm-linter-failed', SEVERITY.WARN,
      `The shared frontmatter linter threw (${e.message}), so its checks did not run on this file.`, { file, line: null }))
  }
  return { ok: true, file, parsed: true, exists: true, name: fm.name ?? null, directory: dirName, diagnostics: capDiags(out), ...(r.capped ? { caps: { file: r.capped } } : {}) }
}

/** Lint the SKILL.md inside every immediate subdirectory of `dir`. A subdirectory with no SKILL.md
 *  is itself reported — nothing in this repo loads it, so it is invisible rather than clean. */
export function lintSkillsDir(dir, opts = {}) {
  const fs = opts.fs || fsDefault
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) {
    return { ok: true, dir, exists: false, results: [], diagnostics: [], note: `skills directory not readable (${e.code || e.message}) — nothing linted` }
  }
  const results = [], extra = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const f = path.join(dir, e.name, 'SKILL.md')
    let exists = false
    try { exists = fs.existsSync(f) } catch {}
    if (!exists) {
      extra.push(diag('skill/missing-file', SEVERITY.WARN, `${path.join(dir, e.name)} is a directory under skills/ with no SKILL.md. Every scanner in this repo requires that exact filename (server/index.mjs:178, :1016, :1508), so this directory is loaded by nothing. Fix: add SKILL.md, or move the directory out of skills/.`, { file: f, line: null, lineReason: 'the file does not exist' }))
      continue
    }
    results.push(lintSkill(f, opts))
  }
  return {
    ok: true, dir, exists: true, results,
    // Reported so a caller can say "12 skills checked, 1 problem" rather than implying the whole
    // directory was one opaque target. `skillsUnparseable` is the number whose diagnostics are
    // parse failures, i.e. skills we could NOT fully check.
    skillsFound: results.length,
    skillsParsed: results.filter(r => r.parsed).length,
    skillsUnparseable: results.filter(r => r.parsed === false).length,
    diagnostics: [...extra, ...results.flatMap(r => r.diagnostics)],
  }
}

// ---------------------------------------------------------------------------
// settings.json — hooks + permissions
// ---------------------------------------------------------------------------
export function lintSettings(file, opts = {}) {
  const fs = opts.fs || fsDefault
  const r = readText(file, fs)
  if (!r.ok) {
    if (r.reason === 'not-found') return { ok: true, file, parsed: false, exists: false, diagnostics: [], note: 'file does not exist — nothing linted' }
    return { ok: true, file, parsed: false, exists: true, diagnostics: [diag('settings/unreadable', SEVERITY.ERROR, `Cannot read ${file} (${r.reason}). GET /api/hooks reads this file with an unguarded \`JSON.parse(fs.readFileSync(...))\` (server/index.mjs:348), so an unreadable settings file takes the whole Hooks panel down with a 500.`, { file })] }
  }
  const src = r.text
  const out = []
  let settings
  try { settings = JSON.parse(src) } catch (e) {
    // THE most important diagnostic in this file: index.mjs:348 parses this with no try/catch, so a
    // trailing comma here 500s /api/hooks and the Hooks panel renders a permanent skeleton.
    const m = /position (\d+)/.exec(e.message)
    const line = m ? src.slice(0, Number(m[1])).split('\n').length : null
    return {
      ok: true, file, parsed: false, exists: true,
      diagnostics: [diag('settings/parse-error', SEVERITY.ERROR, `${file} is not valid JSON: ${e.message}. GET /api/hooks parses it with a bare \`JSON.parse\` and no try/catch (server/index.mjs:348), so this returns a 500 and the Hooks panel never loads — and Claude Code itself ignores the file, meaning every hook and permission in it is currently OFF. Fix: repair the JSON (a trailing comma or an unquoted key is the usual cause).`,
        { file, line, lineReason: line == null ? 'the JSON error carried no position' : null, evidence: e.message })],
    }
  }
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings))
    return { ok: true, file, parsed: false, exists: true, diagnostics: [diag('settings/not-object', SEVERITY.ERROR, `${file} parses to ${Array.isArray(settings) ? 'an array' : typeof settings}, not an object. Everything that reads it does \`settings.hooks\` / \`settings.permissions\`, so all of it is undefined and the file has no effect. Fix: make the top level a JSON object.`, { file, line: 1 })] }

  out.push(...lintHooks(settings.hooks, { file, src, field: 'hooks', fs }))
  if (settings._disabledHooks) out.push(...lintHooks(settings._disabledHooks, { file, src, field: '_disabledHooks', fs, disabled: true }))

  // A hook present in both `hooks` and `_disabledHooks` breaks the toggle: the enable path
  // (server/index.mjs:488-492) moves the entry from _disabledHooks into hooks, producing a duplicate
  // that then fires twice, and the disable path leaves a live copy behind.
  if (settings.hooks && settings._disabledHooks) {
    const key = (ev, e) => `${ev}::${e?.matcher || '*'}::${JSON.stringify(e?.hooks || [])}` // server/index.mjs:437
    const live = new Set()
    for (const [ev, gs] of Object.entries(settings.hooks || {})) if (Array.isArray(gs)) for (const g of gs) live.add(key(ev, g))
    for (const [ev, gs] of Object.entries(settings._disabledHooks || {})) if (Array.isArray(gs)) for (const g of gs) if (live.has(key(ev, g)))
      out.push(diag('settings/disabled-shadow', SEVERITY.WARN, `The ${ev} hook \`${g?.matcher || '*'}\` exists in BOTH \`hooks\` and \`_disabledHooks\`. The Customize toggle keys on exactly this tuple (server/index.mjs:437), so enabling it copies the disabled entry on top of the live one and the hook then runs twice per matching call. Fix: delete the copy in \`_disabledHooks\`.`, { file, line: jsonKeyLine(src, '_disabledHooks').line, lineReason: jsonKeyLine(src, '_disabledHooks').reason, evidence: { event: ev, matcher: g?.matcher || '*' } }))
  }

  out.push(...lintPermissions(settings.permissions, { file, src }))
  return { ok: true, file, parsed: true, exists: true, diagnostics: capDiags(out), ...(r.capped ? { caps: { file: r.capped } } : {}) }
}

export function lintHooks(hooks, ctx = {}) {
  const { file = null, src = null, field = 'hooks', disabled = false, fs = fsDefault } = ctx
  const out = []
  if (hooks == null) return out
  if (typeof hooks !== 'object' || Array.isArray(hooks)) {
    out.push(diag('hook/root-not-object', SEVERITY.ERROR, `\`${field}\` is ${Array.isArray(hooks) ? 'an array' : typeof hooks}; it must be an object keyed by event name (\`{"PreToolUse": [ ... ]}\`). Readers iterate \`Object.entries(settings.hooks||{})\` (server/index.mjs:1382), so an array yields numeric "event" names and nothing ever fires. Fix: wrap the groups in \`{"<Event>": [...]}\`.`, { file, ...loc(src, field) }))
    return out
  }
  for (const [event, groups] of Object.entries(hooks)) {
    const evLoc = loc(src, event)
    if (!HOOK_EVENTS.has(event)) {
      const near = [...HOOK_EVENTS].find(e => e.toLowerCase() === String(event).toLowerCase())
      out.push(diag('hook/unknown-event', SEVERITY.ERROR, near
        ? `\`${field}.${event}\` is the wrong case. Event names are matched exactly, so nothing ever dispatches this. Fix: rename it to \`${near}\`.`
        : `\`${field}.${event}\` is not a hook event Claude Code dispatches. Nothing looks this key up, so every hook under it is dead config that looks installed. Fix: use one of ${[...HOOK_EVENTS].join(', ')}.`,
        { file, ...evLoc, evidence: { event, known: [...HOOK_EVENTS] }, fix: near ? patch(`rename the event key to ${near}`, { target: file, before: `"${event}"`, after: `"${near}"` }) : null }))
    }
    if (!Array.isArray(groups)) {
      // harnessResolve does `Array.isArray(matchers) ? matchers : []` (server/index.mjs:1383): zero
      // gates, no error. HooksSection.jsx:66 does `(groups||[]).flatMap` and THROWS on an object.
      out.push(diag('hook/event-not-array', SEVERITY.ERROR, `\`${field}.${event}\` is ${groups === null ? 'null' : typeof groups}; it must be an ARRAY of matcher groups. server/index.mjs:1383 does \`Array.isArray(matchers) ? matchers : []\` so it silently contributes no gates, and src/sections/HooksSection.jsx:66 calls \`.flatMap\` on it and throws. Fix: wrap it in \`[ ... ]\`.`, { file, ...evLoc, fix: patch('wrap the value in an array', { target: file, before: `"${event}": {…}`, after: `"${event}": [ {…} ]` }) }))
      continue
    }
    groups.forEach((g, gi) => {
      const where = `${field}.${event}[${gi}]`
      if (g === null || typeof g !== 'object' || Array.isArray(g)) {
        out.push(diag('hook/group-not-object', SEVERITY.ERROR, `${where} is ${Array.isArray(g) ? 'an array' : g === null ? 'null' : typeof g}; each entry must be \`{"matcher": "...", "hooks": [...]}\`. Fix: replace it with that shape.`, { file, ...evLoc }))
        return
      }
      if (g.matcher != null && typeof g.matcher !== 'string')
        out.push(diag('hook/matcher-type', SEVERITY.ERROR, `${where}.matcher is ${typeof g.matcher}; it must be a string. Fix: quote it.`, { file, ...evLoc }))
      else if (typeof g.matcher === 'string' && g.matcher) {
        try { new RegExp(`^(${g.matcher})$`) } catch (e) {
          // server/index.mjs:3648: an invalid matcher regex FALLS BACK to exact string equality. The
          // hook keeps "working" for one literal tool name and silently stops matching everything else.
          out.push(diag('hook/bad-matcher-regex', SEVERITY.ERROR, `${where}.matcher \`${g.matcher}\` is not a valid regex (${e.message}). server/index.mjs:3648 falls back to exact string comparison when the regex fails to compile, so this hook silently matches only the literal tool name "${g.matcher}" and nothing else — it looks installed and mostly does not run. Fix: escape the special characters, e.g. \`${String(g.matcher).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\`.`, { file, ...evLoc, fix: patch('escape the matcher', { target: file, before: g.matcher, after: String(g.matcher).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }) }))
        }
        if (!MATCHER_EVENTS.has(event) && HOOK_EVENTS.has(event))
          out.push(diag('hook/matcher-ignored', SEVERITY.INFO, `${where} sets a matcher (\`${g.matcher}\`) but ${event} has no tool to match against, so the matcher is ignored and the hook fires on every ${event}. Fix: drop the matcher, or move the hook to PreToolUse/PostToolUse if it was meant to be tool-scoped.`, { file, ...evLoc }))
      }
      if (!Array.isArray(g.hooks)) {
        out.push(diag('hook/group-missing-hooks', SEVERITY.ERROR, `${where} has no \`hooks\` array. Every reader does \`(entry.hooks||[])\` (server/index.mjs:437, :1384; HooksSection.jsx:67), so this group is registered and runs nothing. Fix: add \`"hooks": [{"type":"command","command":"...","timeout":10}]\`.`, { file, ...evLoc }))
        return
      }
      g.hooks.forEach((h, hi) => {
        const w2 = `${where}.hooks[${hi}]`
        if (h === null || typeof h !== 'object') { out.push(diag('hook/entry-not-object', SEVERITY.ERROR, `${w2} is ${h === null ? 'null' : typeof h}; it must be an object. Fix: replace it with \`{"type":"command","command":"..."}\`.`, { file, ...evLoc })); return }
        const cmd = h.command
        if ((h.type === 'command' || h.type == null) && (typeof cmd !== 'string' || !cmd.trim()))
          out.push(diag('hook/entry-missing-command', SEVERITY.ERROR, `${w2} has no \`command\`. The Hooks panel renders \`h.command || h.prompt || ''\` (HooksSection.jsx:67), so this shows as a blank row and executes nothing while counting as an installed hook. Fix: add the shell command, or delete the entry.`, { file, ...evLoc }))
        if (typeof cmd === 'string' && cmd.trim() && !disabled) {
          // A hook whose script has been moved/deleted fails on EVERY matching tool call. Under
          // PreToolUse a non-zero exit is a block (exit 2), so a stale path can wedge the session.
          const first = /^\s*(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(cmd)
          const tokenPath = first && (first[1] || first[2] || first[3])
          const looksPath = tokenPath && (tokenPath.startsWith('/') || tokenPath.startsWith('~') || tokenPath.startsWith('./'))
          if (looksPath) {
            const abs = tokenPath.startsWith('~') ? path.join(process.env.HOME || '', tokenPath.slice(1)) : tokenPath
            let exists = false
            try { exists = fs.existsSync(abs) } catch {}
            if (!exists)
              out.push(diag('hook/command-script-missing', SEVERITY.ERROR, `${w2} runs \`${abs}\`, which does not exist. This hook fails on every ${event} it matches; under PreToolUse a non-zero exit is treated as a BLOCK (server/index.mjs:3667), so a stale path can wedge every matching tool call. Fix: restore the script or remove the hook.`, { file, ...evLoc, evidence: { command: cmd.slice(0, 200), resolved: abs } }))
          }
        }
        if (h.timeout == null)
          out.push(diag('hook/no-timeout', SEVERITY.INFO, `${w2} sets no \`timeout\`. A hook that hangs stalls every matching tool call with no upper bound. Fix: add \`"timeout": 10\` (seconds).`, { file, ...evLoc, fix: patch('add a timeout', { target: file, before: null, after: '"timeout": 10' }) }))
        else if (typeof h.timeout !== 'number' || h.timeout <= 0)
          out.push(diag('hook/bad-timeout', SEVERITY.WARN, `${w2}.timeout is ${JSON.stringify(h.timeout)}; it must be a positive number of seconds, otherwise it is ignored and the hook runs unbounded. Fix: set a number, e.g. 10.`, { file, ...evLoc }))
      })
    })
  }
  return out
}

export function lintPermissions(perms, ctx = {}) {
  const { file = null, src = null } = ctx
  const out = []
  if (perms == null) return out
  if (typeof perms !== 'object' || Array.isArray(perms)) {
    out.push(diag('perm/not-object', SEVERITY.ERROR, `\`permissions\` is ${Array.isArray(perms) ? 'an array' : typeof perms}; it must be \`{"allow":[],"ask":[],"deny":[]}\`. Readers do \`perms[list]||[]\` (server/index.mjs:1377), so every rule here is currently ignored. Fix: use the object form.`, { file, ...loc(src, 'permissions') }))
    return out
  }
  for (const list of ['allow', 'ask', 'deny']) {
    const v = perms[list]
    if (v == null) continue
    if (!Array.isArray(v)) { out.push(diag('perm/list-not-array', SEVERITY.ERROR, `\`permissions.${list}\` is ${typeof v}; it must be an array of rule strings. Fix: wrap it in \`[ ]\`.`, { file, ...loc(src, list) })); continue }
    v.forEach((rule, i) => {
      if (typeof rule !== 'string')
        out.push(diag('perm/non-string', SEVERITY.ERROR, `\`permissions.${list}[${i}]\` is ${rule === null ? 'null' : typeof rule}, not a string. server/index.mjs:1378 flags this as a conflict and the matcher \`r === pat\` can never match it, so the rule is inert. Fix: make it a rule string like \`Bash(npm test)\`.`, { file, ...loc(src, list) }))
      else if (!/^[A-Za-z]+(\(.*\))?$/.test(rule.trim()))
        out.push(diag('perm/malformed-rule', SEVERITY.WARN, `\`permissions.${list}[${i}]\` = \`${rule}\` is not in \`Tool\` or \`Tool(pattern)\` form. Rules are matched by exact string equality against that shape (server/index.mjs:1377), so a rule in any other form silently never applies. Fix: rewrite it, e.g. \`Bash(git push:*)\` or \`Read(//path/**)\`.`, { file, ...loc(src, list), evidence: rule.slice(0, 120) }))
    })
  }
  const allow = (perms.allow || []).filter(x => typeof x === 'string')
  const deny = new Set((perms.deny || []).filter(x => typeof x === 'string'))
  for (const a of allow) if (deny.has(a))
    out.push(diag('perm/allow-deny-conflict', SEVERITY.ERROR, `\`${a}\` is in both \`allow\` and \`deny\`. Deny wins, silently — the allow entry does nothing and anyone reading the config will believe the tool is permitted. Fix: delete it from whichever list is wrong.`, { file, ...loc(src, 'deny'), evidence: a, fix: patch('remove the duplicate from one list', { target: file, before: a, after: null }) }))
  for (const list of ['allow', 'ask', 'deny']) {
    const v = (perms[list] || []).filter(x => typeof x === 'string')
    const seen = new Set()
    for (const x of v) { if (seen.has(x)) out.push(diag('perm/duplicate', SEVERITY.INFO, `\`${x}\` appears more than once in \`permissions.${list}\`. Harmless at runtime but it hides the real rule count. Fix: delete the duplicate.`, { file, ...loc(src, list), evidence: x })); seen.add(x) }
  }
  return out
}

// ---------------------------------------------------------------------------
// MCP server configs (~/.claude.json, .mcp.json, project scopes)
// ---------------------------------------------------------------------------
const SECRETY = /^(?:sk-|ghp_|github_pat_|xox[baprs]-|AKIA|glpat-)|(?:[A-Za-z0-9_\-]{32,})$/
const SECRET_KEY = /(token|secret|key|password|passwd|credential|api[_-]?key)/i

export function lintMcpConfig(file, opts = {}) {
  const fs = opts.fs || fsDefault
  const r = readText(file, fs)
  if (!r.ok) {
    if (r.reason === 'not-found') return { ok: true, file, parsed: false, exists: false, diagnostics: [], note: 'file does not exist — nothing linted' }
    return { ok: true, file, parsed: false, exists: true, diagnostics: [diag('mcp/unreadable', SEVERITY.ERROR, `Cannot read ${file} (${r.reason}). Every MCP server declared in it is unavailable.`, { file })] }
  }
  let cfg
  try { cfg = JSON.parse(r.text) } catch (e) {
    const m = /position (\d+)/.exec(e.message)
    const line = m ? r.text.slice(0, Number(m[1])).split('\n').length : null
    return { ok: true, file, parsed: false, exists: true, diagnostics: [diag('mcp/parse-error', SEVERITY.ERROR, `${file} is not valid JSON: ${e.message}. Claude Code cannot read it, so EVERY MCP server declared here is silently absent — the tools just do not appear. Fix: repair the JSON.`, { file, line, lineReason: line == null ? 'the JSON error carried no position' : null, evidence: e.message })] }
  }
  return { ok: true, file, parsed: true, exists: true, diagnostics: capDiags(lintMcpObject(cfg, { file, src: r.text })) }
}

export function lintMcpObject(cfg, ctx = {}) {
  const { file = null, src = null } = ctx
  const out = []
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
    out.push(diag('mcp/not-object', SEVERITY.ERROR, `The MCP config is ${Array.isArray(cfg) ? 'an array' : typeof cfg}, not an object. Readers do \`Object.entries(cfg.mcpServers||{})\` (server/index.mjs:263), so nothing is found. Fix: make the top level \`{"mcpServers": { ... }}\`.`, { file, line: 1 }))
    return out
  }
  const servers = cfg.mcpServers
  if (servers != null && (typeof servers !== 'object' || Array.isArray(servers))) {
    out.push(diag('mcp/servers-not-object', SEVERITY.ERROR, `\`mcpServers\` is ${Array.isArray(servers) ? 'an array' : typeof servers}; it must be an object keyed by server name. \`Object.entries\` on an array yields numeric names (server/index.mjs:263), so servers get bogus identities or vanish. Fix: use \`{"name": {…}}\`.`, { file, ...loc(src, 'mcpServers') }))
    return out
  }
  for (const [name, s] of Object.entries(servers || {})) {
    const where = loc(src, name)
    if (s === null || typeof s !== 'object' || Array.isArray(s)) {
      out.push(diag('mcp/entry-not-object', SEVERITY.ERROR, `\`mcpServers.${name}\` is ${s === null ? 'null' : Array.isArray(s) ? 'an array' : typeof s}; it must be an object. Fix: give it \`{"command": "...", "args": [...]}\` (stdio) or \`{"type": "http", "url": "..."}\` (remote).`, { file, ...where }))
      continue
    }
    const remote = s.type === 'sse' || s.type === 'http' || !!s.url
    if (remote) {
      if (typeof s.url !== 'string' || !s.url.trim())
        out.push(diag('mcp/remote-missing-url', SEVERITY.ERROR, `\`mcpServers.${name}\` is a ${s.type || 'remote'} server with no \`url\`. It cannot connect and the server silently contributes no tools. Fix: add \`"url": "https://…"\`.`, { file, ...where }))
      else if (!/^https?:\/\//.test(s.url))
        out.push(diag('mcp/remote-bad-url', SEVERITY.WARN, `\`mcpServers.${name}.url\` = \`${s.url}\` has no http/https scheme, so the connection will never be attempted. Fix: include the scheme.`, { file, ...where }))
      if (s.command) out.push(diag('mcp/mixed-transport', SEVERITY.WARN, `\`mcpServers.${name}\` sets both \`url\` and \`command\`. Only one transport is used and which one wins is not visible anywhere in this UI. Fix: delete whichever is stale.`, { file, ...where }))
    } else {
      if (typeof s.command !== 'string' || !s.command.trim())
        out.push(diag('mcp/stdio-missing-command', SEVERITY.ERROR, `\`mcpServers.${name}\` has neither \`command\` (stdio) nor \`url\` (http/sse). It is listed in the MCP panel (server/index.mjs:263 lists whatever is present) but can never start. Fix: add \`"command": "npx"\` plus \`"args"\`, or \`"type":"http"\` plus \`"url"\`.`, { file, ...where }))
      if (s.args != null && !Array.isArray(s.args))
        out.push(diag('mcp/args-not-array', SEVERITY.ERROR, `\`mcpServers.${name}.args\` is ${typeof s.args}; it must be an array of strings. A single string is NOT split into arguments — the whole thing is passed as one argv entry and the server fails to start. Fix: \`"args": ["-y", "pkg"]\`.`, { file, ...where }))
      else if (Array.isArray(s.args) && s.args.some(a => typeof a !== 'string'))
        out.push(diag('mcp/args-not-strings', SEVERITY.WARN, `\`mcpServers.${name}.args\` contains a non-string entry; it will be coerced by the spawn call and may not be what you wrote. Fix: quote every argument.`, { file, ...where }))
    }
    if (s.env != null) {
      if (typeof s.env !== 'object' || Array.isArray(s.env))
        out.push(diag('mcp/env-not-object', SEVERITY.ERROR, `\`mcpServers.${name}.env\` is ${Array.isArray(s.env) ? 'an array' : typeof s.env}; it must be an object of string values. Fix: \`"env": {"KEY": "value"}\`.`, { file, ...where }))
      else for (const [k, v] of Object.entries(s.env)) {
        if (typeof v !== 'string')
          out.push(diag('mcp/env-not-string', SEVERITY.WARN, `\`mcpServers.${name}.env.${k}\` is ${v === null ? 'null' : typeof v}; process environments hold strings only, so this is stringified (\`null\` becomes the literal "null"). Fix: quote the value.`, { file, ...where }))
        else if (SECRET_KEY.test(k) && v && !/^\$\{?[A-Z_]/.test(v))
          out.push(diag('mcp/secret-inline', SEVERITY.WARN, `\`mcpServers.${name}.env.${k}\` holds a literal secret. This file is read verbatim by the dashboard and returned over /api (server/index.mjs:263-265) and gets copied into backups. Fix: put the value in your shell environment and reference it, or move the server to a config that is not exported.`, { file, ...where, evidence: { key: k, valueLength: v.length } }))
      }
    }
    if (name in (cfg._disabledMcpServers || {}))
      out.push(diag('mcp/disabled-shadow', SEVERITY.ERROR, `\`${name}\` exists in BOTH \`mcpServers\` and \`_disabledMcpServers\`. The Customize enable path copies the disabled config over the live one and deletes the disabled copy (server/index.mjs:474), so toggling this server silently replaces its working config with the stale one. Fix: delete whichever copy is out of date.`, { file, ...where }))
  }
  return out
}

/** Same server name in two scopes — server/index.mjs:1583-1585 pushes both into one list. */
export function lintMcpScopeCollisions(scopes) {
  const out = []
  const seen = new Map()
  for (const { scope, file, servers } of scopes || []) {
    for (const name of Object.keys(servers || {})) {
      if (seen.has(name)) {
        const prev = seen.get(name)
        out.push(diag('mcp/name-collision', SEVERITY.WARN, `MCP server \`${name}\` is declared in both ${prev.scope} (${prev.file}) and ${scope} (${file}). server/index.mjs:1583-1585 pushes both into one list, so the panel shows two rows with the same name and which one actually connects is not shown anywhere. Fix: rename one, or delete the redundant declaration.`, { file, line: null, lineReason: 'this is a relationship between two files', evidence: { name, scopes: [prev.scope, scope] } }))
      } else seen.set(name, { scope, file })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// orchestration
// ---------------------------------------------------------------------------
function loc(src, key) { const l = jsonKeyLine(src, key); return { line: l.line, lineReason: l.reason } }
function capDiags(list) {
  if (list.length <= MAX_DIAGNOSTICS) return list
  return [...list.slice(0, MAX_DIAGNOSTICS), diag('lint/truncated', SEVERITY.INFO, `${list.length - MAX_DIAGNOSTICS} further diagnostics were not returned (cap ${MAX_DIAGNOSTICS}). Fix the ones above and re-run to see the rest.`, { line: null, lineReason: 'a cap is not a location' })]
}

/**
 * Lint a whole `.claude` surface. Every target reports whether it was found and whether it parsed —
 * a target that does not exist is reported as `exists:false`, NOT as clean.
 */
export function lintAll(targets = {}, opts = {}) {
  const fs = opts.fs || fsDefault
  const results = []
  const push = (kind, res) => { if (res) results.push({ kind, ...res }) }

  for (const f of arr(targets.claudeMd)) push('claude-md', lintClaudeMd(f, { fs }))
  for (const d of arr(targets.projectDirs)) push('claude-md-layers', lintClaudeMdLayers(d, { fs }))
  for (const d of arr(targets.skillsDirs)) push('skills-dir', lintSkillsDir(d, { fs }))
  for (const f of arr(targets.skills)) push('skill', lintSkill(f, { fs }))
  for (const f of arr(targets.settings)) push('settings', lintSettings(f, { fs }))
  for (const f of arr(targets.mcp)) push('mcp', lintMcpConfig(f, { fs }))

  const collisions = lintMcpScopeCollisions(targets.mcpScopes)
  if (collisions.length) results.push({ kind: 'mcp-scopes', ok: true, parsed: true, exists: true, diagnostics: collisions })

  const diagnostics = results.flatMap(r => r.diagnostics || [])
  const bySeverity = { error: 0, warn: 0, info: 0 }
  for (const d of diagnostics) bySeverity[d.severity] = (bySeverity[d.severity] || 0) + 1
  const unparseable = results.filter(r => r.exists && r.parsed === false).map(r => r.file || r.dir).filter(Boolean)
  const missing = results.filter(r => r.exists === false).map(r => r.file || r.dir).filter(Boolean)
  // Cross-file checks (duplicate CLAUDE.md layers, MCP scope collisions) and directory sweeps are
  // not single parseable files. They are counted in their own bucket rather than being folded into
  // "parsed", so the coverage numbers still add up to the number of targets and a reader can see
  // exactly what kind of checking each target got.
  const isMissing = r => r.exists === false
  const isUnparseable = r => r.exists && r.parsed === false
  const isParsedFile = r => r.parsed === true && r.exists !== false
  const relational = results.filter(r => !isMissing(r) && !isUnparseable(r) && !isParsedFile(r)).length
  const parsed = results.filter(isParsedFile).length

  return {
    ok: true,
    results,
    diagnostics,
    counts: { total: diagnostics.length, ...bySeverity },
    unparseableFiles: unparseable,
    missingFiles: missing,
    // Guard against the caller rendering "0 problems" over a config we never actually read.
    coverage: {
      targetsRequested: results.length,
      targetsParsed: parsed,
      targetsMissing: missing.length,
      targetsUnparseable: unparseable.length,
      targetsRelational: relational,
      // directory sweeps report their own inner counts so "1 target" does not hide 12 skills
      skillsFound: results.reduce((n, r) => n + (r.skillsFound || 0), 0),
      skillsParsed: results.reduce((n, r) => n + (r.skillsParsed || 0), 0),
      skillsUnparseable: results.reduce((n, r) => n + (r.skillsUnparseable || 0), 0),
      note: missing.length || unparseable.length
        ? 'Some targets were missing or unparseable. A zero-diagnostic count over those files means "not checked", not "clean".'
        : 'every requested target was found and parsed',
    },
    limits: { fileBytes: MAX_FILE_BYTES, diagnosticsPerFile: MAX_DIAGNOSTICS },
  }
}
const arr = v => (v == null ? [] : Array.isArray(v) ? v : [v])

/** All proposed fixes, gathered for a "review and apply" UI. Nothing is applied. */
export function proposedFixes(lintResult) {
  const ds = lintResult?.diagnostics || []
  return { applied: false, count: ds.filter(d => d.fix).length, fixes: ds.filter(d => d.fix).map(d => ({ id: d.id, file: d.file, line: d.line, message: d.message, ...d.fix })), note: 'proposals only — this module never writes to disk' }
}
