// Refresh the design-system component catalog used by the Figma Capture annotation editor's
// component picker. Source: https://tajawal.github.io/ct-web-design-system (a static Storybook
// build — no index.json/stories.json route on GitHub Pages, so we pull everything straight out of
// the built iframe bundle instead). Runnable as a CLI: npm run catalog:refresh
// ponytail: regex over the bundle, no headless browser — all of this is unminified string literals
// and unminified function/enum-member names (this Storybook build doesn't minify identifiers).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = 'https://tajawal.github.io/ct-web-design-system/'
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'design-system-catalog.json')
const CATEGORY_PREFIXES = ['Components/', 'Forms/', 'Images/', 'Theme/']
// prop keys whose string values are usually the component's own variant names (appearance="primary" etc)
const VARIANT_PROP_KEYS = ['appearance', 'variant', 'type', 'size', 'status', 'tone', 'severity']
const MAX_VARIANTS = 40

// resolves `__webpack_require__("<path>")`'s own module body, and returns every name it exports
// via `__webpack_require__.d(__webpack_exports__,"Name",...)` — this is how a barrel/index file
// (icons, logos, theme enums) lists its named exports once webpack has bundled it.
function moduleExportNames(js, modulePath, windowSize = 80000) {
  const defIdx = js.indexOf('"' + modulePath + '":')
  if (defIdx === -1) return null
  const slice = js.slice(defIdx, defIdx + windowSize)
  return [...slice.matchAll(/__webpack_require__\.d\(__webpack_exports__,"([^"]+)"/g)].map(m => m[1])
}

// an object-map render (`Object.entries(fooIcons__WEBPACK_IMPORTED_MODULE_N__).map(...)`) is how
// every icon/logo gallery story in this design system enumerates its set — find the imported
// module var in `block`, resolve its require path, and pull its export names.
function namesFromObjectEntriesImport(js, block) {
  const varMatch = block.match(/Object\.entries\((\w+__WEBPACK_IMPORTED_MODULE_\d+__)\)/)
  if (!varMatch) return null
  const reqMatch = js.match(new RegExp(varMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*__webpack_require__\\("([^"]+)"\\)'))
  return reqMatch ? moduleExportNames(js, reqMatch[1]) : null
}

// pulls every `ENUM_NAME.MEMBER="value"` string out of a TS enum-like const (COLOR_VARIANTS,
// TYPOGRAPHY_VARIANT, ...) once we know the enum object's own identifier and a window of source.
function enumValues(js, fromIndex, enumIdentifier, windowSize = 6000) {
  const block = js.slice(fromIndex, fromIndex + windowSize)
  return [...new Set([...block.matchAll(new RegExp(enumIdentifier + '\\.\\w+="([^"]+)"', 'g'))].map(m => m[1]))]
}

async function main() {
  const iframeHtml = await (await fetch(SITE + 'iframe.html')).text()
  const mainBundle = [...iframeHtml.matchAll(/<script[^>]*src="(main\.[^"]+\.iframe\.bundle\.js)"/g)].map(m => m[1])[0]
  if (!mainBundle) throw new Error('could not find the main iframe bundle in ' + SITE + 'iframe.html')
  const js = await (await fetch(SITE + mainBundle)).text()

  // one match per CSF file's `title:"Category/Name"` meta field, in bundle order — used to slice
  // each component's own block so story/prop values aren't picked up from a neighboring component.
  const titleMatches = [...js.matchAll(/title:"([^"]{2,80})"/g)]
    .map(m => ({ index: m.index, title: m[1] }))
    .filter(m => CATEGORY_PREFIXES.some(p => m.title.startsWith(p)))

  const components = titleMatches.map((m, i) => {
    const start = m.index
    const end = i + 1 < titleMatches.length ? titleMatches[i + 1].index : js.length
    const block = js.slice(start, end)

    const storyNames = [...new Set([...block.matchAll(/var (\w+)=function \1\(/g)].map(v => v[1]))]
    const propKeyRe = new RegExp(`\\b(?:${VARIANT_PROP_KEYS.join('|')})\\s*:\\s*"([a-zA-Z][a-zA-Z0-9]{0,24})"`, 'g')
    const propValues = [...new Set([...block.matchAll(propKeyRe)].map(v => v[1]))]
    // an object-map gallery (icons/logos) is a far more useful "variant" list than its 1-2 story names
    const galleryNames = namesFromObjectEntriesImport(js, block)

    const [category, ...rest] = m.title.split('/')
    const variants = galleryNames?.length ? galleryNames : [...storyNames, ...propValues].slice(0, MAX_VARIANTS)
    return { name: rest.join('/'), category, fullTitle: m.title, variants }
  })

  // a handful of design-system source files legitimately share one title (e.g. two Theme/Tokens
  // story files) — merge them into a single catalog entry rather than showing duplicates.
  const merged = new Map()
  for (const c of components) {
    const existing = merged.get(c.fullTitle)
    if (existing) existing.variants = [...new Set([...existing.variants, ...c.variants])]
    else merged.set(c.fullTitle, c)
  }

  // Theme/Colors, Theme/Typography List, Theme/Tokens render straight off the theme config at
  // runtime (no args), so their real "variants" live in the theme's own enum modules, not in the
  // story block itself — patch those in directly, uncapped (these lists are the whole point).
  const patchVariants = (fullTitle, names) => { const c = merged.get(fullTitle); if (c && names?.length) c.variants = names }
  const paletteIdx = js.indexOf('"./src/theme/palette.theme/index.ts":')
  if (paletteIdx !== -1) {
    patchVariants('Theme/Colors', enumValues(js, paletteIdx, 'COLOR_VARIANTS', 20000))
    const tokensMatch = js.slice(paletteIdx, paletteIdx + 20000).match(/TOKENS=\{(.*?)\},(?:paletteTheme|PARTNERS_COLOR_VARIANTS)=/s)
    if (tokensMatch) patchVariants('Theme/Tokens', [...tokensMatch[1].matchAll(/:"([^"]+)"/g)].map(m => m[1]))
  }
  const typographyIdx = js.indexOf('"./src/theme/typography.theme/index.ts":')
  if (typographyIdx !== -1) patchVariants('Theme/Typography List', enumValues(js, typographyIdx, 'TYPOGRAPHY_VARIANT'))

  const out = [...merged.values()].sort((a, b) => a.fullTitle.localeCompare(b.fullTitle))
  fs.writeFileSync(OUT, JSON.stringify({ source: SITE, scrapedAt: new Date().toISOString(), components: out }, null, 2))
  console.log(`wrote ${out.length} components -> ${OUT}`)
  for (const c of out) console.log(`  ${c.fullTitle}: ${c.variants.length} variant(s)`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
