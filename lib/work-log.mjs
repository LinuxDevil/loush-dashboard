// lib/work-log.mjs — parse an agent's `## Work Log` markdown section, and reconcile the files it
// CLAIMS it changed against the files we OBSERVED it change via tool calls.
//
// WHY THIS EXISTS
// server/index.mjs:1051 derives "files this agent touched" from tool_use blocks:
//
//     if (['Edit','Write','MultiEdit','NotebookEdit'].includes(c.name) && c.input?.file_path)
//       a.files.add(c.input.file_path)
//
// That list is evidence, but it is INCOMPLETE by construction. An agent that writes a file with
// `Bash(sed -i ...)`, `Bash(cat > f)`, `Bash(git apply)`, `Bash(python -c "...open(f,'w')...")` or a
// script it just wrote produces ZERO Edit/Write tool calls, so the file never enters that set. The
// dashboard then reports "this run changed 3 files" when it changed 9, and the forensics view has no
// row for the six that matter most (shell-mediated edits are exactly the ones nobody reviewed).
//
// The Work Log is a SECOND, INDEPENDENT signal for the same question. It is not better evidence —
// it is a self-report, and a model can report an edit it never made. It is useful precisely because
// it fails differently: it sees Bash edits, and it can lie; tool-call parsing cannot see Bash edits,
// and cannot lie. Where the two disagree, the disagreement IS the finding.
//
// HOUSE RULES ENFORCED HERE
//  · Every field carrying a model's assertion is named `selfReported*` and every returned record
//    carries `evidence: 'self-reported'`. A caller cannot render a claim as a measurement by accident.
//  · Absent facts are `{ value: null, reason }` — never `'unknown'`, never `'pass'`, never `''`.
//    A code-reviewer result that was not written down is NOT a passing code review.
//  · No silent caps: every truncation is reported in `caps`.
//  · Never throws. Malformed or absent Work Log → `{ ok: false, reason }`, never a well-formed
//    object with empty arrays (which reads to a caller as "parsed fine, agent changed nothing").

// Bound on input we will scan. A transcript entry can be megabytes; scanning is O(n) but the caller
// deserves to know we stopped rather than to receive a silently short answer.
export const MAX_SOURCE_CHARS = 2_000_000
// Bound on entries per bucket. Reported, never silent.
export const MAX_ITEMS_PER_BUCKET = 500

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/
// `## Work Log`, `### Work log`, `## Work Log (session 3)` — heading text starting with "work log".
const IS_WORK_LOG = t => /^work\s*log\b/i.test(t.trim())

// Bucket labels the agent may use. Matched case-insensitively against either a bullet's `label:`
// prefix or a sub-heading. Kept explicit rather than fuzzy: a label we do not recognise goes to
// `selfReportedItems` and is ALSO listed in `unrecognisedLabels`, so a template drift shows up as a
// visible gap instead of quietly emptying `filesChanged`.
const BUCKETS = [
  { key: 'filesRead', re: /^(files?\s*read|read\s*files?|read)$/i },
  { key: 'filesChanged', re: /^(files?\s*(changed|modified|edited|written|touched)|(changed|modified|edited|written)\s*files?|changed|modified|edited)$/i },
  { key: 'decisions', re: /^(decisions?|decisions?\s*made|choices?|rationale)$/i },
  { key: 'codeReviewer', re: /^(code[-\s]?reviewer|code[-\s]?review)(\s*result)?$/i },
  { key: 'testWriter', re: /^(test[-\s]?writer|test[-\s]?writing|tests?)(\s*result)?$/i },
]
const bucketFor = label => BUCKETS.find(b => b.re.test(String(label).trim()))?.key || null

// Sub-agent verdicts we are willing to normalise. Anything else keeps `normalized: null` with a
// reason — inventing PASS from "looked fine" is exactly the substitution the house rules forbid.
const PASS_RE = /\b(pass(ed|ing)?|ok|clean|approve[ds]?|no\s+(issues|findings|blockers))\b/i
const FAIL_RE = /\b(fail(ed|ing|ure)?|reject(ed)?|blocked?|request[_\s-]?changes|critical|required)\b/i

