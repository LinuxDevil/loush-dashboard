// ---------------------------------------------------------------------------------------
// Governance guards: four independent, pure checks that turn "an agent did something" into
// a reviewable governance record.
//
//   001/002  flagSensitiveChanges  — a PR touched the files that define what the agent may do
//   010      checkReferencedPaths  — a manifest/registry points at something that is not there
//   019      scanSkillContent      — skill instruction text asks for something it should not
//   009      scoreRun              — a run is scored against declared expectations
//
// House rules honoured throughout:
//   * Unknown is a value. Anything we cannot evaluate is reported as unknown/unevaluated —
//     never coerced into a pass and never coerced into a violation.
//   * No silent caps. Every bound (evidence length, input length, finding count) that we
//     actually hit is reported back to the caller as its own record.
//   * Never throw on malformed input. Bad input produces a record describing the badness.
//   * Pure. Nothing here reads the filesystem, the network, or the clock. Anything that
//     would need the disk (path existence) is injected as a predicate so every rule is
//     unit-testable.
// ---------------------------------------------------------------------------------------

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = v => typeof v === 'string'
const isFiniteNum = v => typeof v === 'number' && Number.isFinite(v)
const arr = v => (Array.isArray(v) ? v : [])

/** Round to 2dp without float dust ("100 - 33.33 - 33.33 - 33.33" must not print 0.009999). */
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100

// =======================================================================================
// 001/002 — sensitive-path PR guard
// =======================================================================================

/**
 * The files that define what an agent is allowed to do.
 *
 * Directory entries end with `/` and match as a *path segment* anywhere in the path, so
 * `packages/api/.claude/settings.json` is caught as well as `.claude/settings.json` — a
 * nested agent config governs the agent just as much as the root one does.
 *
 * File entries match the *basename* exactly. That is what stops `CLAUDE.md.bak` (a backup,
 * inert, not read by anything) from being reported as a rewrite of `CLAUDE.md`.
 */
export const SENSITIVE_PATHS = Object.freeze([
  Object.freeze({ pattern: '.claude/', kind: 'directory', reason: 'agent settings, hooks, skills, agents and commands' }),
  Object.freeze({ pattern: '.husky/', kind: 'directory', reason: 'git hooks that gate commits and pushes' }),
  Object.freeze({ pattern: '.mcp.json', kind: 'file', reason: 'MCP servers the agent may call' }),
  Object.freeze({ pattern: '.claude.json', kind: 'file', reason: 'agent runtime configuration and trust decisions' }),
  Object.freeze({ pattern: '.gitmodules', kind: 'file', reason: 'submodule sources pulled into the working tree' }),
  Object.freeze({ pattern: '.ripgreprc', kind: 'file', reason: 'search defaults that decide what the agent can see' }),
  Object.freeze({ pattern: 'CLAUDE.md', kind: 'file', reason: 'standing instructions to the agent' }),
  Object.freeze({ pattern: 'CLAUDE.local.md', kind: 'file', reason: 'standing instructions to the agent (local overrides)' }),
])

/**
 * Normalise a changed-file entry to a POSIX-ish relative path, or null if it is not usable.
 * Accepts a bare string or the object shapes diff tooling tends to hand back.
 */
const normalisePath = value => {
  let raw = null
  if (isStr(value)) raw = value
  else if (isObj(value)) raw = [value.path, value.filename, value.file, value.newPath].find(isStr) ?? null
  if (raw === null) return null
  let p = raw.trim().replace(/\\/g, '/')
  if (p === '') return null
  // A rename arrives as "old => new" / "old -> new"; the destination is what now exists.
  const rename = p.match(/\s(?:=>|->)\s(.+)$/)
  if (rename) p = rename[1].trim()
  while (p.startsWith('./')) p = p.slice(2)
  p = p.replace(/^\/+/, '')
  p = p.replace(/\/{2,}/g, '/')
  return p === '' ? null : p
}

/**
 * Normalise a FILESYSTEM reference. Deliberately separate from normalisePath above, which is
 * built for git changed-file entries and strips the leading slash to make everything
 * repo-relative. Doing that to a real path turns /usr/bin/node into usr/bin/node, so every
 * absolute reference fails its existence check and reports as dangling — the whole checker
 * inverts. Leading slashes and ~ are preserved here; only whitespace, backslashes and duplicate
 * separators are cleaned up.
 */
const normaliseFsPath = value => {
  let raw = null
  if (isStr(value)) raw = value
  else if (isObj(value)) raw = [value.path, value.target, value.file].find(isStr) ?? null
  if (raw === null) return null
  let p = raw.trim().replace(/\\/g, '/')
  if (p === '') return null
  // `./x` and `x` are the same file, so collapsing them keeps a hook declared for several
  // events from producing duplicate findings. A LEADING slash is never touched — that is the
  // distinction this function exists for.
  while (p.startsWith('./')) p = p.slice(2)
  p = p.replace(/(?<!^)\/{2,}/g, '/')
  return p === '' ? null : p
}

/**
 * Which of these changed files alter what the agent is allowed to do?
 *
 * Errs toward *flagging*: matching is case-insensitive, so `claude.md` and `Claude.MD` are
 * both reported. On a case-insensitive filesystem they are literally the same file, and the
 * cost asymmetry is stark — a false flag costs a reviewer one glance, a miss lets a PR
 * silently rewrite the agent's instructions.
 *
 * Returns `{ sensitive, flagged, malformed, checked }`. `malformed` carries entries we could
 * not turn into a path; they are neither flagged nor cleared (unknown is a value).
 */
