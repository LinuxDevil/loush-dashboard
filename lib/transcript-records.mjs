// transcript-records.mjs — the one place that knows how a `.jsonl` transcript line becomes a record.
//
// NOTE FOR REVIEWERS: the brief pointed at `lib/context-analysis.mjs` and `lib/event-grouping.mjs`
// for existing record handling. Neither file exists in this repo. The only equivalent is the inline
// loop in `server/index.mjs:668` (`collectUsage`), which cannot be imported — server/index.mjs binds
// a listener at import time — and is off-limits to edit. So rather than re-derive line handling in
// both lib/usage-buckets.mjs and lib/tool-efficiency.mjs, it lives here once and both import it.
//
// Field names and shapes below were read off real transcripts under ~/.claude/projects, not guessed.

import fs from 'node:fs'
import path from 'node:path'

/**
 * Parse JSONL text into records, keeping a count of lines that did not parse.
 *
 * A transcript being appended to while we read it routinely ends in a half-written line. Dropping
 * those silently is fine; not SAYING we dropped them is not, because a caller cannot otherwise tell
 * a quiet 3%-of-file loss from a clean read.
 */
export function parseJsonl(text) {
  if (typeof text !== 'string') return { ok: false, reason: `not-text:${typeof text}`, records: [], badLines: 0, totalLines: 0 }
  const records = []
  let badLines = 0, totalLines = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    totalLines++
    try { records.push(JSON.parse(line)) } catch { badLines++ }
  }
  return { ok: true, records, badLines, totalLines }
}

/** Every `.jsonl` under `dir`, recursively — nested `subagents/` dirs hold real usage and are easy to miss. */
export function findTranscripts(dir) {
  const out = []
  const walk = d => {
    let ents
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.jsonl')) out.push(p)
    }
  }
  walk(dir)
  return out
}

/** Read + parse one transcript. Missing/unreadable file is a reason, not a throw. */
export function readTranscript(file) {
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch (e) { return { ok: false, reason: 'unreadable', detail: e.code || e.message, file, records: [] } }
  return { ...parseJsonl(text), file }
}

const isNum = v => typeof v === 'number' && Number.isFinite(v)

/**
 * Records that carry a billable `message.usage`, flattened to one shape.
 *
 * `<synthetic>` is skipped to match collectUsage: it is a local placeholder that was never billed,
 * and counting it would invent usage that no invoice will ever show.
 */
export function usageRecords(records = []) {
  const out = []
  for (const j of records) {
    const u = j?.message?.usage
    const model = j?.message?.model
    if (!u || typeof u !== 'object' || !model || model === '<synthetic>') continue
    out.push({
      t: j.timestamp ? Date.parse(j.timestamp) : null,
      timestamp: j.timestamp ?? null,
      model,
      usage: u,
      speed: u.speed,
      inference_geo: u.inference_geo,
      service_tier: u.service_tier,
      sessionId: j.sessionId ?? null,
      isSidechain: j.isSidechain === true,
      uuid: j.uuid ?? null,
      requestId: j.requestId ?? null,
      in: isNum(u.input_tokens) ? u.input_tokens : 0,
      out: isNum(u.output_tokens) ? u.output_tokens : 0,
      cc: isNum(u.cache_creation_input_tokens) ? u.cache_creation_input_tokens : 0,
      cr: isNum(u.cache_read_input_tokens) ? u.cache_read_input_tokens : 0,
    })
  }
  return out
}

/** Content blocks of a record's message, always an array (string content has no blocks). */
export function contentBlocks(record) {
  const c = record?.message?.content
  return Array.isArray(c) ? c : []
}
