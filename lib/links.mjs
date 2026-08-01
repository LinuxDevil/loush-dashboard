/**
 * What a ticket points at, pulled out of its text.
 *
 * A JIRA description is mostly references: the design lives in Figma, the copy lives in a sheet,
 * the decision that produced the ticket lives in a Confluence page, and half the requirements live
 * in three other tickets. An agent handed only the description is reading the index of the work,
 * not the work — so intake follows them.
 *
 * Everything here is pure so the parsing can be checked without a network or an Atlassian account.
 */

const FIGMA_RE = /https:\/\/(?:www\.)?figma\.com\/(?:file|design|proto|board)\/[^\s)\]<>"']+/gi
const SHEET_RE = /https:\/\/docs\.google\.com\/spreadsheets\/d\/[^\s)\]<>"']+/gi
const CONFLUENCE_RE = /https:\/\/[a-z0-9-]+\.atlassian\.net\/wiki\/[^\s)\]<>"']+/gi
const JIRA_BROWSE_RE = /https:\/\/[a-z0-9-]+\.atlassian\.net\/browse\/([A-Z][A-Z0-9_]*-\d+)/gi
const JIRA_SELECTED_RE = /[?&]selectedIssue=([A-Z][A-Z0-9_]*-\d+)/gi
// A bare key in prose. Requires a boundary on both sides so `AIR-10817-1` (a branch) and version
// strings like `UTF-8` do not read as issue keys.
const JIRA_BARE_RE = /(?<![A-Za-z0-9-])([A-Z][A-Z0-9_]{1,9}-\d+)(?![\w-])/g

const uniq = a => [...new Set(a)]
const all = (text, re) => uniq(String(text || '').match(re) || [])

/** The trailing `?…` on a Figma link carries the node, so links are deduped whole, not by file. */
export const figmaLinks = text => all(text, FIGMA_RE)

/**
 * Sheet links, each with the CSV export URL that MIGHT work. It only works for a sheet shared by
 * link; a private one answers 200 with an HTML sign-in page, which is why the caller has to check
 * what came back rather than trust the status.
 */
export function sheetLinks(text) {
  return all(text, SHEET_RE).map(url => {
    const id = (/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(url) || [])[1] || null
    const gid = (/[#?&]gid=(\d+)/.exec(url) || [])[1] || null
    return {
      url, id,
      csv: id ? `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ''}` : null,
    }
  })
}

/** Confluence pages, keyed by the numeric page id the API wants. */
export function confluenceLinks(text) {
  return all(text, CONFLUENCE_RE)
    .map(url => ({ url, id: (/\/pages\/(\d+)/.exec(url) || [])[1] || null }))
    .filter(p => p.id)
    .filter((p, i, a) => a.findIndex(x => x.id === p.id) === i)
}

/**
 * Issue keys this ticket mentions, however it mentions them — a browse URL, a board URL's
 * `selectedIssue`, or just typed into a sentence. `self` is dropped: a ticket citing its own key is
 * the single most common match and following it would fetch the ticket we are already reading.
 */
export function jiraKeys(text, self, prefixes) {
  const s = String(text || '')
  const out = []
  for (const re of [JIRA_BROWSE_RE, JIRA_SELECTED_RE]) {
    for (const m of s.matchAll(re)) out.push(m[1])   // a URL is unambiguous — always followed
  }
  // A bare word of the shape LETTERS-DIGITS is not evidence of anything: `UTF-8`, `ISO-8601` and
  // `RFC-7231` all match it. So prose keys count only for projects the caller says exist. With no
  // list given there is nothing to check against and prose is ignored rather than guessed at.
  const known = (prefixes || []).map(p => String(p).toUpperCase())
  if (known.length) {
    for (const m of s.matchAll(JIRA_BARE_RE)) {
      if (known.includes(m[1].split('-')[0].toUpperCase())) out.push(m[1])
    }
  }
  return uniq(out.map(k => k.toUpperCase())).filter(k => k !== String(self || '').toUpperCase())
}

export function extractLinks(text, self, prefixes) {
  return { figma: figmaLinks(text), sheets: sheetLinks(text), confluence: confluenceLinks(text), jira: jiraKeys(text, self, prefixes) }
}

/** The key in a pasted JIRA link, a board URL, or a key typed on its own. */
export function keyFromInput(input) {
  const s = String(input || '').trim()
  for (const re of [/\/browse\/([A-Z][A-Z0-9_]*-\d+)/i, /[?&]selectedIssue=([A-Z][A-Z0-9_]*-\d+)/i, /^([A-Za-z][A-Za-z0-9_]*-\d+)$/]) {
    const m = re.exec(s)
    if (m) return m[1].toUpperCase()
  }
  return null
}
