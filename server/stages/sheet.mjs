// Stage 5 — the copy deck, out of Google Sheets.
//
// Service account + JSON key, Sheets API v4, scope `spreadsheets.readonly` (spec §1). Installed-app
// OAuth is structurally unusable here: a sensitive scope on a Testing consent screen issues refresh
// tokens that expire every 7 days. The price of the service account is a one-time share of the sheet
// (or its Drive folder) with the service-account address — so "not shared yet" is an ordinary,
// expected outcome, and telling the human WHICH address to share with is most of what this stage does.
//
// No `googleapis` dependency: a signed JWT is ~10 lines with node's `crypto`, and the two REST calls
// are plain `fetch`.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

import { entry } from '../../lib/dossier.mjs'
import { SECRETS_FILE } from '../../lib/paths.mjs'

const STAGE = 'sheet'
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
// Exported for the Setup page's "test this credential" button, which mints the same assertion against
// the same endpoints. One definition, so a working test cannot diverge from a working stage.
export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const API = 'https://sheets.googleapis.com/v4/spreadsheets'

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')

/**
 * The service-account key, from the same `.eng.local.json` that `creds()` reads.
 *
 * The value may be the key object itself or a path to the JSON file Google hands you at download —
 * pasting a PEM private key, newlines and all, into another JSON file by hand is how this gets typed
 * wrong.
 */
export function sheetCreds(file = SECRETS_FILE) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')).sheetsServiceAccount
    const sa = typeof raw === 'string' ? JSON.parse(fs.readFileSync(raw, 'utf8')) : raw
    return sa?.client_email && sa?.private_key ? { email: sa.client_email, privateKey: sa.private_key } : null
  } catch { return null }
}

