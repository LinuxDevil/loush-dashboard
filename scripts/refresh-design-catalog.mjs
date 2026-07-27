// Refresh the design-system component catalog used by the Figma Capture annotation editor's
// component picker. Runnable as a CLI: npm run catalog:refresh
//
// The catalog is NOT checked in and there is no built-in design system — you name yours in
// projects.json and this reads it:
//
//   "designSystem": { "package": "@your-org/design-system" }    // node_modules, or any path
//   "designSystem": { "storybook": "https://your-org.github.io/ds/" }
//
// CLI args override the config for a one-off run:
//   npm run catalog:refresh -- --package @your-org/design-system
//   npm run catalog:refresh -- --storybook https://your-org.github.io/ds/
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { CATALOG_FILE, PROJECTS_FILE } from '../lib/paths.mjs'
import { loadEngConfig } from '../lib/eng-config.mjs'

// prop keys whose string values are usually the component's own variant names (appearance="primary" etc)
const VARIANT_PROP_KEYS = ['appearance', 'variant', 'type', 'size', 'status', 'tone', 'severity']
const MAX_VARIANTS = 40

// ---------------------------------------------------------------------------
// source 1: an npm package
// ---------------------------------------------------------------------------

/** Resolve a package name (or a path) to its directory + parsed package.json. Throws if absent. */
function resolvePackage(spec) {
  const asPath = path.resolve(spec)
  if (fs.existsSync(path.join(asPath, 'package.json'))) return { dir: asPath, pkg: readJson(path.join(asPath, 'package.json')) }
  // resolve from the dashboard's own cwd, so `npm i @your-org/ds` next to it is enough
  const require = createRequire(path.join(process.cwd(), 'noop.js'))
  let manifest
  try { manifest = require.resolve(`${spec}/package.json`) } catch { manifest = null }
  if (!manifest) {
    // packages without a package.json export map: walk up from the resolved entry point
    let entry
    try { entry = require.resolve(spec) } catch {
      throw new Error(`cannot resolve package "${spec}" — install it (npm i ${spec}) or give a path to it`)
    }
    let d = path.dirname(entry)
    while (d !== path.dirname(d) && !fs.existsSync(path.join(d, 'package.json'))) d = path.dirname(d)
    manifest = path.join(d, 'package.json')
  }
  return { dir: path.dirname(manifest), pkg: readJson(manifest) }
}

/** Every candidate .d.ts for a package: the declared types entry, plus a shallow scan of its dist. */
function typeFiles(dir, pkg) {
  const out = []
  const push = p => { if (p && fs.existsSync(p) && p.endsWith('.d.ts') && !out.includes(p)) out.push(p) }
  push(pkg.types && path.join(dir, pkg.types))
  push(pkg.typings && path.join(dir, pkg.typings))
  for (const v of Object.values(pkg.exports || {})) {
    if (typeof v === 'string') push(path.join(dir, v))
    else if (v && typeof v === 'object') for (const t of [v.types, v.import?.types, v.require?.types]) push(t && path.join(dir, t))
  }
  if (!out.length) {
    // ponytail: one level of dist/ only — deep-walking node_modules is how a refresh becomes a minute
    for (const sub of ['', 'dist', 'lib', 'types', 'build']) {
      const d = path.join(dir, sub)
      if (!fs.existsSync(d)) continue
      for (const f of fs.readdirSync(d)) push(path.join(d, f))
    }
  }
  return out
}

/**
 * Pull component names + variants out of a package's type declarations.
 * A "component" is a PascalCase named export — the convention every React design system follows,
 * and cheap enough to be worth not parsing TypeScript for.
 */
function fromPackage(spec) {
  const { dir, pkg } = resolvePackage(spec)
  const files = typeFiles(dir, pkg)
  if (!files.length) throw new Error(`"${spec}" ships no .d.ts files — nothing to extract (resolved to ${dir})`)

  const dts = files.map(f => fs.readFileSync(f, 'utf8')).join('\n')
  const names = new Set()
  for (const re of [
    /export\s+declare\s+(?:const|function|class)\s+([A-Z]\w*)/g,
    /export\s+(?:const|function|class)\s+([A-Z]\w*)/g,
    /export\s*\{([^}]*)\}/g,
  ]) {
    for (const m of dts.matchAll(re)) {
      // the `export { ... }` form yields a list, with `X as Y` re-exports naming Y
      for (const part of m[1].split(',')) {
        const name = (part.includes(' as ') ? part.split(' as ').pop() : part).trim()
        if (/^[A-Z]\w*$/.test(name) && !/Props$|Type$|Enum$|Ref$/.test(name)) names.add(name)
      }
    }
  }

  const components = [...names].sort().map(name => {
    // variants: string-literal unions on this component's own Props type, plus any well-known
    // variant prop key. Scoped to the Props block so a neighbour's union is not attributed here.
    // ponytail: stops at the first closing brace at any indent, so a Props type with a NESTED object
    // is truncated there. Variants live on flat props in practice; parse TS properly if that changes.
    const propsBlock = dts.match(new RegExp(`(?:interface|type)\\s+${name}Props\\b[^{]*\\{([\\s\\S]{0,4000}?)\\n\\s*\\}`))
    const scope = propsBlock ? propsBlock[1] : ''
    const variants = new Set()
    for (const key of VARIANT_PROP_KEYS) {
      const m = scope.match(new RegExp(`\\b${key}\\??\\s*:\\s*([^;\\n]+)`))
      if (m) for (const v of m[1].matchAll(/'([^']+)'|"([^"]+)"/g)) variants.add(v[1] || v[2])
    }
    return { name, category: 'Components', fullTitle: `Components/${name}`, variants: [...variants].slice(0, MAX_VARIANTS) }
  })
  return { source: `package:${spec}`, components }
}