export function flagSensitiveChanges(changedFiles) {
  const flagged = []
  const malformed = []
  const seen = new Set()
  const input = Array.isArray(changedFiles) ? changedFiles : changedFiles == null ? [] : [changedFiles]

  for (let i = 0; i < input.length; i++) {
    const value = input[i]
    const path = normalisePath(value)
    if (path === null) {
      malformed.push({ index: i, value: isStr(value) || isFiniteNum(value) ? value : typeof value, reason: 'entry has no usable path' })
      continue
    }
    const lower = path.toLowerCase()
    const segments = lower.split('/')
    const base = segments[segments.length - 1]

    for (const rule of SENSITIVE_PATHS) {
      const needle = rule.pattern.toLowerCase()
      let hit = false
      let matchedOn = null
      if (rule.kind === 'directory') {
        const dir = needle.slice(0, -1)
        // Segment equality, never `startsWith` on the whole string: `.clauderc` and
        // `.claude-backup/x` must not look like `.claude/`.
        const idx = segments.indexOf(dir)
        if (idx !== -1 && idx < segments.length - 1) {
          hit = true
          matchedOn = `${dir}/`
        }
      } else if (base === needle) {
        // Exact basename equality. `CLAUDE.md.bak` has basename `claude.md.bak` != `claude.md`.
        hit = true
        matchedOn = base
      }
      if (!hit) continue
      const key = `${path}|${rule.pattern}`
      if (seen.has(key)) continue
      seen.add(key)
      flagged.push({
        path,
        rule: rule.pattern,
        kind: rule.kind,
        matchedOn,
        reason: rule.reason,
        message: `${path} changes ${rule.pattern} (${rule.reason}) — this PR alters what the agent is allowed to do`,
      })
    }
  }

  return { sensitive: flagged.length > 0, flagged, malformed, checked: input.length }
}

// =======================================================================================
// 010 — manifest / registry integrity checker
// =======================================================================================

/**
 * Check that everything a manifest, settings file or registry points at is actually there.
 *
 * `entries`  — `{ source, kind, path }`: who referenced it, what kind of thing it is
 *              (`hook`, `mcp-server`, `skill`, `command`, `agent`, …), and the path claimed.
 * `exists`   — injected predicate `path => boolean`. Injected rather than calling `fs` so the
 *              rule set stays pure and every branch is unit-testable.
 *
 * Every finding names BOTH the referring file and the missing target, because "something is
 * broken" is not an actionable report.
 *
 * A predicate that throws, or answers with anything other than a boolean, produces an
 * `unknown` record — not a dangling one. We refuse to accuse a path of being missing on the
 * strength of an answer we did not understand.
 */
export function checkReferencedPaths(entries, exists) {
  const dangling = []
  const unknown = []
  const malformed = []
  const ok = []
  const seen = new Set()
  const list = Array.isArray(entries) ? entries : entries == null ? [] : [entries]
  const hasPredicate = typeof exists === 'function'

  for (let i = 0; i < list.length; i++) {
    const entry = list[i]
    if (!isObj(entry)) {
      malformed.push({ index: i, reason: 'entry is not an object', value: typeof entry })
      continue
    }
    const source = isStr(entry.source) && entry.source.trim() !== '' ? entry.source.trim() : null
    const path = normaliseFsPath(entry.path ?? entry.target)
    const kind = isStr(entry.kind) && entry.kind.trim() !== '' ? entry.kind.trim() : 'reference'
    if (source === null || path === null) {
      malformed.push({
        index: i,
        reason: source === null && path === null ? 'entry names neither a source nor a path'
          : source === null ? 'entry has no source — a finding could not say who referenced it'
          : 'entry has no path — a finding could not say what is missing',
        source, path, kind,
      })
      continue
    }

    const record = { source, kind, path }
    const key = `${source}|${kind}|${path}`
    if (seen.has(key)) continue
    seen.add(key)

    if (!hasPredicate) {
      unknown.push({ ...record, reason: 'no exists predicate was supplied', message: `${source} references ${kind} ${path}; existence was not checked (no predicate supplied)` })
      continue
    }

    let answer
    try {
      answer = exists(path, record)
    } catch (err) {
      unknown.push({ ...record, reason: `exists predicate threw: ${err && err.message ? err.message : String(err)}`, message: `${source} references ${kind} ${path}; existence is unknown because the check failed` })
      continue
    }
    if (answer === true) {
      ok.push(record)
    } else if (answer === false) {
      dangling.push({ ...record, message: `${source} references ${kind} ${path}, which does not exist` })
    } else {
      unknown.push({ ...record, reason: `exists predicate returned ${answer === null ? 'null' : typeof answer}, not a boolean`, message: `${source} references ${kind} ${path}; existence is unknown` })
    }
  }

  return { ok, dangling, unknown, malformed, checked: list.length, intact: dangling.length === 0 && unknown.length === 0 && malformed.length === 0 }
}

// =======================================================================================
// 019 — skill security content scanner
// =======================================================================================

export const SEVERITY_ORDER = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1, info: 0 })

const DEFAULT_MAX_EVIDENCE = 200
const DEFAULT_MAX_FINDINGS = 200
const DEFAULT_MAX_TEXT = 1_000_000