const stripBullet = line => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
const isBullet = line => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line)

// `**Label:** value` / `Label: value` / `` `Label`: value ``. Returns null when there is no label —
// a bare bullet is content, not a labelled fact, and must not be forced into a bucket.
function splitLabel(text) {
  const m = /^\s*(?:\*\*|__|`)?\s*([A-Za-z][A-Za-z0-9 _/-]{0,40}?)\s*(?:\*\*|__|`)?\s*:\s*(.*)$/.exec(text)
  if (!m) return null
  return { label: m[1], value: m[2] }
}

// Pull file-ish tokens out of a line. Deliberately conservative: we would rather return the whole
// line as `raw` and `path: null` than guess a path out of prose, because a guessed path silently
// joins or misses the `both` set in reconcile() and corrupts the only number this feature produces.
const PATH_RE = /(?:^|[\s(`'"])((?:\.{0,2}\/)?(?:[\w.@+-]+\/)*[\w.@+-]+\.[A-Za-z0-9]{1,12})(?=[\s)`'",;:]|$)/g
function extractPath(text) {
  // Prefer a backticked/quoted token — agents quote paths and prose rarely does.
  const quoted = /[`'"]([^`'"\n]{1,300})[`'"]/.exec(text)
  if (quoted && /[/.]/.test(quoted[1]) && !/\s/.test(quoted[1])) return quoted[1]
  PATH_RE.lastIndex = 0
  const m = PATH_RE.exec(' ' + text)
  return m ? m[1] : null
}

function pushCapped(arr, item, caps, bucket) {
  if (arr.length >= MAX_ITEMS_PER_BUCKET) { caps[bucket] = (caps[bucket] || 0) + 1; return }
  arr.push(item)
}

/**
 * Parse every `## Work Log` section in an agent's markdown output.
 *
 * @param {string} src markdown (an assistant message, a PR body, a report file)
 * @returns {{ok:false, reason:string}
 *          |{ok:true, evidence:'self-reported', ...}}
 */
export function parseWorkLog(src) {
  if (typeof src !== 'string') return { ok: false, reason: `work-log source is ${src === null ? 'null' : typeof src}, not a string` }
  const caps = {}
  let text = src
  if (text.length > MAX_SOURCE_CHARS) {
    caps.sourceChars = text.length - MAX_SOURCE_CHARS
    text = text.slice(0, MAX_SOURCE_CHARS)
  }
  const lines = text.split('\n')

  // Locate every Work Log section: from its heading to the next heading at the same or shallower
  // depth. All of them — taking the first and dropping the rest would be a silent cap, and a
  // resumed agent legitimately writes two.
  const sections = []
  for (let i = 0; i < lines.length; i++) {
    const h = HEADING_RE.exec(lines[i])
    if (!h || !IS_WORK_LOG(h[2])) continue
    const depth = h[1].length
    let end = lines.length
    for (let j = i + 1; j < lines.length; j++) {
      const h2 = HEADING_RE.exec(lines[j])
      if (h2 && h2[1].length <= depth) { end = j; break }
    }
    sections.push({ headingLine: i + 1, depth, body: lines.slice(i + 1, end), bodyStart: i + 2 })
  }

  if (!sections.length) {
    const hadAnyHeading = lines.some(l => HEADING_RE.test(l))
    return {
      ok: false,
      reason: hadAnyHeading
        ? 'no `## Work Log` heading in this output — the agent produced markdown but never wrote a Work Log section'
        : 'no markdown headings at all in this output — nothing that could be a Work Log section',
    }
  }

  const items = []
  const filesRead = [], filesChanged = [], decisions = []
  const unrecognisedLabels = []
  let codeReviewer = null, testWriter = null
  let contentLines = 0

  for (const sec of sections) {
    let currentBucket = null // set by a sub-heading, e.g. `### Files Changed`
    for (let k = 0; k < sec.body.length; k++) {
      const rawLine = sec.body[k]
      const lineNo = sec.bodyStart + k
      if (!rawLine.trim()) continue
      const h = HEADING_RE.exec(rawLine)
      if (h) { currentBucket = bucketFor(h[2]); if (!currentBucket) unrecognisedLabels.push({ label: h[2].trim(), line: lineNo, kind: 'heading' }); continue }
      contentLines++

      const bulleted = isBullet(rawLine)
      const body = bulleted ? stripBullet(rawLine) : rawLine.trim()
      const labelled = splitLabel(body)
      let bucket = labelled ? bucketFor(labelled.label) : null
      let value = labelled && bucket ? labelled.value : body
      if (!bucket && currentBucket) { bucket = currentBucket; value = body }
      if (labelled && !bucketFor(labelled.label) && !currentBucket) unrecognisedLabels.push({ label: labelled.label, line: lineNo, kind: 'bullet' })

      const item = { line: lineNo, raw: rawLine.trim(), bucket, selfReported: true }
      pushCapped(items, item, caps, 'items')

      if (bucket === 'filesRead' || bucket === 'filesChanged') {
        // A single bullet can legitimately list several files: `- Changed: a.mjs, b.mjs`.
        const parts = value.split(/[,;]| and /).map(s => s.trim()).filter(Boolean)
        const found = []
        for (const p of parts) { const fp = extractPath(p); if (fp) found.push(fp) }
        const target = bucket === 'filesRead' ? filesRead : filesChanged
        if (found.length) for (const p of found) pushCapped(target, { path: p, line: lineNo, raw: value, selfReported: true, pathConfidence: 'extracted' }, caps, bucket)
        // A claim we could not resolve to a path is still a claim. Recording it with `path: null`
        // and a reason keeps it countable; dropping it would understate the self-report and make
        // reconcile()'s `claimedOnly` look cleaner than the data supports.
        else pushCapped(target, { path: null, line: lineNo, raw: value, selfReported: true, pathConfidence: null, reason: 'no file-like token in this line' }, caps, bucket)
      } else if (bucket === 'decisions') {
        pushCapped(decisions, { text: value, line: lineNo, selfReported: true }, caps, 'decisions')
      } else if (bucket === 'codeReviewer' && !codeReviewer) {
        codeReviewer = verdict(value, lineNo)
      } else if (bucket === 'testWriter' && !testWriter) {
        testWriter = verdict(value, lineNo)
      }
    }
  }

  if (!contentLines) {
    // A heading with nothing under it must not become `{filesChanged: []}` — that reads as "the
    // agent reported it changed no files", which is a different and much stronger statement.
    return { ok: false, reason: `\`Work Log\` heading found at line ${sections[0].headingLine} but the section is empty — no self-report to read` }
  }

  return {
    ok: true,
    evidence: 'self-reported',
    evidenceNote: 'Every field below is the AGENT\'S OWN ACCOUNT of what it did. It is a claim, not an observation. Nothing here was verified against the filesystem or against tool calls.',
    sectionCount: sections.length,
    sectionLines: sections.map(s => s.headingLine),
    selfReportedItems: items,
    selfReportedFilesRead: filesRead,
    selfReportedFilesChanged: filesChanged,
    selfReportedDecisions: decisions,
    selfReportedCodeReviewerResult: codeReviewer || { value: null, normalized: null, line: null, selfReported: true, reason: 'no code-reviewer line in the Work Log — the sub-agent may not have run, or ran and was not reported. Absence is not a pass.' },
    selfReportedTestWriterResult: testWriter || { value: null, normalized: null, line: null, selfReported: true, reason: 'no test-writer line in the Work Log — the sub-agent may not have run, or ran and was not reported. Absence is not a pass.' },
    unrecognisedLabels,
    caps: Object.keys(caps).length
      ? { dropped: caps, limits: { itemsPerBucket: MAX_ITEMS_PER_BUCKET, sourceChars: MAX_SOURCE_CHARS }, note: 'entries beyond the limit were NOT parsed; counts above are lower bounds' }
      : { dropped: {}, limits: { itemsPerBucket: MAX_ITEMS_PER_BUCKET, sourceChars: MAX_SOURCE_CHARS }, note: 'nothing truncated' },
  }
}

function verdict(value, line) {
  const raw = String(value).trim()
  if (!raw) return { value: null, normalized: null, line, selfReported: true, reason: 'label present but no value after the colon' }
  const pass = PASS_RE.test(raw), fail = FAIL_RE.test(raw)
  // Both or neither → we refuse to pick. "PASS with required follow-ups" is genuinely ambiguous and
  // resolving it either way invents a verdict the agent did not give.
  const normalized = pass && !fail ? 'PASS' : fail && !pass ? 'FAIL' : null
  return {
    value: raw,
    normalized,
    line,
    selfReported: true,
    ...(normalized ? {} : { reason: pass && fail ? 'text contains both pass-like and fail-like words — verdict is genuinely ambiguous, not normalised' : 'text matches no known pass/fail wording — left unnormalised rather than guessed' }),
  }
}

// ---------------------------------------------------------------------------
// reconcile — the whole point of the feature
// ---------------------------------------------------------------------------

const normPath = p => String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
const baseName = p => normPath(p).split('/').pop()

/**
 * Cross-check the self-reported files-changed list against the tool-call-observed one.
 *
 * Returns THREE sets, deliberately never merged into two:
 *
 *   both         — claimed AND observed. The boring, corroborated case.
 *   claimedOnly  — the agent said it changed this file, and we saw no Edit/Write/MultiEdit/
 *                  NotebookEdit tool call for it. TWO different worlds produce this and THIS DATA
 *                  CANNOT TELL THEM APART:
 *                    (a) a real edit made through Bash (`sed -i`, `>`, `git apply`, a generated
 *                        script) — invisible to tool-call parsing, so the observed list is wrong;
 *                    (b) a claimed edit that never happened — so the self-report is wrong.
 *                  Both are worth a human's attention and they are opposite defects. Collapsing
 *                  them into "changed files" would hide (b); dropping them would hide (a).
 *   observedOnly — we saw the edit, the agent did not mention it. Usually an incomplete Work Log;
 *                  occasionally an edit the agent does not realise it made (a failed-then-retried
 *                  Edit, a hook-driven write, a sub-agent's work reported nowhere).
 *
 * @param {Array} workLogFiles  entries from parseWorkLog().selfReportedFilesChanged, or bare strings
 * @param {Array} toolCallFiles paths from tool_use blocks, or bare strings
 * @param {{cwd?:string}} [opts] cwd to resolve `./`-relative claims against absolute observed paths
 */
export function reconcile(workLogFiles, toolCallFiles, opts = {}) {
  if (!Array.isArray(workLogFiles) || !Array.isArray(toolCallFiles))
    return { ok: false, reason: `reconcile needs two arrays, got ${typeof workLogFiles} and ${typeof toolCallFiles}` }

  const cwd = opts.cwd ? normPath(opts.cwd).replace(/\/$/, '') : null
  // Relative-vs-absolute is the one normalisation we do, and only when the caller supplied a cwd.
  // Without it we compare literally: silently suffix-matching `lib/x.mjs` to `/home/u/p/lib/x.mjs`
  // would fabricate agreement between two paths that may be different files in different repos.
  const canon = p => { const n = normPath(p); return cwd && !n.startsWith('/') ? `${cwd}/${n}` : n }

  const claimed = new Map()   // canonical -> {path, entries[]}
  const unresolved = []       // claims with no extractable path — countable, never silently dropped
  for (const f of workLogFiles) {
    const p = typeof f === 'string' ? f : f?.path
    if (!p) { unresolved.push(typeof f === 'string' ? { path: null, raw: f } : { path: null, raw: f?.raw ?? null, line: f?.line ?? null, reason: f?.reason || 'no path on this self-reported entry' }); continue }
    const k = canon(p)
    if (!claimed.has(k)) claimed.set(k, { path: k, claimedAs: p, selfReported: true, lines: [] })
    if (typeof f === 'object' && f.line != null) claimed.get(k).lines.push(f.line)
  }

  const observed = new Map()
  for (const f of toolCallFiles) {
    const p = typeof f === 'string' ? f : f?.path ?? f?.file_path
    if (!p) continue
    const k = canon(p)
    if (!observed.has(k)) observed.set(k, { path: k, observedAs: p, observed: true, toolCalls: 0 })
    observed.get(k).toolCalls++
  }

  const both = [], claimedOnly = [], observedOnly = []
  for (const [k, c] of claimed) {
    if (observed.has(k)) both.push({ path: k, selfReported: true, observedInToolCalls: true, claimLines: c.lines, toolCalls: observed.get(k).toolCalls })
    else claimedOnly.push({ path: k, selfReported: true, observedInToolCalls: false, claimLines: c.lines, interpretation: 'ambiguous', possibleCauses: ['edit made via Bash (sed -i, >, git apply) which tool-call parsing cannot see', 'the agent claimed an edit it did not make'] })
  }
  for (const [k, o] of observed) if (!claimed.has(k)) observedOnly.push({ path: k, selfReported: false, observedInToolCalls: true, toolCalls: o.toolCalls })

  // ADVISORY ONLY, never merged into `both`. Same basename, different path: often a genuine
  // relative/absolute mismatch the caller can fix by passing cwd — and sometimes two real, distinct
  // files. We surface the suspicion and refuse to act on it.
  const basenameCollisions = []
  for (const c of claimedOnly) {
    const b = baseName(c.path)
    const hits = observedOnly.filter(o => baseName(o.path) === b)
    if (hits.length) basenameCollisions.push({ claimed: c.path, observed: hits.map(h => h.path), note: 'same basename, different path — NOT counted as agreement. Pass {cwd} if these are the same file expressed differently.' })
  }

  const agreementDenom = both.length + claimedOnly.length + observedOnly.length
  return {
    ok: true,
    both, claimedOnly, observedOnly,
    unresolvedClaims: unresolved,
    basenameCollisions,
    counts: { both: both.length, claimedOnly: claimedOnly.length, observedOnly: observedOnly.length, unresolvedClaims: unresolved.length },
    // null, not 1, when there is nothing to compare — "100% agreement" on an empty set is a lie
    // that would show up as a green tick on a run nobody has evidence about.
    agreementRatio: agreementDenom ? +(both.length / agreementDenom).toFixed(3) : null,
    ...(agreementDenom ? {} : { agreementReason: 'neither list contains a resolvable file — no agreement can be computed' }),
    normalization: cwd ? { cwd, applied: 'relative claims resolved against cwd' } : { cwd: null, applied: 'none — paths compared literally; relative and absolute forms of the same file will NOT match' },
    note: 'claimedOnly is NOT part of "files changed" and observedOnly is NOT part of "files the agent reported". These are separate facts and the disagreement between them is the signal.',
  }
}

/** Convenience: parse + reconcile in one call. Propagates the parse failure rather than defaulting. */
export function crossCheckWorkLog(agentOutput, toolCallFiles, opts = {}) {
  const parsed = parseWorkLog(agentOutput)
  if (!parsed.ok) return { ok: false, reason: parsed.reason, stage: 'parse' }
  const rec = reconcile(parsed.selfReportedFilesChanged, toolCallFiles, opts)
  if (!rec.ok) return { ok: false, reason: rec.reason, stage: 'reconcile' }
  return { ok: true, workLog: parsed, reconciliation: rec }
}