// ---------------------------------------------------------------------------
// source 2: a static Storybook build
// ---------------------------------------------------------------------------
// GitHub-Pages Storybook builds serve no index.json/stories.json, so this pulls everything straight
// out of the built iframe bundle instead.
// ponytail: regex over the bundle, no headless browser — this works only while the build leaves
// identifiers unminified. If yours minifies, use the `package` source above instead.

function moduleExportNames(js, modulePath, windowSize = 80000) {
  const defIdx = js.indexOf('"' + modulePath + '":')
  if (defIdx === -1) return null
  const slice = js.slice(defIdx, defIdx + windowSize)
  return [...slice.matchAll(/__webpack_require__\.d\(__webpack_exports__,"([^"]+)"/g)].map(m => m[1])
}

function namesFromObjectEntriesImport(js, block) {
  const varMatch = block.match(/Object\.entries\((\w+__WEBPACK_IMPORTED_MODULE_\d+__)\)/)
  if (!varMatch) return null
  const reqMatch = js.match(new RegExp(varMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*__webpack_require__\\("([^"]+)"\\)'))
  return reqMatch ? moduleExportNames(js, reqMatch[1]) : null
}

async function fromStorybook(site) {
  const base = site.endsWith('/') ? site : site + '/'
  const iframeHtml = await (await fetch(base + 'iframe.html')).text()
  const mainBundle = [...iframeHtml.matchAll(/<script[^>]*src="(main\.[^"]+\.iframe\.bundle\.js)"/g)].map(m => m[1])[0]
  if (!mainBundle) throw new Error('could not find the main iframe bundle in ' + base + 'iframe.html')
  const js = await (await fetch(base + mainBundle)).text()

  // one match per CSF file's `title:"Category/Name"` meta field, in bundle order — used to slice each
  // component's own block so story/prop values are not picked up from a neighboring component.
  const titleMatches = [...js.matchAll(/title:"([^"]{2,80})"/g)]
    .map(m => ({ index: m.index, title: m[1] }))
    .filter(m => m.title.includes('/'))

  const components = titleMatches.map((m, i) => {
    const block = js.slice(m.index, i + 1 < titleMatches.length ? titleMatches[i + 1].index : js.length)
    const storyNames = [...new Set([...block.matchAll(/var (\w+)=function \1\(/g)].map(v => v[1]))]
    const propKeyRe = new RegExp(`\\b(?:${VARIANT_PROP_KEYS.join('|')})\\s*:\\s*"([a-zA-Z][a-zA-Z0-9]{0,24})"`, 'g')
    const propValues = [...new Set([...block.matchAll(propKeyRe)].map(v => v[1]))]
    // an object-map gallery (icons/logos) is a far more useful "variant" list than its 1-2 story names
    const galleryNames = namesFromObjectEntriesImport(js, block)
    const [category, ...rest] = m.title.split('/')
    return {
      name: rest.join('/'), category, fullTitle: m.title,
      variants: galleryNames?.length ? galleryNames : [...storyNames, ...propValues].slice(0, MAX_VARIANTS),
    }
  })

  // a handful of design-system source files legitimately share one title (e.g. two Theme/Tokens
  // story files) — merge them into a single catalog entry rather than showing duplicates.
  const merged = new Map()
  for (const c of components) {
    const existing = merged.get(c.fullTitle)
    if (existing) existing.variants = [...new Set([...existing.variants, ...c.variants])]
    else merged.set(c.fullTitle, c)
  }
  return { source: base, components: [...merged.values()] }
}

// ---------------------------------------------------------------------------

function readJson(f, fallback) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { if (fallback !== undefined) return fallback; throw e }
}

/** CLI flags win over projects.json, so a one-off run never has to edit config. */
function resolveSource(argv) {
  const flag = name => { const i = argv.indexOf(`--${name}`); return i !== -1 ? argv[i + 1] : null }
  const pkg = flag('package'), sb = flag('storybook')
  if (pkg || sb) return { package: pkg, storybook: sb }
  const ds = loadEngConfig(PROJECTS_FILE).designSystem
  if (!ds) throw new Error(
    'no design system configured. Set it in Setup → Company tools, or add to projects.json:\n' +
    '  "designSystem": { "package": "@your-org/design-system" }\n' +
    'or run: npm run catalog:refresh -- --package @your-org/design-system')
  return ds
}

async function main() {
  const src = resolveSource(process.argv.slice(2))
  const { source, components } = src.package ? fromPackage(src.package) : await fromStorybook(src.storybook)
  const out = components.sort((a, b) => a.fullTitle.localeCompare(b.fullTitle))
  fs.writeFileSync(CATALOG_FILE, JSON.stringify({ source, scrapedAt: new Date().toISOString(), components: out }, null, 2))
  console.log(`wrote ${out.length} components from ${source} -> ${CATALOG_FILE}`)
  for (const c of out) console.log(`  ${c.fullTitle}: ${c.variants.length} variant(s)`)
}

export { fromPackage, fromStorybook, resolvePackage, typeFiles, resolveSource }

if (process.argv[1] && process.argv[1].endsWith('refresh-design-catalog.mjs')) {
  main().catch(e => { console.error(e.message); process.exit(1) })
}
