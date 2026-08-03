/**
 * The Atlassian fetch stages of the ticket pipeline — spec §1 stages 1–4: `ticket`, `links`,
 * `jira-linked`, `confluence`. Deterministic, no tokens, one manifest entry each.
 *
 * A pipeline stage.
 *
 * @param {object} ctx
 * @param {string} ctx.repoDir   the workspace dir — the git-tracked half lives at `docs/<KEY>/` under it
 * @param {string} ctx.cacheDir  `dossierCache(ws, key)` — raw fetches only, gitignored
 * @param {string} ctx.key       normalized JIRA key (already through `normalizeKey`)
 * @param {object} ctx.cfg       board config as returned by `cfgFor()`
 * @param {object} ctx.manifest  the current manifest, READ-ONLY — for reading upstream artifacts
 * @returns {Promise<object>} a single manifest entry built by `entry()` from `lib/dossier.mjs`
 *
 * A stage WRITES its artifact files (both halves) and RETURNS its entry. It never calls
 * `writeManifest` — the runner owns manifest writes, so a stage cannot corrupt another's entry.
 * It never throws for an expected failure either: an unreachable source, a permission denial and a
 * missing upstream all come back as an entry with a non-`ok` status and a reason.
 *
 * `artifacts` mixes two path styles on purpose: the repo half is repo-relative because it travels
 * with a clone, the cache half is absolute because it is machine-local by definition.
 *
 * `fetchDetail` / `fetchPage` are a TEST SEAM, not part of the contract: they default to the real
 * `eng.mjs` calls and the runner never passes them. Stubbing them beats mocking the module, because
 * `eng.mjs` is PLANE A and four stage modules import it.
 */

import fs from 'node:fs'
import path from 'node:path'
import { entry } from '../../lib/dossier.mjs'
import { extractLinks } from '../../lib/links.mjs'
import { ticketDetail, confluencePage, reqHash } from '../eng.mjs'

// Depth 1, caps kept (spec "Links and depth"). Recursion is not worth its cost — a missing source
// surfaces in the grilling anyway — but a link over the cap is RECORDED, never silently dropped.
const CAPS = { jira: 5, confluence: 3, sheets: 1 }

const KEY = key => String(key || '').toUpperCase()
const docsDir = (repoDir, key) => path.join(repoDir, 'docs', KEY(key))

function writeDoc(repoDir, key, name, body) {
  fs.mkdirSync(docsDir(repoDir, key), { recursive: true })
  fs.writeFileSync(path.join(docsDir(repoDir, key), name), body)
  return `docs/${KEY(key)}/${name}`
}
function writeRaw(cacheDir, rel, data) {
  const target = path.join(cacheDir, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(data, null, 2))
  return target
}
/** Both halves read the same way: a missing file and an unparseable one are the same answer. */
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }

/**
 * The link inventory, located through the manifest rather than by rebuilding the path. The manifest
 * is the index; a consumer that hardcodes `docs/<KEY>/links.json` stops working the day the `links`
 * stage renames its artifact and says nothing.
 */
const readLinks = ({ repoDir, manifest }) => {
  const rel = manifest?.stages?.links?.artifacts?.[0]
  return rel ? readJson(path.join(repoDir, rel)) : null
}

const provenance = (passed, discovered, extra) => ({
  groundedIn: 'atlassian',
  handoff: { passed, excluded: [] },
  ...(discovered ? { discovered } : {}),
  ...extra,
})

/** Everything in a ticket that can hold a link: an agent handed the description alone misses half. */
const ticketText = d => [d?.summary, d?.description, ...(d?.comments || []).map(c => c.body)].filter(Boolean).join('\n\n')

/**
 * Project prefixes a bare `ABC-12` in prose is allowed to mean. `jiraKeys` ignores prose keys
 * without this list, because `UTF-8` and `RFC-7231` match the same shape.
 */
const prefixes = (cfg, key) => [...new Set([cfg?.jiraProjectKey, cfg?.key, KEY(key).split('-')[0]].filter(Boolean))]

// ---------------------------------------------------------------------------------------------
// 1. ticket — absorbs the migrated `ticket` + `rawText` state fields
// ---------------------------------------------------------------------------------------------

