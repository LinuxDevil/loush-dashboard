import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { summarize } from '../lib/page-style.mjs'

const capturesDir = repo => path.join(repo, '.claude', 'figma-captures')
const captureDir = (repo, slug) => path.join(capturesDir(repo), slug)
const slugify = s => String(s || 'page').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page'
const shortHash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8)

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])
export const localCaptureAllowed = () => process.env.PAGE_CAPTURE_ALLOW_LOCAL === '1'
export function assertCapturableUrl(input, { allowLocal = localCaptureAllowed() } = {}) {
  let u
  try { u = new URL(String(input || '')) } catch { throw Object.assign(new Error('not a valid URL'), { status: 400 }) }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw Object.assign(new Error('only http(s) URLs can be captured'), { status: 400 })
  if (allowLocal) return u.toString()
  const host = u.hostname.toLowerCase()
  const hint = ' (set PAGE_CAPTURE_ALLOW_LOCAL=1 to capture your own dev server)'
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.localhost')) throw Object.assign(new Error('refusing to capture a loopback address' + hint), { status: 400 })
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host))
    throw Object.assign(new Error('refusing to capture a private-network address' + hint), { status: 400 })
  return u.toString()
}

/* c8 ignore start — executes in the browser context, not under node */
function collectInPage(maxElements) {
  const counts = { color: {}, backgroundColor: {}, borderColor: {}, fontFamily: {}, fontSize: {}, fontWeight: {}, lineHeight: {}, spacing: {}, borderRadius: {}, boxShadow: {} }
  const bump = (bucket, value) => {
    if (!value || value === 'none' || value === 'normal' || value === 'auto') return
    counts[bucket][value] = (counts[bucket][value] || 0) + 1
  }
  const els = [...document.querySelectorAll('*')].slice(0, maxElements)
  let sampled = 0
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    const s = getComputedStyle(el)
    sampled++
    bump('color', s.color)
    if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') bump('backgroundColor', s.backgroundColor)
    if (parseFloat(s.borderTopWidth) > 0) bump('borderColor', s.borderTopColor)
    bump('fontFamily', s.fontFamily)
    bump('fontSize', s.fontSize)
    bump('fontWeight', s.fontWeight)
    bump('lineHeight', s.lineHeight)
    bump('borderRadius', s.borderTopLeftRadius)
    bump('boxShadow', s.boxShadow)
    for (const p of ['marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'rowGap', 'columnGap'])
      bump('spacing', s[p])
  }

  const cssVariables = {}
  const rootStyle = getComputedStyle(document.documentElement)
  for (const name of Array.from(rootStyle)) {
    if (!name.startsWith('--')) continue
    const v = rootStyle.getPropertyValue(name).trim()
    if (v) cssVariables[name] = v
  }

  const mediaQueries = [], keyframes = [], sheets = []
  for (const sheet of Array.from(document.styleSheets)) {
    let rules
    try { rules = sheet.cssRules } catch { sheets.push({ href: sheet.href, readable: false }); continue }
    if (!rules) continue
    sheets.push({ href: sheet.href, readable: true, ruleCount: rules.length })
    const walk = list => {
      for (const rule of Array.from(list)) {
        if (rule.type === CSSRule.MEDIA_RULE) { mediaQueries.push(rule.conditionText || rule.media?.mediaText); if (rule.cssRules) walk(rule.cssRules) }
        else if (rule.type === CSSRule.KEYFRAMES_RULE) keyframes.push(rule.name)
        else if (rule.cssRules) walk(rule.cssRules)
      }
    }
    walk(rules)
  }

  const seen = new Set()
  const blocks = []
  const push = (el, kind) => {
    if (seen.has(el)) return
    const r = el.getBoundingClientRect()
    if (r.width < 80 || r.height < 40) return
    seen.add(el)
    blocks.push({
      id: kind + ':' + blocks.length,
      name: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
      x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height),
      kind,
    })
  }
  for (const el of document.querySelectorAll('header,nav,main,section,article,aside,footer,form,table')) push(el, 'landmark')
  for (const el of els) {
    if (blocks.length > 200) break
    const r = el.getBoundingClientRect()
    if (r.width >= innerWidth * 0.6 && r.height >= 120) push(el, 'block')
  }

  return {
    counts, cssVariables, mediaQueries: mediaQueries.filter(Boolean), keyframes, sheets, blocks,
    bodyBackground: (() => {
      for (const el of [document.body, document.documentElement]) {
        const bg = el && getComputedStyle(el).backgroundColor
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg
      }
      return null
    })(),
    elementsSampled: sampled,
    truncated: document.querySelectorAll('*').length > maxElements,
    title: document.title || location.hostname,
    viewport: { w: innerWidth, h: innerHeight },
    page: { w: Math.max(document.body.scrollWidth, innerWidth), h: Math.max(document.body.scrollHeight, innerHeight) },
  }
}
/* c8 ignore stop */

