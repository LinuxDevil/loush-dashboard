// Records a click-through of the whole dashboard to a video file.
//
//   node scripts/showcase.mjs            # both servers must already be running (npm run dev)
//   SPEED=0.5 node scripts/showcase.mjs  # half the dwell time, for a quick re-check
//
// Nothing about the tour is hardcoded: the sidebar is read out of the DOM, the caption is read out
// of the breadcrumb, and the sub-tabs are read out of whichever tablist the section happens to
// render. Add a section to App.jsx and it appears in the next recording with no edit here.
import { chromium } from 'playwright'
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const URL = process.env.URL || 'http://localhost:5177'
const OUT = process.env.OUT || 'showcase'
const W = 1920, H = 1080

// ponytail: timing is calibration, not logic — a section that renders slower on your machine gets a
// longer DWELL, not a smarter wait. Real network + real d3 layout are what these numbers absorb.
const S = Number(process.env.SPEED || 1)
const SETTLE = 1400 * S   // after a click, before we start looking at the panel
const DWELL = 1600 * S    // how long a fully-scrolled panel stays on screen
const SCROLL_MS = 2200 * S // duration of one top-to-bottom pass
const CARD = 2600 * S     // title / outro card

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Delivery recomputes a ~65s snapshot on a cold cache and the Eng panels render a spinner while it
// lands. Filming that spinner is the one thing a showcase must not do, so wait it out — bounded, so
// a genuinely stuck panel costs 40s of recording instead of hanging the run.
async function settled(page, cap = 40000) {
  await page
    .waitForFunction(
      () => !document.querySelector('.skel') && !document.body.innerText.includes('Updating…'),
      null,
      { timeout: cap, polling: 400 }
    )
    .catch(() => {})
}

// One overlay, injected once and reused. Lives outside #root so a React re-render never eats it.
const OVERLAY = `
(() => {
  const d = document.createElement('div')
  d.id = '__showcase'
  d.innerHTML = \`
    <style>
      #__showcase { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
        font: 400 15px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      #__showcase .cap { position: absolute; left: 50%; bottom: 34px; transform: translateX(-50%) translateY(14px);
        display: flex; align-items: baseline; gap: 12px; max-width: 76vw;
        padding: 11px 22px; border-radius: 10px; opacity: 0;
        background: rgba(16,18,22,0.86); backdrop-filter: blur(14px);
        border: 1px solid rgba(255,255,255,0.10); box-shadow: 0 10px 40px rgba(0,0,0,0.45);
        transition: opacity .45s ease, transform .45s ease; }
      #__showcase .cap.on { opacity: 1; transform: translateX(-50%) translateY(0); }
      #__showcase .cap .k { font: 600 11px ui-monospace, SFMono-Regular, monospace; letter-spacing: .1em;
        text-transform: uppercase; color: #4ade80; white-space: nowrap; }
      #__showcase .cap .t { color: #f2f4f7; font-weight: 500; white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis; }
      #__showcase .card { position: absolute; inset: 0; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 18px; opacity: 0;
        background: #0b0d10; transition: opacity .6s ease; }
      #__showcase .card.on { opacity: 1; }
      #__showcase .card h1 { font: 600 60px -apple-system, BlinkMacSystemFont, sans-serif;
        letter-spacing: -0.03em; color: #f2f4f7; margin: 0; }
      #__showcase .card p { font: 400 19px ui-monospace, SFMono-Regular, monospace; color: #8b949e; margin: 0; }
      #__showcase .dot { position: absolute; width: 26px; height: 26px; margin: -13px 0 0 -13px;
        border-radius: 50%; border: 2px solid #4ade80; background: rgba(74,222,128,0.18);
        opacity: 0; transition: opacity .18s ease, transform .32s ease; }
      #__showcase .dot.on { opacity: 1; transform: scale(1.5); }
    </style>
    <div class="cap"><span class="k"></span><span class="t"></span></div>
    <div class="card"><h1></h1><p></p></div>
    <div class="dot"></div>\`
  document.body.appendChild(d)
  const q = (s) => d.querySelector(s)
  window.__cap = (kicker, title) => {
    const c = q('.cap')
    if (!title) return c.classList.remove('on')
    q('.cap .k').textContent = kicker || ''
    q('.cap .t').textContent = title
    c.classList.add('on')
  }
  window.__card = (h, p) => {
    const c = q('.card')
    if (h === null) return c.classList.remove('on')
    q('.card h1').textContent = h
    q('.card p').textContent = p || ''
    c.classList.add('on')
  }
  // A cursor the recording can actually see — Playwright clicks leave no trace on video otherwise.
  window.__ping = (x, y) => {
    const dot = q('.dot')
    dot.style.left = x + 'px'; dot.style.top = y + 'px'
    dot.classList.remove('on'); void dot.offsetWidth; dot.classList.add('on')
    setTimeout(() => dot.classList.remove('on'), 520)
  }
})()`

// Click, but show where. Falls back to a plain click if the element has no box.
async function click(page, locator) {
  const box = await locator.boundingBox().catch(() => null)
  if (box) {
    await page.evaluate(([x, y]) => window.__ping(x, y), [box.x + box.width / 2, box.y + box.height / 2])
    await sleep(240)
  }
  await locator.click({ timeout: 5000 }).catch(() => {})
}