// Hosts that are not a transmission out of the machine, or are reserved for documentation
// (RFC 2606 / RFC 6761). Everything else is treated as a real external endpoint.
const NON_TRANSMITTING_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]', 'example.com', 'www.example.com', 'example.org', 'example.net', 'test', 'invalid', 'localhost.localdomain'])

const PLACEHOLDER_HINTS = /^(?:x+|y+|\.+|-+)$|your|example|placeholder|redacted|changeme|change_me|dummy|sample|fake|todo|insert|here|xxxx|<|\$\{|\{\{|%s/i

/**
 * Rule table. Each rule declares WHICH WAY IT ERRS, because that is the only honest way to
 * read a security scanner's output. The standing instruction is "prefer a miss to a false
 * accusation", so most rules require a verb *and* a target, or a high-specificity literal.
 */
const CONTENT_RULES = [
  // --- credential exposure -------------------------------------------------------------
  {
    code: 'SKILL_CREDENTIAL_LITERAL', severity: 'critical', category: 'credential-exposure',
    // Errs toward a MISS: only well-known, high-specificity key formats with a real length
    // floor. A short or generic-looking string is left alone rather than guessed at.
    patterns: [
      /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
      /\bsk-[A-Za-z0-9]{32,}/g,
      /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
      /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
      /\bAKIA[0-9A-Z]{16}\b/g,
      /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
      /\bAIza[0-9A-Za-z_-]{35}\b/g,
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
    ],
    message: 'skill text contains what looks like a live credential',
  },
  {
    code: 'SKILL_CREDENTIAL_ASSIGNMENT', severity: 'high', category: 'credential-exposure',
    // Errs toward a MISS: a 20+ char opaque value is required, and anything that reads like a
    // placeholder (`your-key-here`, `${API_KEY}`, `xxxx`) is dropped by `reject` below.
    patterns: [/\b(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|auth[_-]?token|password|passwd|client[_-]?secret)\s*[:=]\s*["']?([A-Za-z0-9_\-/+=.]{20,})["']?/gi],
    reject: m => PLACEHOLDER_HINTS.test(m[1] ?? '') || /^[A-Za-z0-9]$/.test((m[1] ?? '').replace(/(.)\1*/g, '$1')),
    message: 'skill text assigns a literal-looking secret to a credential-named variable',
  },
  {
    code: 'SKILL_CREDENTIAL_HARVEST', severity: 'high', category: 'credential-exposure',
    // Errs toward a MISS: requires a read/emit verb within ~60 chars of a known credential
    // store. Merely naming `.env` in prose is not enough to fire.
    patterns: [/\b(?:cat|read|open|print|echo|dump|include|send|post|upload|attach|copy|exfiltrate|transmit|base64)\b[^\n]{0,60}?(?:~?\/?\.aws\/credentials|~?\/?\.ssh\/id_[a-z0-9_]+|~?\/?\.netrc|~?\/?\.npmrc|~?\/?\.claude\.json|~?\/?\.docker\/config\.json|~?\/?\.kube\/config|\.env(?:\.[a-z]+)?\b|credentials\.json)/gi],
    message: 'skill text instructs reading or emitting a credential store',
  },

  // --- governance / logging bypass -----------------------------------------------------
  {
    code: 'SKILL_GOVERNANCE_BYPASS', severity: 'high', category: 'governance-bypass',
    // Errs toward a MISS: the negation and the governance noun must be adjacent. A sentence
    // that merely discusses logging, or says "log this", does not match.
    patterns: [
      /\b(?:without|skip(?:ping)?|bypass(?:ing)?|disabl(?:e|ing)|circumvent(?:ing)?|suppress(?:ing)?|turn(?:ing)? off)\s+(?:the\s+|any\s+|all\s+)?(?:logging|logs?|audit(?:ing)?(?:\s+trail)?|telemetry|hooks?|pre-?commit(?:\s+hooks?)?|permission(?:s| checks?| prompts?)?|approvals?|reviews?|guardrails?|governance|sandbox(?:ing)?)\b/gi,
      /\b(?:do not|don'?t|never|avoid)\s+(?:\w+\s+){0,2}?(?:log|record|audit|report|mention|tell|notify|inform|disclose|surface)\b/gi,
      /\bignore\s+(?:all\s+|any\s+)?(?:previous|prior|earlier|above|preceding)\s+instructions?\b/gi,
      /\b(?:override|ignore|disregard|bypass)\s+(?:the\s+|any\s+)?(?:CLAUDE\.md|CLAUDE\.local\.md|system prompt|user instructions?|settings\.json|\.claude\/[\w./-]*)/gi,
    ],
    message: 'skill text instructs bypassing governance, approval or logging',
  },
  {
    code: 'SKILL_HOOK_EVASION', severity: 'high', category: 'governance-bypass',
    // Errs toward a MISS: these are exact, unambiguous mechanisms for skipping a gate.
    patterns: [
      /--no-verify\b/g,
      /\bHUSKY\s*=\s*0\b/g,
      /--dangerously-skip-permissions\b/g,
      /\bpermission[_-]?[Mm]ode\s*[:=]\s*["']?bypassPermissions\b/g,
      /\bgit\s+(?:commit|push)\b[^\n]{0,80}\s-n\b/g,
    ],
    message: 'skill text uses a flag or variable that skips a configured gate',
  },
  {
    code: 'SKILL_LOG_TAMPERING', severity: 'critical', category: 'governance-bypass',
    // Errs toward a MISS: a destructive verb must be within ~60 chars of an audit surface.
    patterns: [
      /\b(?:rm|shred|truncate|unlink|del)\b[^\n]{0,60}?(?:\.claude\b|\.claude\.json|audit|\blogs?\b|\.bash_history|transcripts?|history)/gi,
      /\bhistory\s+-c\b/g,
      /\b(?:>|>\|)\s*(?:~?\/?[\w./-]*(?:audit|\.log|history)[\w./-]*)\s*$/gim,
    ],
    message: 'skill text instructs deleting or overwriting an audit surface',
  },

  // --- excessive tool access -----------------------------------------------------------
  {
    code: 'SKILL_BROAD_TOOL_GRANT', severity: 'high', category: 'excessive-access',
    // Errs toward a MISS: only an actual wildcard in an actual grant field fires. A skill
    // that lists many specific tools is not flagged here — breadth alone is not a finding.
    patterns: [
      /\ballowed[_-]?tools\s*:\s*[^\n]*\*/gi,
      /"allow"\s*:\s*\[\s*"\*"/g,
      /\bBash\(\s*\*(?:\s*:\s*\*)?\s*\)/g,
      /\bauto[_-]?[Aa]pprove\s*[:=]\s*true\b/g,
      /\bdisallowed[_-]?tools\s*:\s*(?:\[\s*\]|none|""|'')\s*$/gim,
    ],
    message: 'skill grants itself wildcard or auto-approved tool access',
  },
  {
    code: 'SKILL_PRIVILEGE_ESCALATION', severity: 'medium', category: 'excessive-access',
    // Errs toward a MISS: `sudo` must be followed by a command, and only world-writable
    // chmod modes count. `sudo` inside a quoted error message will still fire — accepted.
    patterns: [/\bsudo\s+(?!-h\b|--help\b)[a-z][\w./-]*/gi, /\bchmod\s+(?:-R\s+)?(?:777|a\+rwx|o\+w)\b/gi],
    message: 'skill text escalates privileges beyond what a skill should need',
  },
  {
    code: 'SKILL_REMOTE_CODE_EXECUTION', severity: 'critical', category: 'excessive-access',
    // Errs toward a MISS: requires a fetch piped directly into an interpreter, or eval of a
    // fetch result. Downloading a file on its own does not match.
    patterns: [
      /\b(?:curl|wget)\b[^\n|]{0,160}\|\s*(?:sudo\s+)?(?:ba|z|k)?sh\b/gi,
      /\b(?:curl|wget)\b[^\n|]{0,160}\|\s*(?:sudo\s+)?(?:python3?|node|perl|ruby)\b/gi,
      /\beval\s*\(\s*(?:await\s+)?(?:fetch|require\s*\(\s*['"]child_process)/gi,
    ],
    message: 'skill text executes code fetched at runtime from the network',
  },

  // --- transmission to an undeclared endpoint ------------------------------------------
  {
    code: 'SKILL_DATA_EXFILTRATION', severity: 'critical', category: 'undeclared-transmission',
    // Errs toward a MISS: local content must be demonstrably fed into the request body.
    patterns: [
      /\bcurl\b[^\n]{0,200}?(?:--data-binary|--data|-d)\s*[@"']?\$?\(?\s*(?:cat|<)\s/gi,
      /\bcurl\b[^\n]{0,200}?(?:-F|--form)\s+["']?\w+=@/gi,
      /\b(?:cat|env|printenv|tar|zip)\b[^\n|]{0,120}\|\s*(?:curl|wget|nc|ncat|netcat)\b/gi,
    ],
    message: 'skill text pipes local file or environment contents into a network request',
  },
]

const TRANSMIT_VERB = /\b(?:curl|wget|fetch|axios|xhr|httpx?|requests\.(?:post|get|put)|urllib|nc|ncat|netcat|scp|rsync|post|put|upload|send|report|beacon|webhook|exfiltrate|transmit)\b/i

const buildLineIndex = text => {
  const offsets = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') offsets.push(i + 1)
  return offsets
}

const lineOf = (offsets, index) => {
  let lo = 0
  let hi = offsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= index) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

const clipEvidence = (span, max) => {
  const flat = span.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return { evidence: flat, evidenceTruncated: false }
  return { evidence: `${flat.slice(0, max)}…`, evidenceTruncated: true, evidenceFullLength: flat.length }
}

const hostOf = url => {
  const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^/@\s]*@)?(\[[^\]]+\]|[^/:?#\s]+)/i)
  return m ? m[1].toLowerCase() : null
}

/**
 * Scan skill / instruction text for content that exposes credentials, bypasses governance or
 * logging, transmits to an undeclared endpoint, or grants itself excessive tool access.
 *
 * IMPORTANT — there is deliberately NO trust bypass. There is no `opts.internal`,
 * `opts.trusted`, `opts.local` or "this file is ours" short-circuit anywhere in this function.
 * An internally-authored skill is scanned by exactly the same rules as a downloaded one:
 * provenance is not evidence of behaviour, and the failure mode we care about (a skill that
 * quietly reads credentials) looks identical whoever wrote it.
 *
 * `opts`:
 *   `declaredEndpoints`  hosts (or URLs) this skill has declared. Anything else it transmits
 *                        to is reported. Absent → still reported, with the message saying no
 *                        declaration list was supplied.
 *   `allowedTools`       tool names this skill is permitted to request.
 *   `maxEvidenceChars`   default 200. `maxFindings` default 200. `maxTextChars` default 1e6.
 *                        Hitting any of these emits its own `info` finding — no silent caps.
 *
 * Returns an array of `{ severity, code, message, evidence, ... }`, worst first. Malformed
 * input returns a single `SCAN_INPUT_UNUSABLE` info finding rather than throwing.
 */
export function scanSkillContent(text, opts = {}) {
  const options = isObj(opts) ? opts : {}
  const maxEvidence = isFiniteNum(options.maxEvidenceChars) && options.maxEvidenceChars > 0 ? Math.floor(options.maxEvidenceChars) : DEFAULT_MAX_EVIDENCE
  const maxFindings = isFiniteNum(options.maxFindings) && options.maxFindings > 0 ? Math.floor(options.maxFindings) : DEFAULT_MAX_FINDINGS
  const maxText = isFiniteNum(options.maxTextChars) && options.maxTextChars > 0 ? Math.floor(options.maxTextChars) : DEFAULT_MAX_TEXT

  if (!isStr(text)) {
    return [{
      severity: 'info', code: 'SCAN_INPUT_UNUSABLE',
      message: `skill content could not be scanned: expected a string, received ${text === null ? 'null' : Array.isArray(text) ? 'array' : typeof text}`,
      evidence: '',
    }]
  }

  const findings = []
  let body = text
  if (body.length > maxText) {
    body = body.slice(0, maxText)
    findings.push({
      severity: 'info', code: 'SCAN_INPUT_TRUNCATED',
      message: `skill content is ${text.length} characters; only the first ${maxText} were scanned`,
      evidence: '', category: 'scan-bound',
    })
  }
  const offsets = buildLineIndex(body)
  const seen = new Set()

  const push = (f, index, span) => {
    const key = `${f.code}|${index}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push({ ...f, index, line: lineOf(offsets, index), ...clipEvidence(span, maxEvidence) })
  }

  for (const rule of CONTENT_RULES) {
    for (const pattern of rule.patterns) {
      try {
        const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
        let m
        let guard = 0
        while ((m = re.exec(body)) !== null && guard++ < 10_000) {
          if (m[0] === '') { re.lastIndex++; continue }
          if (typeof rule.reject === 'function' && rule.reject(m)) continue
          push({ severity: rule.severity, code: rule.code, category: rule.category, message: rule.message }, m.index, m[0])
        }
      } catch (err) {
        findings.push({
          severity: 'info', code: 'SCAN_RULE_ERROR', category: 'scan-bound',
          message: `rule ${rule.code} failed to run: ${err && err.message ? err.message : String(err)}`,
          evidence: '',
        })
      }
    }
  }

  // --- undeclared endpoints ------------------------------------------------------------
  // Errs toward a MISS: a URL only counts if a transmission verb appears on the same line.
  // A URL cited in prose ("see https://docs…") is left alone.
  const declared = new Set()
  for (const d of arr(options.declaredEndpoints)) {
    if (!isStr(d)) continue
    const h = hostOf(d) ?? d.trim().toLowerCase()
    if (h !== '') declared.add(h.replace(/^www\./, ''))
  }
  const declarationSupplied = declared.size > 0
  const urlRe = /\bhttps?:\/\/[^\s"'`<>)\]}\\]+/gi
  let um
  while ((um = urlRe.exec(body)) !== null) {
    const host = hostOf(um[0])
    if (host === null) continue
    const bare = host.replace(/^www\./, '')
    if (NON_TRANSMITTING_HOSTS.has(host) || NON_TRANSMITTING_HOSTS.has(bare)) continue
    if (/^127\./.test(bare) || bare.endsWith('.local') || bare.endsWith('.localhost')) continue
    if (declared.has(bare)) continue
    const lineStart = body.lastIndexOf('\n', um.index) + 1
    let lineEnd = body.indexOf('\n', um.index)
    if (lineEnd === -1) lineEnd = body.length
    const line = body.slice(lineStart, lineEnd)
    if (!TRANSMIT_VERB.test(line)) continue
    const rawIp = /^\[?[0-9a-f:.]+\]?$/i.test(bare) && /\d/.test(bare)
    push({
      severity: rawIp ? 'high' : 'medium',
      code: 'SKILL_UNDECLARED_ENDPOINT',
      category: 'undeclared-transmission',
      message: declarationSupplied
        ? `skill transmits to ${host}, which is not in its declared endpoints`
        : `skill transmits to ${host}; no declared-endpoint list was supplied, so this could not be reconciled against a declaration`,
      host,
      declarationSupplied,
    }, lineStart, line)
  }

  // --- tool requests beyond the allowlist ----------------------------------------------
  // Errs toward a MISS: only fires when the caller supplied an allowlist, and only reads
  // explicit `allowed-tools:` / `tools:` declarations, never prose mentioning a tool name.
  if (Array.isArray(options.allowedTools)) {
    const allow = new Set(options.allowedTools.filter(isStr).map(t => t.trim().split('(')[0].toLowerCase()).filter(Boolean))
    const declRe = /^\s*(?:allowed[_-]?tools|tools)\s*:\s*(.+)$/gim
    let dm
    while ((dm = declRe.exec(body)) !== null) {
      const raw = dm[1].trim().replace(/^\[|\]$/g, '')
      for (const piece of raw.split(',')) {
        const name = piece.trim().replace(/^["']|["']$/g, '')
        if (name === '') continue
        const base = name.split('(')[0].trim().toLowerCase()
        if (base === '' || allow.has(base)) continue
        push({
          severity: 'medium', code: 'SKILL_TOOL_ESCALATION', category: 'excessive-access',
          message: `skill requests tool "${name}", which is not in the allowed tool set`,
          tool: name,
        }, dm.index + dm[0].indexOf(name), name)
      }
    }
  }

  findings.sort((a, b) => (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0) || (a.index ?? 0) - (b.index ?? 0) || a.code.localeCompare(b.code))

  if (findings.length > maxFindings) {
    const dropped = findings.length - maxFindings
    const kept = findings.slice(0, maxFindings)
    // No silent caps: the truncation is itself a finding, with the exact count dropped.
    kept.push({
      severity: 'info', code: 'SCAN_FINDINGS_TRUNCATED', category: 'scan-bound',
      message: `${findings.length} findings were produced; ${dropped} beyond the limit of ${maxFindings} are not listed`,
      evidence: '',
    })
    return kept
  }
  return findings
}

// =======================================================================================
// 009 — declarative run expectations
// =======================================================================================

/** Default weight per check kind. Overridable per expectation entry via `weights`. */
export const DEFAULT_WEIGHTS = Object.freeze({ agent: 10, file: 10, artifact: 10, limit: 15, forbidden: 20 })

/**
 * Declarative expectations: a task pattern mapped to the agents, files, artifacts and limits
 * a compliant run of that task should show. This is configuration, not logic — callers are
 * expected to pass their own array to `scoreRun` when their governance differs.
 */
export const EXPECTATION_SCHEMA = Object.freeze([
  Object.freeze({
    id: 'security-review',
    pattern: /\bsecurit(?:y|ies)\s+(?:review|audit|scan)\b|\bvulnerabilit(?:y|ies)\b|\bthreat model\b/i,
    description: 'a security review reads and reports; it must not quietly change the code it is reviewing',
    expect: Object.freeze({
      agents: ['security-reviewer'],
      artifacts: ['security-findings'],
      limits: Object.freeze({ maxFilesChanged: 0 }),
    }),
  }),
  Object.freeze({
    id: 'dependency-change',
    pattern: /\b(?:upgrade|bump|update|pin|add|remove)\b[^\n]{0,40}\b(?:dependenc(?:y|ies)|package(?:s|\.json)?|lockfile|npm|node_modules)\b/i,
    description: 'a dependency change must move the manifest and the lockfile together and stay small',
    expect: Object.freeze({
      files: ['package.json', 'package-lock.json'],
      artifacts: ['test-run'],
      limits: Object.freeze({ maxFilesChanged: 25 }),
    }),
  }),
  Object.freeze({
    id: 'feature',
    pattern: /\b(?:add|implement|build|create|introduce)\b/i,
    description: 'new behaviour ships with tests and a test run',
    expect: Object.freeze({
      files: ['test/'],
      artifacts: ['test-run'],
      limits: Object.freeze({ maxFilesChanged: 40 }),
    }),
  }),
  Object.freeze({
    id: 'bugfix',
    pattern: /\b(?:fix(?:es|ed)?|bug|regression|broken|failing)\b/i,
    description: 'a fix ships the regression test that would have caught it',
    expect: Object.freeze({
      files: ['test/'],
      artifacts: ['test-run'],
      limits: Object.freeze({ maxRetries: 3 }),
    }),
  }),
  Object.freeze({
    id: 'documentation',
    pattern: /\b(?:docs?|documentation|readme|changelog|comment(?:s|ing)?)\b/i,
    description: 'a documentation task stays in documentation and does not touch shipped code',
    expect: Object.freeze({
      files: ['*.md'],
      limits: Object.freeze({ maxFilesChanged: 10 }),
      forbid: Object.freeze({ files: ['lib/', 'server/', 'src/'] }),
    }),
  }),
  Object.freeze({
    id: 'refactor',
    pattern: /\brefactor(?:ing|ed)?\b|\bclean\s?up\b|\brename\b|\bextract\b/i,
    description: 'a refactor preserves behaviour, so it must be backed by a test run',
    expect: Object.freeze({
      artifacts: ['test-run'],
      limits: Object.freeze({ maxFilesChanged: 60 }),
    }),
  }),
])

/** limit key → { metric, comparator }. `max*` fails when actual exceeds; `min*` when below. */
const LIMIT_METRICS = Object.freeze({
  maxFilesChanged: { metric: 'filesChanged', dir: 'max' },
  maxToolCalls: { metric: 'toolCalls', dir: 'max' },
  maxDurationMs: { metric: 'durationMs', dir: 'max' },
  maxCostUsd: { metric: 'costUsd', dir: 'max' },
  maxRetries: { metric: 'retries', dir: 'max' },
  maxLinesChanged: { metric: 'linesChanged', dir: 'max' },
  minTestsRun: { metric: 'testsRun', dir: 'min' },
  minFilesChanged: { metric: 'filesChanged', dir: 'min' },
})

/** Does `actual` (a normalised path) satisfy `expected`? Supports `dir/`, `*.ext` and exact. */
const pathSatisfies = (expected, actualPaths) => {
  const want = normalisePath(expected)
  if (want === null) return false
  const lower = want.toLowerCase()
  if (lower.endsWith('/')) return actualPaths.some(p => p.startsWith(lower))
  if (lower.includes('*')) {
    const re = new RegExp(`^${lower.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`)
    return actualPaths.some(p => re.test(p) || re.test(p.slice(p.lastIndexOf('/') + 1)))
  }
  return actualPaths.some(p => p === lower || p.endsWith(`/${lower}`))
}

const normaliseList = value => {
  if (value == null) return null // unknown: the run did not report this dimension at all
  if (!Array.isArray(value)) return null
  return value.map(v => normalisePath(v) ?? (isStr(v) ? v.trim().toLowerCase() : null)).filter(v => v !== null).map(v => v.toLowerCase())
}

const metricsOf = run => {
  const base = isObj(run?.metrics) ? { ...run.metrics } : {}
  for (const k of ['filesChanged', 'toolCalls', 'durationMs', 'costUsd', 'retries', 'linesChanged', 'testsRun']) {
    if (base[k] === undefined && isFiniteNum(run?.[k])) base[k] = run[k]
  }
  if (base.filesChanged === undefined && Array.isArray(run?.files)) base.filesChanged = run.files.length
  if (base.filesChanged === undefined && Array.isArray(run?.changedFiles)) base.filesChanged = run.changedFiles.length
  return base
}

/**
 * Score a run against declared expectations.
 *
 * Returns `{ score, scoreExact, violations, matched, unevaluated, applied, accounting }`.
 *
 * The score is explainable by construction: every evaluable check carries a weight, the
 * weights of the evaluable checks are normalised to 100, and each violation carries the exact
 * `points` it removed. `score === 100 - sum(violations.points)` up to 2dp rounding, and
 * `accounting` publishes the divisor so a reader can redo the arithmetic.
 *
 * A check the run gives us no data for (no `agents` array at all, no `toolCalls` metric) is
 * reported in `unevaluated` and is excluded from BOTH numerator and denominator. It is not a
 * pass and it is not a violation — we do not know, and a governance tool that guesses is worse
 * than one that says so. If nothing is evaluable, `score` is `null`.
 */
export function scoreRun(run, expectations) {
  try {
    return scoreRunInner(run, expectations)
  } catch (err) {
    return {
      score: null, scoreExact: null, violations: [], matched: [],
      unevaluated: [{ code: 'SCORE_FAILED', reason: err && err.message ? err.message : String(err) }],
      applied: [], accounting: { evaluableWeight: 0, pointsPerWeight: null, lostPoints: 0 },
      reason: 'scoring-failed',
    }
  }
}

function scoreRunInner(run, expectations) {
  const r = isObj(run) ? run : {}
  const task = isStr(r.task) ? r.task : isStr(r.prompt) ? r.prompt : isStr(r.title) ? r.title : null

  const supplied = Array.isArray(expectations) ? expectations : expectations == null ? null : [expectations]
  let applicable
  if (supplied === null) {
    applicable = task === null ? [] : EXPECTATION_SCHEMA.filter(e => { try { return e.pattern.test(task) } catch { return false } })
  } else {
    applicable = supplied.filter(isObj).filter(e => {
      if (!(e.pattern instanceof RegExp)) return true // an explicitly supplied expectation with no pattern always applies
      if (task === null) return false
      try { return e.pattern.test(task) } catch { return false }
    })
  }

  const checks = []
  const unevaluated = []
  const applied = []

  const agents = normaliseList(r.agents ?? r.agentsUsed)
  const files = normaliseList(r.files ?? r.changedFiles)
  const artifacts = normaliseList(r.artifacts ?? r.outputs)
  const metrics = metricsOf(r)

  for (const entry of applicable) {
    const id = isStr(entry.id) ? entry.id : 'expectation'
    applied.push(id)
    const expect = isObj(entry.expect) ? entry.expect : entry
    const weights = { ...DEFAULT_WEIGHTS, ...(isObj(entry.weights) ? entry.weights : {}) }

    const dimension = (kind, expectedList, actual, actualName) => {
      const wanted = arr(expectedList).filter(v => isStr(v) && v.trim() !== '')
      if (wanted.length === 0) return
      if (actual === null) {
        for (const w of wanted) {
          unevaluated.push({
            expectation: id, kind, target: w, weight: weights[kind] ?? 0,
            reason: `run reported no ${actualName} list`,
            message: `[${id}] expected ${kind} "${w}" — not evaluated: the run reported no ${actualName} list`,
          })
        }
        return
      }
      for (const w of wanted) {
        const pass = kind === 'file' ? pathSatisfies(w, actual) : actual.includes(w.trim().toLowerCase())
        checks.push({
          expectation: id, kind, target: w, weight: weights[kind] ?? 0, pass,
          expected: w, actual: actual.length === 0 ? '(none)' : actual.join(', '),
          code: pass ? `${kind.toUpperCase()}_PRESENT` : `MISSING_${kind.toUpperCase()}`,
          message: pass
            ? `[${id}] expected ${kind} "${w}" was present`
            : `[${id}] expected ${kind} "${w}" was not present in the run`,
        })
      }
    }

    dimension('agent', expect.agents, agents, 'agents')
    dimension('file', expect.files, files, 'files')
    dimension('artifact', expect.artifacts, artifacts, 'artifacts')

    // forbidden dimensions: presence is the violation
    const forbid = isObj(expect.forbid) ? expect.forbid : {}
    const forbidden = (kind, list, actual, actualName) => {
      const banned = arr(list).filter(v => isStr(v) && v.trim() !== '')
      if (banned.length === 0) return
      if (actual === null) {
        for (const b of banned) {
          unevaluated.push({
            expectation: id, kind: 'forbidden', target: b, weight: weights.forbidden,
            reason: `run reported no ${actualName} list`,
            message: `[${id}] forbidden ${kind} "${b}" — not evaluated: the run reported no ${actualName} list`,
          })
        }
        return
      }
      for (const b of banned) {
        const present = kind === 'file' ? pathSatisfies(b, actual) : actual.includes(b.trim().toLowerCase())
        checks.push({
          expectation: id, kind: 'forbidden', target: b, weight: weights.forbidden, pass: !present,
          expected: `no ${kind} matching "${b}"`, actual: actual.length === 0 ? '(none)' : actual.join(', '),
          code: present ? `FORBIDDEN_${kind.toUpperCase()}_TOUCHED` : 'FORBIDDEN_CLEAR',
          message: present
            ? `[${id}] forbidden ${kind} "${b}" was touched by this run`
            : `[${id}] forbidden ${kind} "${b}" was not touched`,
        })
      }
    }
    forbidden('file', forbid.files, files, 'files')
    forbidden('agent', forbid.agents, agents, 'agents')

    // limits
    const limits = isObj(expect.limits) ? expect.limits : {}
    for (const [key, bound] of Object.entries(limits)) {
      const spec = LIMIT_METRICS[key]
      if (!spec) {
        unevaluated.push({
          expectation: id, kind: 'limit', target: key, weight: weights.limit,
          reason: 'unrecognised limit key', message: `[${id}] limit "${key}" — not evaluated: no metric is mapped to this limit`,
        })
        continue
      }
      if (!isFiniteNum(bound)) {
        unevaluated.push({
          expectation: id, kind: 'limit', target: key, weight: weights.limit,
          reason: `limit bound is not a finite number (${bound === null ? 'null' : typeof bound})`,
          message: `[${id}] limit "${key}" — not evaluated: the declared bound is not a number`,
        })
        continue
      }
      const actual = metrics[spec.metric]
      if (!isFiniteNum(actual)) {
        unevaluated.push({
          expectation: id, kind: 'limit', target: key, weight: weights.limit, bound,
          reason: `run reported no ${spec.metric} metric`,
          message: `[${id}] limit "${key}" (${spec.metric} ${spec.dir === 'max' ? '<=' : '>='} ${bound}) — not evaluated: the run reported no ${spec.metric}`,
        })
        continue
      }
      const pass = spec.dir === 'max' ? actual <= bound : actual >= bound
      checks.push({
        expectation: id, kind: 'limit', target: key, weight: weights.limit, pass,
        expected: `${spec.metric} ${spec.dir === 'max' ? '<=' : '>='} ${bound}`, actual,
        code: pass ? 'LIMIT_RESPECTED' : `LIMIT_EXCEEDED_${key.toUpperCase()}`,
        message: pass
          ? `[${id}] ${spec.metric} was ${actual} (bound ${spec.dir === 'max' ? '<=' : '>='} ${bound})`
          : `[${id}] ${spec.metric} was ${actual}, outside the declared bound of ${spec.dir === 'max' ? '<=' : '>='} ${bound}`,
      })
    }
  }

  const evaluableWeight = checks.reduce((s, c) => s + (isFiniteNum(c.weight) ? c.weight : 0), 0)
  const matched = checks.filter(c => c.pass)
  const failed = checks.filter(c => !c.pass)

  if (evaluableWeight <= 0) {
    return {
      score: null, scoreExact: null,
      violations: failed.map(c => ({ ...c, points: 0 })),
      matched,
      unevaluated,
      applied,
      accounting: { evaluableWeight: 0, pointsPerWeight: null, lostPoints: 0, checksEvaluated: checks.length, checksUnevaluated: unevaluated.length },
      reason: applicable.length === 0
        ? (task === null ? 'no-task-to-match' : 'no-expectation-matched')
        : 'nothing-evaluable',
    }
  }

  const pointsPerWeight = 100 / evaluableWeight
  const violations = failed.map(c => ({ ...c, points: round2((isFiniteNum(c.weight) ? c.weight : 0) * pointsPerWeight) }))
  const lostRaw = failed.reduce((s, c) => s + (isFiniteNum(c.weight) ? c.weight : 0), 0) * pointsPerWeight
  const scoreExact = round2(Math.max(0, Math.min(100, 100 - lostRaw)))

  return {
    score: Math.round(scoreExact),
    scoreExact,
    violations,
    matched: matched.map(c => ({ ...c, points: round2((isFiniteNum(c.weight) ? c.weight : 0) * pointsPerWeight) })),
    unevaluated,
    applied,
    accounting: {
      evaluableWeight,
      pointsPerWeight: round2(pointsPerWeight),
      lostPoints: round2(lostRaw),
      checksEvaluated: checks.length,
      checksUnevaluated: unevaluated.length,
      // Present so a reader can verify the score decomposes exactly; rounding of individual
      // point values is display-only and never feeds back into the score.
      rounding: 'score computed from raw weights; per-violation points rounded to 2dp for display',
    },
    reason: null,
  }
}