const MAX_ELEMENTS = 8000

/* c8 ignore start — browser context */
async function captureInteractionStates(page, limit = 25) {
  const targets = await page.$$('a, button, [role="button"], input, select, textarea')
  const out = []
  for (const el of targets.slice(0, limit)) {
    try {
      if (!(await el.isVisible())) continue
      const before = await el.evaluate(n => { const s = getComputedStyle(n); return { color: s.color, backgroundColor: s.backgroundColor, borderColor: s.borderTopColor, boxShadow: s.boxShadow, textDecoration: s.textDecorationLine, transform: s.transform } })
      await el.hover({ timeout: 1000 })
      const hover = await el.evaluate(n => { const s = getComputedStyle(n); return { color: s.color, backgroundColor: s.backgroundColor, borderColor: s.borderTopColor, boxShadow: s.boxShadow, textDecoration: s.textDecorationLine, transform: s.transform } })
      const changed = Object.keys(before).filter(k => before[k] !== hover[k])
      if (changed.length) {
        const label = await el.evaluate(n => (n.textContent || n.getAttribute('aria-label') || n.tagName).trim().slice(0, 40))
        out.push({ label, changed, base: before, hover })
      }
    } catch { }
  }
  return out
}
/* c8 ignore stop */

export async function capturePage({ url, viewport = { width: 1440, height: 900 }, colorScheme = 'light', interactions = true }) {
  const safeUrl = assertCapturableUrl(url)
  const { chromium } = await import('playwright')
  const executablePath = process.env.PAGE_CAPTURE_CHROMIUM || undefined
  const browser = await chromium.launch(executablePath ? { executablePath } : {})
  try {
    const context = await browser.newContext({ viewport, colorScheme })
    const page = await context.newPage()
    await page.goto(safeUrl, { waitUntil: 'networkidle', timeout: 45_000 })
    const raw = await page.evaluate(collectInPage, MAX_ELEMENTS)
    const interactionStates = interactions ? await captureInteractionStates(page) : []

    const otherScheme = colorScheme === 'dark' ? 'light' : 'dark'
    await page.emulateMedia({ colorScheme: otherScheme })
    const alt = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    await page.emulateMedia({ colorScheme })
    const base = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)

    const screenshot = await page.screenshot({ fullPage: true })
    const styleSummary = summarize(raw)
    return {
      screenshot,
      raw,
      capture: {
        source: 'page',
        url: safeUrl,
        frameName: raw.title,
        fetchedAt: new Date().toISOString(),
        screenshotFile: 'screenshot.png',
        viewport, colorScheme,
        nodeTree: raw.blocks,
        styleSummary,
        cssVariables: raw.cssVariables,
        keyframes: raw.keyframes,
        mediaQueries: [...new Set(raw.mediaQueries)],
        stylesheets: raw.sheets,
        interactionStates,
        themeResponse: { base, alt, respondsToColorScheme: base !== alt },
        elementsSampled: raw.elementsSampled,
        truncated: raw.truncated,
      },
    }
  } finally { await browser.close() }
}

