// Regenerates the nine screenshots embedded in README.md.
//
//   node scripts/shots.mjs                    # against your own dev server
//   URL=http://localhost:5187 node scripts/shots.mjs
//
// Two things about this app make naive capture wrong, and both are handled here:
//
//   1. `page.screenshot({fullPage:true})` returns exactly one viewport. `main.content` is the
//      scroll container (`height:100vh; overflow-y:auto`), so documentElement.scrollHeight never
//      exceeds the window. To capture a tall panel you must GROW THE VIEWPORT and shoot normally.
//   2. Every visited section stays mounted and hidden with `display:none`, and Hub does the same
//      for sub-tabs — so a bare `.tabs button` matches buttons in three different sections at once.
//      Every selector below is scoped to `main.content > div.enter`, of which there is exactly one.
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const URL = process.env.URL || 'http://localhost:5177'
const OUT = process.env.OUT || 'docs/screenshots'
const PANEL = 'main.content > div.enter'
const MAX_H = 2600 // past this a README image is unreadable anyway

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SHOTS = [
  { file: 'overview.png', nav: 'Overview', want: /IN FLIGHT/i },
  // Pick the repo deliberately. The default is whichever root has the most edits, which is the home
  // directory — it hits the 5000-file walk cap, so nothing resolves, every row reads GONE and the
  // importers / t-s columns (two of the six the README documents) are empty in the shot.
  { file: 'working-set.png', nav: 'Working Set', want: /rework/i, rows: true, repo: /dashboard/ },
  {
    file: 'working-set-dossier.png',
    nav: 'Working Set',
    want: /rework/i,
    rows: true,
    repo: /dashboard/,
    // The file name in column 2 is the button that opens the dossier (WorkingSet.jsx). Prefer a row
    // whose file still exists — a GONE row's dossier is all "NOT IN REPO / 0 importers".
    open: true,
    clip: 'div[style*="z-index: 60"] > div',
  },
  { file: 'setup.png', nav: 'Setup', want: /Work week/i },
  { file: 'capabilities.png', nav: 'Capabilities', want: /ledger/i },
  { file: 'harness-sessions.png', nav: 'Harness', want: /Session/i },
  { file: 'forensics.png', nav: 'Harness', tab: 'Forensics', want: /Failure signatures/i },
  { file: 'inbox.png', nav: 'Inbox', want: /needs you/i, max: 1080 },
  { file: 'company-tools.png', nav: 'Company tools', want: /./ },
]

// Loading is over when no skeleton is on screen AND the panel says something we expect. The second
// half matters: for a frame after a nav click, div.enter is still the PREVIOUS section, which has
// no skeleton, so a skeleton-only wait passes instantly on the wrong panel.
async function ready(page, want) {
  await page
    .waitForFunction(
      ([sel, src]) => {
        const p = document.querySelector(sel)
        if (!p || p.querySelector('.skel-wrap')) return false
        return new RegExp(src, 'i').test(p.innerText)
      },
      [PANEL, want.source],
      { timeout: 25000, polling: 300 }
    )
    .catch(() => {})
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav.sidebar button')
  await sleep(2500)

  for (const s of SHOTS) {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.locator('nav.sidebar button', { hasText: s.nav }).first().click()
    await sleep(900)
    await ready(page, s.want)

    if (s.tab) {
      await page.locator(`${PANEL} .tabs[role="tablist"] button`, { hasText: s.tab }).first().click()
      await sleep(900)
      await ready(page, s.want)
    }
    if (s.repo) {
      const picked = await page.evaluate(
        ([sel, src]) => {
          const el = document.querySelector(`${sel} select`)
          const opt = [...el.options].find((o) => new RegExp(src).test(o.textContent))
          if (!opt) return null
          el.value = opt.value
          el.dispatchEvent(new Event('change', { bubbles: true }))
          return opt.textContent.trim()
        },
        [PANEL, s.repo.source]
      )
      console.log(`   repo: ${picked || 'no match — left on default'}`)
      await sleep(1500)
      await ready(page, s.want)
    }
    if (s.rows) await page.waitForSelector(`${PANEL} table tbody tr`, { timeout: 20000 }).catch(() => {})

    if (s.open) {
      const opened = await page.evaluate((sel) => {
        const rows = [...document.querySelectorAll(`${sel} table tbody tr`)]
        // skip rows the table has marked GONE — their dossier has nothing in it
        const row = rows.find((r) => !/gone/i.test(r.innerText)) || rows[0]
        const btn = row?.querySelector('td:nth-child(2) button')
        if (!btn) return null
        btn.click()
        return row.querySelector('td:nth-child(2)').innerText.trim()
      }, PANEL)
      console.log(`   dossier: ${opened || 'no row found'}`)
      await page.waitForSelector('div[style*="z-index: 60"]', { timeout: 15000 }).catch(() => {})
      await sleep(3000) // the modal renders its own skeleton while /api/fe/dossier lands
    }

    // Grow the viewport to the panel instead of asking for a full-page shot that cannot work.
    const h = await page.evaluate(() => {
      const c = document.querySelector('.content')
      return Math.ceil(c.scrollHeight + 56)
    })
    const target = Math.min(s.max || h, MAX_H)
    if (!s.clip && target > 1080) {
      await page.setViewportSize({ width: 1920, height: target })
      await sleep(1200)
    }

    const path = `${OUT}/${s.file}`
    if (s.clip) {
      const el = page.locator(s.clip).first()
      await el.screenshot({ path }).catch(async () => await page.screenshot({ path }))
    } else {
      await page.screenshot({ path })
    }
    console.log(`${s.file}  ${s.clip ? 'clipped' : `1920x${target}`}`)

    if (s.open) {
      await page.keyboard.press('Escape')
      await sleep(500)
    }
  }

  await ctx.close()
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