export async function stageTicket({ repoDir, cacheDir, key, cfg, manifest, fetchDetail = ticketDetail }) {
  const tracked = manifest?.tracked !== false
  const sourceUrl = cfg?.jiraHost ? `https://${cfg.jiraHost}/browse/${KEY(key)}` : null
  let d
  try { d = await fetchDetail(cfg, KEY(key)) }
  catch (e) { return entry({ stage: 'ticket', status: 'failed', reason: `JIRA would not answer for ${KEY(key)}: ${String(e?.message || e).slice(0, 200)}`, sourceUrl, tracked }) }

  const raw = writeRaw(cacheDir, 'ticket.json', d)
  const md = [
    `# ${d.key || KEY(key)} — ${d.summary || '(no summary)'}`,
    `Type: ${d.type || '—'} · Status: ${d.status || '—'}`,
    `\n## Description\n${d.description || '(none)'}`,
    `\n## Comments\n${(d.comments || []).map(c => `- **${c.author}** (${c.at}): ${c.body}`).join('\n') || '(none)'}`,
  ].join('\n')

  return entry({
    stage: 'ticket', status: 'ok', sourceUrl, tracked,
    artifacts: [writeDoc(repoDir, key, 'ticket.md', md), raw],
    // reqHash is what staleness is measured against downstream, and prContext is the existing
    // "generated from less than full context" signal — both belong on the entry, not in a second store.
    provenance: provenance([], null, { reqHash: reqHash(d), prContext: d.prContext || null }),
  })
}

// ---------------------------------------------------------------------------------------------
// 2. links — depth 1, caps 5/3/1, over-cap recorded
// ---------------------------------------------------------------------------------------------

export async function stageLinks({ repoDir, cacheDir, key, cfg, manifest }) {
  const tracked = manifest?.tracked !== false
  const d = readJson(path.join(cacheDir, 'ticket.json'))
  if (!d) return entry({ stage: 'links', status: 'skipped', reason: 'the `ticket` stage has no readable payload in the cache — there is no text to extract links from', tracked })

  const found = extractLinks(ticketText(d), key, prefixes(cfg, key))
  const out = { figma: found.figma, discovered: [] }   // figma is uncapped here; stage 6 owns its own budget
  for (const [kind, cap] of Object.entries(CAPS)) {
    out[kind] = (found[kind] || []).slice(0, cap).map(kind === 'sheets' ? sheetRef : x => x)
    for (const l of (found[kind] || []).slice(cap)) {
      out.discovered.push({ kind, ref: refOf(l), why: `over the depth-1 cap of ${cap} ${kind} link${cap === 1 ? '' : 's'} — found in the ticket but not followed` })
    }
  }

  // links.json is FIRST in artifacts: four stages locate it through the manifest, not by path.
  const artifact = writeDoc(repoDir, key, 'links.json', JSON.stringify(out, null, 2))
  const discovered = out.discovered
  return entry({
    stage: 'links', status: 'ok', tracked, artifacts: [artifact],
    sourceUrl: cfg?.jiraHost ? `https://${cfg.jiraHost}/browse/${KEY(key)}` : null,
    reason: discovered.length ? `${discovered.length} link(s) over the depth-1 caps were recorded but not followed` : null,
    provenance: provenance(['ticket'], discovered),
  })
}

/** A link is a key, a `{url,id}` or a `{url,csv}` depending on kind — one readable ref out of all three. */
const refOf = l => (typeof l === 'string' ? l : l.id || l.url)

/**
 * `{url, id, gid}` for a sheet (spec §2, `links.json`).
 *
 * `gid` names a TAB, so it is correctness, not tidiness: without it the sheet stage reads tab 1, and
 * for a deck whose copy sits on tab 3 it silently reads the wrong strings with no way to tell. The
 * producer derives it once here rather than every consumer re-deriving it — and `null` when the link
 * carries none, so a consumer can tell "tab 1 is correct" from "nobody told me which tab".
 *
 * `csv` is deliberately not carried through: it is the best-effort public-export URL, company sheets
 * are not public, and it dies with its last consumer — so no new reader learns it exists.
 */
