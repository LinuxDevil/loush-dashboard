#!/usr/bin/env node
// Redact captured gh/Jira JSON for committable fixtures.
// Tokenizes every coworker name/login/email/title/comment; passes YOUR own identity through unchanged
// so the parser tests can still match "mine". Reads passthrough identity from career.json.identity
// (githubHandle + gitEmails) plus the CAREER_KEEP env (comma list). Keeps field paths + shapes intact.
//
// Usage:  gh api ... | node scripts/redact-fixture.mjs > test/fixtures/github/reviews.json
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const SENSITIVE = new Set(['name', 'login', 'email', 'title', 'body', 'displayName', 'summary', 'emailAddress'])

function loadKeep() {
  const keep = new Set((process.env.CAREER_KEEP || '').split(',').map(s => s.trim()).filter(Boolean))
  try {
    const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'career.json'), 'utf8'))
    const id = c.identity || {}
    ;(id.gitEmails || []).forEach(e => keep.add(String(e)))
    if (id.githubHandle) keep.add(id.githubHandle)
    if (id.jiraAccountId) keep.add(id.jiraAccountId)
  } catch { /* no career.json — env keep only */ }
  return keep
}

// Walk JSON, collect distinct sensitive values (excluding own identity), assign stable tokens per key kind.
function buildMap(node, keep, map, counters) {
  if (Array.isArray(node)) { for (const v of node) buildMap(v, keep, map, counters); return }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (SENSITIVE.has(k) && typeof v === 'string' && v && !keep.has(v) && !map.has(v)) {
        const kind = k === 'login' ? 'reviewer' : k === 'email' || k === 'emailAddress' ? 'email'
          : k === 'title' || k === 'summary' ? 'title' : k === 'body' ? 'comment' : 'user'
        counters[kind] = (counters[kind] || 0) + 1
        map.set(v, kind === 'email' ? `user${counters[kind]}@example.test` : `${kind}-${counters[kind]}`)
      }
      buildMap(v, keep, map, counters)
    }
  }
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// node scripts/redact-fixture.mjs --selftest  → asserts tokenize + own-identity passthrough
function selftest() {
  const j = { reviews: [{ user: { login: 'coworker' }, body: 'secret plan' }, { user: { login: 'LinuxDevil' } }] }
  const keep = new Set(['LinuxDevil']); const map = new Map(); const counters = {}
  buildMap(j, keep, map, counters)
  const reals = [...map.keys()].sort((a, b) => b.length - a.length)
  const scrub = s => { for (const r of reals) s = s.replace(new RegExp(esc(r), 'g'), map.get(r)); return s }
  const out = JSON.parse(JSON.stringify(j, (k, v) => typeof v === 'string' ? scrub(v) : v))
  if (out.reviews[0].user.login === 'coworker') throw new Error('coworker login not tokenized')
  if (out.reviews[1].user.login !== 'LinuxDevil') throw new Error('own handle must pass through')
  if (out.reviews[0].body.includes('secret')) throw new Error('body not tokenized')
  console.log('selftest ok')
}
if (process.argv.includes('--selftest')) { selftest(); process.exit(0) }

async function main() {
  const raw = await new Promise((res, rej) => { let b = ''; process.stdin.on('data', d => b += d); process.stdin.on('end', () => res(b)); process.stdin.on('error', rej) })
  const json = JSON.parse(raw)
  const keep = loadKeep()
  const map = new Map(); const counters = {}
  buildMap(json, keep, map, counters)
  // GitHub owner/repo names leak through URL fields (repository_url, html_url, *_url) which aren't
  // sensitive KEYS. Scan the serialized form for repo slugs and tokenize owner + repo everywhere.
  const serialized = JSON.stringify(json)
  for (const m of serialized.matchAll(/github\.com\/(?:repos\/)?([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)/g)) {
    for (const [val, kind] of [[m[1], 'org'], [m[2], 'repo']]) {
      if (val && !keep.has(val) && !map.has(val)) { counters[kind] = (counters[kind] || 0) + 1; map.set(val, `${kind}-${counters[kind]}`) }
    }
  }
  // Replace IN PLACE on live string values (not the serialized form) so multi-line bodies — whose
  // newlines/quotes get escaped by JSON.stringify — still match. Longest-first for substring safety.
  const reals = [...map.keys()].sort((a, b) => b.length - a.length)
  const scrub = s => { for (const real of reals) s = s.replace(new RegExp(esc(real), 'g'), map.get(real)); return s }
  const mutate = n => {
    if (Array.isArray(n)) return n.map(mutate)
    if (n && typeof n === 'object') { for (const k of Object.keys(n)) n[k] = mutate(n[k]); return n }
    return typeof n === 'string' ? scrub(n) : n
  }
  process.stdout.write(JSON.stringify(mutate(json), null, 2) + '\n')
  process.stderr.write(`[redact] tokenized ${map.size} value(s); kept ${keep.size} own-identity value(s)\n`)
}
main().catch(e => { process.stderr.write('redact failed: ' + e.message + '\n'); process.exit(1) })