export function assertion({ email, privateKey }) {
  const now = Math.floor(Date.now() / 1000)
  const signed = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })}`
  return `${signed}.${crypto.sign('RSA-SHA256', Buffer.from(signed), privateKey).toString('base64url')}`
}

/**
 * A response, only if it is really JSON.
 *
 * Google answers a request it will not serve with **200 and an HTML sign-in page**, so the status
 * code proves nothing (`ticket.mjs:243-248`). A sign-in page saved as `content.csv` is worse than no
 * file, because design QA would then check every string against it and report a pass.
 */
async function jsonOf(r) {
  const body = await r.text()
  try { return { ok: r.ok, status: r.status, data: JSON.parse(body) } } catch { return { ok: false, status: r.status, data: null } }
}

const csv = rows => rows.map(r => r.map(c => {
  const s = c == null ? '' : String(c)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}).join(',')).join('\n') + '\n'

/**
 * The sheets the `links` stage found, out of the artifact it wrote.
 *
 * The manifest is an index that POINTS at artifacts, not a store for them — `entry()` has no data
 * field on purpose — so the path comes from the entry rather than being hardcoded. `null` means "no
 * usable list", which is a skip, not a failure.
 */
function sheetsIn(repoDir, manifest) {
  const rel = manifest?.stages?.links?.artifacts?.[0]
  if (!rel) return null
  try {
    const sheets = JSON.parse(fs.readFileSync(path.join(repoDir, rel), 'utf8')).sheets
    return Array.isArray(sheets) ? sheets : []
  } catch { return null }
}

const fail = (status, reason, sourceUrl) => entry({ stage: STAGE, status, reason, sourceUrl })

export async function sheetStage(ctx) {
  const { repoDir, cacheDir, key, manifest, secretsFile } = ctx
  const doFetch = ctx.fetch || globalThis.fetch

  const links = manifest?.stages?.links
  if (!links || links.status !== 'ok') return fail('skipped', `the links stage is "${links?.status || 'not run'}", so there is nothing to look for: ${links?.reason || 'no reason given'}`)
  const sheets = sheetsIn(repoDir, manifest)
  if (!sheets) return fail('skipped', `the links stage recorded no readable artifact (${links.artifacts?.[0] || 'no path in its manifest entry'}), so the sheet list is unknown`)
  const sheet = sheets[0]   // cap is 1 sheet (spec §1)
  if (!sheet?.id) return fail('skipped', 'the ticket links no Google Sheet — most tickets have no copy deck')

  const sa = sheetCreds(secretsFile)
  if (!sa) return fail('unavailable', `no Google service-account key: add {"sheetsServiceAccount": {"client_email": "…", "private_key": "…"}} (or a path to the downloaded key file) to ${secretsFile || SECRETS_FILE}, then share the sheet with that service-account address (client_email). Viewer is enough`, sheet.url)

  let token
  try {
    const t = await jsonOf(await doFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assertion(sa) }).toString(),
    }))
    token = t.data?.access_token
    if (!token) return fail('failed', `Google refused the service-account key for ${sa.email} (${t.status}${t.data?.error_description ? `: ${t.data.error_description}` : ''}) — the key may be revoked, or the Sheets API not enabled on its project`, sheet.url)
  } catch (e) { return fail('failed', `could not reach ${TOKEN_URL}: ${e.message}`, sheet.url) }

  const get = url => doFetch(url, { headers: { authorization: `Bearer ${token}` } }).then(jsonOf)
  const denied = (r, what) => {
    if (r.status === 403) return `the sheet is not shared with the service account ${sa.email} — share ${sheet.url} (or the Drive folder holding it) with that address, Viewer is enough${r.data?.error?.message ? ` [Google: ${r.data.error.message}]` : ''}`
    if (r.status === 404) return `no such spreadsheet — Google does not have ${sheet.id}, so the link in the ticket is wrong or the sheet was deleted`
    if (!r.data) return `Google answered ${what} with a non-JSON body (status ${r.status}) — it serves an HTML sign-in page with 200 for a sheet it will not show, so nothing was written`
    return `Google refused ${what} with ${r.status}${r.data?.error?.message ? `: ${r.data.error.message}` : ''}`
  }

  let meta, values
  try {
    meta = await get(`${API}/${encodeURIComponent(sheet.id)}?fields=sheets.properties.sheetId,sheets.properties.title`)
    if (!meta.ok || !meta.data) return fail(meta.status === 403 || meta.status === 404 ? 'unavailable' : 'failed', denied(meta, 'the sheet metadata'), sheet.url)

    // The gid names a TAB and lives in the URL fragment, not in `links.json` (spec §2), so it is
    // derived here. Falling back to the first tab is right for a one-tab deck and is the only option
    // for a link with no gid.
    const gid = (/[#?&]gid=(\d+)/.exec(sheet.url || '') || [])[1]
    const tabs = (meta.data.sheets || []).map(s => s.properties || {})
    const tab = (gid && tabs.find(t => String(t.sheetId) === gid)) || tabs[0]
    if (!tab?.title) return fail('failed', `the spreadsheet ${sheet.id} reports no tabs`, sheet.url)

    values = await get(`${API}/${encodeURIComponent(sheet.id)}/values/${encodeURIComponent(tab.title)}`)
    if (!values.ok || !values.data) return fail(values.status === 403 || values.status === 404 ? 'unavailable' : 'failed', denied(values, `tab "${tab.title}"`), sheet.url)
    values.tab = tab.title
  } catch (e) { return fail('failed', `could not reach the Sheets API: ${e.message}`, sheet.url) }

  const rows = values.data.values
  if (!Array.isArray(rows) || !rows.length) return fail('unavailable', `tab "${values.tab}" of ${sheet.url} is empty — an empty content.csv would read as a copy deck that says nothing`, sheet.url)

  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(path.join(cacheDir, 'sheet.json'), JSON.stringify({ url: sheet.url, id: sheet.id, tab: values.tab, values: rows }, null, 2))

  const rel = path.join('docs', String(key).toUpperCase(), 'content.csv')
  fs.mkdirSync(path.dirname(path.join(repoDir, rel)), { recursive: true })
  fs.writeFileSync(path.join(repoDir, rel), csv(rows))

  return entry({
    stage: STAGE, status: 'ok', sourceUrl: sheet.url, artifacts: [rel],
    provenance: { groundedIn: `sheets-api-v4 tab "${values.tab}"`, rows: rows.length, serviceAccount: sa.email },
  })
}

export const STAGES = { [STAGE]: sheetStage }