// One smooth top-to-bottom pass over the scroll container, then back to the top. Returns immediately
// for panels that fit on screen, so short sections don't eat a pointless four seconds.
async function tour(page, ms) {
  const scrolled = await page.evaluate(async (dur) => {
    const el = document.querySelector('.content')
    const max = el.scrollHeight - el.clientHeight
    if (max < 80) return false
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
    const go = (from, to, d) =>
      new Promise((res) => {
        const t0 = performance.now()
        const step = (now) => {
          const p = Math.min(1, (now - t0) / d)
          el.scrollTop = from + (to - from) * ease(p)
          p < 1 ? requestAnimationFrame(step) : res()
        }
        requestAnimationFrame(step)
      })
    await go(0, max, dur)
    await new Promise((r) => setTimeout(r, 500))
    await go(max, 0, dur * 0.45)
    return true
  }, ms)
  return scrolled
}

// The visible tablist belonging to the active section, if it has one.
const TABS = '.tabs[role="tablist"]'

async function subTabs(page) {
  return page.evaluate((sel) => {
    const panel = [...document.querySelectorAll('main.content > div')].find(
      (d) => d.style.display !== 'none' && d.offsetParent !== null
    )
    const list = panel?.querySelector(sel)
    if (!list) return []
    return [...list.querySelectorAll('button')].map((b) => b.textContent.trim())
  }, TABS)
}

async function main() {
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: `${OUT}/raw`, size: { width: W, height: H } },
    reducedMotion: 'no-preference',
    // Dark is the product default; without this the headless browser reports a light OS preference
    // and index.html honours it, so the whole tour would film in the secondary palette.
    colorScheme: 'dark',
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.warn('  page error:', e.message.split('\n')[0]))

  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav.sidebar button', { timeout: 30000 })
  await settled(page)
  await sleep(2500) // first paint of Overview does real work

  await page.addScriptTag({ content: OVERLAY })
  await page.evaluate(([h, p]) => window.__card(h, p), ['Loush', 'a dashboard for agent-assisted engineering'])
  await sleep(CARD)
  await page.evaluate(() => window.__card(null))
  await sleep(700)

  const names = await page.$$eval('nav.sidebar button', (bs) => bs.map((b) => b.textContent.trim()))
  console.log(`${names.length} sections:`, names.join(' · '))

  for (const [i, name] of names.entries()) {
    const btn = page.locator('nav.sidebar button').nth(i)
    await click(page, btn)
    await sleep(SETTLE)
    await settled(page)

    const crumb = await page.evaluate(() => ({
      k: document.querySelector('.crumb .kicker')?.textContent || '',
      t: document.querySelector('.crumb b')?.textContent || '',
    }))
    console.log(`→ ${crumb.t || name}`)
    await page.evaluate(([k, t]) => window.__cap(k, t), [crumb.k, crumb.t || name])
    await sleep(600)

    const tabs = await subTabs(page)
    if (!tabs.length) {
      await tour(page, SCROLL_MS)
      await sleep(DWELL)
    } else {
      for (const [j, label] of tabs.entries()) {
        if (j > 0) {
          await click(page, page.locator(`${TABS} button`, { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first())
          await sleep(SETTLE)
          await settled(page)
        }
        console.log(`   · ${label}`)
        await page.evaluate(([k, t]) => window.__cap(k, t), [crumb.k, `${crumb.t} — ${label}`])
        await tour(page, SCROLL_MS * 0.8)
        await sleep(DWELL * 0.8)
      }
    }
    await page.evaluate(() => window.__cap(null))
    await sleep(300)
  }

  // Two chrome-level features that are not sections: the command palette and the theme switch.
  await page.evaluate(([k, t]) => window.__cap(k, t), ['Anywhere', 'Command palette — ⌘K searches sections, skills, sessions'])
  await page.keyboard.press('Meta+k')
  await sleep(900)
  for (const ch of 'session') {
    await page.keyboard.type(ch)
    await sleep(110)
  }
  await sleep(DWELL * 1.4)
  await page.keyboard.press('Escape')
  await sleep(500)

  // Back to Overview first. The comparison only says anything on a panel with enough on it to
  // repaint — done from wherever the tour happened to end, half of it is empty background.
  await click(page, page.locator('nav.sidebar button').first())
  await sleep(SETTLE)
  await settled(page)
  await page.evaluate(([k, t]) => window.__cap(k, t), ['Anywhere', 'Light and dark are the same tokens'])
  await sleep(DWELL)
  const themeBtn = page.locator('.topbar .icon-btn').last()
  await click(page, themeBtn)
  await sleep(DWELL * 3) // Overview fits on a 1080p screen, so tour() is a no-op here — this dwell IS the beat
  await tour(page, SCROLL_MS)
  await click(page, themeBtn)
  await sleep(DWELL * 3) // Overview fits on a 1080p screen, so tour() is a no-op here — this dwell IS the beat
  await page.evaluate(() => window.__cap(null))

  await sleep(500)
  await page.evaluate(([h, p]) => window.__card(h, p), ['Loush', `${names.length} sections · one shell · your own data`])
  await sleep(CARD)

  await ctx.close() // flushes the video
  await browser.close()

  const [raw] = (await readdir(`${OUT}/raw`)).filter((f) => f.endsWith('.webm'))
  await rename(`${OUT}/raw/${raw}`, `${OUT}/showcase.webm`)
  await rm(`${OUT}/raw`, { recursive: true, force: true })

  try {
    await run('ffmpeg', ['-y', '-i', `${OUT}/showcase.webm`, '-vf', 'fps=30,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-movflags', '+faststart', `${OUT}/showcase.mp4`])
    console.log(`\n${OUT}/showcase.mp4`)
  } catch {
    console.log(`\n${OUT}/showcase.webm (ffmpeg not found — no mp4)`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