const sheetRef = s => ({ url: s.url, id: s.id, gid: (/[#?&]gid=(\d+)/.exec(s.url) || [])[1] || null })

// ---------------------------------------------------------------------------------------------
// 3. jira-linked — at most 5
// ---------------------------------------------------------------------------------------------

export async function stageJiraLinked({ repoDir, cacheDir, key, cfg, manifest, fetchDetail = ticketDetail }) {
  const tracked = manifest?.tracked !== false
  const links = readLinks({ repoDir, manifest })
  if (!links) return entry({ stage: 'jira-linked', status: 'skipped', reason: 'the `links` stage has no readable links.json in the manifest — nothing says which issues to follow', tracked })

  const keys = (links.jira || []).slice(0, CAPS.jira)
  if (!keys.length) return entry({ stage: 'jira-linked', status: 'ok', reason: 'the ticket links no other issues', tracked, provenance: provenance(['links'], []) })

  const got = [], failed = [], discovered = [], raws = []
  for (const k of keys) {
    let d
    try { d = await fetchDetail(cfg, k) }
    catch (e) { failed.push(`${k} (${String(e?.message || e).slice(0, 80)})`); continue }
    got.push(d)
    raws.push(writeRaw(cacheDir, path.join('jira-linked', `${k}.json`), d))
    // Depth 2. Not followed — but a source we know about and chose not to read is worth more on the
    // page than the same source silently absent.
    const deeper = extractLinks(ticketText(d), k, prefixes(cfg, key))
    for (const kind of ['jira', 'confluence', 'sheets', 'figma']) {
      for (const l of deeper[kind] || []) discovered.push({ kind, ref: refOf(l), why: `found at depth 2, inside linked issue ${k} — the depth-1 policy does not follow it` })
    }
  }

  if (!got.length) return entry({ stage: 'jira-linked', status: 'unavailable', reason: `none of the linked issues could be read: ${failed.join(', ')}`, tracked, provenance: provenance(['links'], discovered) })

  const md = [`# Issues linked from ${KEY(key)}`, ...got.map(d => [
    `\n## ${d.key} — ${d.summary || '(no summary)'}`,
    `Type: ${d.type || '—'} · Status: ${d.status || '—'}`,
    `\n${d.description || '(no description)'}`,
  ].join('\n'))].join('\n')

  return entry({
    stage: 'jira-linked', status: 'ok', tracked,
    reason: failed.length ? `could not read ${failed.join(', ')}` : null,
    artifacts: [writeDoc(repoDir, key, 'jira-linked.md', md), ...raws],
    provenance: provenance(['links'], discovered),
  })
}

// ---------------------------------------------------------------------------------------------
// 4. confluence — at most 3
// ---------------------------------------------------------------------------------------------

export async function stageConfluence({ repoDir, cacheDir, key, cfg, manifest, fetchPage = confluencePage }) {
  const tracked = manifest?.tracked !== false
  const links = readLinks({ repoDir, manifest })
  if (!links) return entry({ stage: 'confluence', status: 'skipped', reason: 'the `links` stage has no readable links.json in the manifest — nothing says which pages to read', tracked })

  const pages = (links.confluence || []).slice(0, CAPS.confluence)
  if (!pages.length) return entry({ stage: 'confluence', status: 'ok', reason: 'the ticket links no Confluence pages', tracked, provenance: provenance(['links'], []) })

  const got = [], unreadable = [], discovered = [], raws = []
  for (const p of pages) {
    // confluencePage answers null for anything it cannot read — no permission, no page, bad token.
    // Which of those it was is not knowable from here, so the reason names the page and lets a human
    // go and look rather than asserting a cause.
    const page = await fetchPage(cfg, p.id)
    if (!page) { unreadable.push(`page ${p.id} (${p.url})`); continue }
    got.push({ ...page, url: p.url })
    raws.push(writeRaw(cacheDir, path.join('confluence', `${p.id}.json`), page))
    const deeper = extractLinks(page.text, key, prefixes(cfg, key))
    for (const kind of ['jira', 'confluence', 'sheets', 'figma']) {
      for (const l of deeper[kind] || []) discovered.push({ kind, ref: refOf(l), why: `found at depth 2, inside Confluence page ${p.id} — the depth-1 policy does not follow it` })
    }
  }

  if (!got.length) return entry({ stage: 'confluence', status: 'unavailable', reason: `no linked Confluence page could be read: ${unreadable.join(', ')}`, tracked, provenance: provenance(['links'], discovered) })

  const md = [`# Confluence pages linked from ${KEY(key)}`, ...got.map(p => [
    `\n## ${p.title} (${p.id})`,
    p.url,
    `\n${p.text}${p.truncated ? '\n\n(truncated)' : ''}`,
  ].join('\n'))].join('\n')

  return entry({
    stage: 'confluence', status: 'ok', tracked,
    sourceUrl: got.length === 1 ? got[0].url : null,
    reason: unreadable.length ? `could not read ${unreadable.join(', ')}` : null,
    artifacts: [writeDoc(repoDir, key, 'confluence.md', md), ...raws],
    provenance: provenance(['links'], discovered),
  })
}

/** Keyed by the stage name in the spec's §1 table, so the runner looks one up rather than importing four. */
export const STAGES = {
  'ticket': stageTicket,
  'links': stageLinks,
  'jira-linked': stageJiraLinked,
  'confluence': stageConfluence,
}