export function contextMarkdown(capture) {
  const s = capture.styleSummary || {}
  const list = (rows, fmt) => (rows || []).slice(0, 12).map(fmt).join('\n') || '_none captured_'
  const or = v => (v == null || v === '' ? 'unknown' : v)
  const vp = capture.viewport?.width && capture.viewport?.height ? `${capture.viewport.width}×${capture.viewport.height}` : 'unknown'
  return [
    `# ${or(capture.frameName)}`,
    ``,
    `Source: ${or(capture.url)}`,
    `Captured: ${or(capture.fetchedAt)} · viewport ${vp} · scheme ${or(capture.colorScheme)}`,
    `Elements sampled: ${or(capture.elementsSampled)}${capture.truncated ? ' (truncated)' : ''}`,
    ``,
    `## Theme`,
    ``,
    `Dominant background reads as **${s.theme?.theme || 'unknown'}**${s.theme?.basis ? ` (${s.theme.basis})` : ''}.`,
    `Responds to prefers-color-scheme: **${capture.themeResponse?.respondsToColorScheme ? 'yes' : 'no'}**.`,
    ``,
    `## Colours by usage`,
    ``,
    `| role | value | uses | share |`,
    `|---|---|---|---|`,
    list(s.colors?.text, r => `| text | \`${r.value}\` | ${r.count} | ${Math.round(r.share * 100)}% |`),
    list(s.colors?.background, r => `| background | \`${r.value}\` | ${r.count} | ${Math.round(r.share * 100)}% |`),
    ``,
    `## Type`,
    ``,
    list(s.typography?.family, r => `- \`${r.value}\` — ${r.count} uses`),
    ``,
    `Sizes: ${(s.typography?.size || []).map(r => r.value).join(', ') || '—'}`,
    ``,
    `## Spacing scale`,
    ``,
    (s.spacing || []).map(r => `${r.value} (${r.count})`).join(' · ') || '_none captured_',
    ``,
    `## Breakpoints`,
    ``,
    (s.breakpoints || []).map(b => `- ${b.type}-width ${b.px}px`).join('\n') || '_none declared_',
    ``,
    `## Structured blocks`,
    ``,
    `| block | box |`,
    `|---|---|`,
    list(capture.nodeTree, b => `| ${b.name} | ${b.w}×${b.h} @ ${b.x},${b.y} |`),
    ``,
    `## Interaction states`,
    ``,
    list(capture.interactionStates, i => `- **${i.label}** changes ${i.changed.join(', ')} on hover`),
    ``,
  ].join('\n')
}

export default function mountPageCapture(app) {
  app.post('/api/page-capture/create', async (req, res) => {
    const repo = path.resolve(String(req.body?.repo || ''))
    const url = String(req.body?.url || '')
    if (!repo || !url) return res.status(400).json({ error: 'repo and url required' })
    if (!fs.existsSync(repo)) return res.status(404).json({ error: 'repo not found: ' + repo })
    try {
      const { capture, screenshot } = await capturePage({
        url,
        viewport: { width: Number(req.body?.width) || 1440, height: Number(req.body?.height) || 900 },
        colorScheme: req.body?.colorScheme === 'dark' ? 'dark' : 'light',
        interactions: req.body?.interactions !== false,
      })
      const slug = `${slugify(new URL(capture.url).hostname + '-' + capture.frameName)}-${shortHash(capture.url)}`
      const dir = captureDir(repo, slug)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'capture.json'), JSON.stringify(capture, null, 2))
      fs.writeFileSync(path.join(dir, 'screenshot.png'), screenshot)
      fs.writeFileSync(path.join(dir, 'context.md'), contextMarkdown(capture))
      if (!fs.existsSync(path.join(dir, 'annotations.json'))) fs.writeFileSync(path.join(dir, 'annotations.json'), '[]')
      res.json({ slug, url: capture.url, styleSummary: capture.styleSummary })
    } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
  })
}
