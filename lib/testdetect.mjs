
import fs from 'node:fs'
import path from 'node:path'

export const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 }

const readText = p => { try { return fs.readFileSync(p, 'utf8') } catch { return null } }
const readJSON = p => { const t = readText(p); if (t == null) return null; try { return JSON.parse(t) } catch { return undefined } }

const NPM_PLACEHOLDER = /no test specified/i

export const DETECTORS = [
  {
    id: 'cargo',
    label: 'Rust (Cargo)',
    markers: ['Cargo.toml'],
    lockfiles: ['Cargo.lock'],
    command: 'cargo test',
    priority: 10,
  },
  {
    id: 'go',
    label: 'Go modules',
    markers: ['go.mod'],
    lockfiles: ['go.sum'],
    command: 'go test ./...',
    priority: 15,
  },
  {
    id: 'npm',
    label: 'Node.js (npm)',
    markers: ['package.json'],
    lockfiles: ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'],
    command: 'npm test',
    priority: 20,
    refine({ markerPath, readJSON }) {
      const pkg = readJSON(markerPath)
      if (pkg === undefined) return { command: 'npm test', confidence: 'low', note: 'package.json is present but is not valid JSON; falling back to the generic `npm test`.' }
      const script = pkg && pkg.scripts && typeof pkg.scripts.test === 'string' ? pkg.scripts.test.trim() : ''
      if (!script) {
        return { confidence: 'low', note: 'package.json defines no scripts.test — `npm test` will fail with "Missing script: test". This project has no configured test command.' }
      }
      if (NPM_PLACEHOLDER.test(script)) {
        return { confidence: 'low', script, note: `scripts.test is npm's placeholder (${JSON.stringify(script)}), which only exits 1. No real test command is configured.` }
      }
      return { command: script, runner: 'npm test', script, confidence: 'high' }
    },
  },
  {
    id: 'python',
    label: 'Python',
    markers: ['tox.ini', 'pytest.ini', 'pyproject.toml', 'setup.cfg', 'setup.py'],
    command: 'pytest',
    priority: 25,
    refine({ marker, markerPath, readText }) {
      if (marker === 'tox.ini') return { command: 'tox', confidence: 'high', note: 'tox.ini drives its own environments; `tox` runs the matrix the project declares.' }
      if (marker === 'pytest.ini') return { command: 'pytest', confidence: 'high' }
      const body = readText(markerPath) || ''
      if (marker === 'pyproject.toml') {
        if (/^\s*\[tool\.pytest/m.test(body)) return { command: 'pytest', confidence: 'high', note: 'pyproject.toml carries a [tool.pytest.ini_options] section.' }
        if (/^\s*\[tool\.poetry/m.test(body)) return { command: 'poetry run pytest', confidence: 'medium', note: 'Poetry project — tests run inside the managed virtualenv.' }
        return { command: 'pytest', confidence: 'medium' }
      }
      if (marker === 'setup.cfg' && /^\s*\[tool:pytest\]/m.test(body)) return { command: 'pytest', confidence: 'high' }
      return { command: 'pytest', confidence: 'medium' }
    },
  },
  {
    id: 'maven',
    label: 'Java (Maven)',
    markers: ['pom.xml'],
    command: 'mvn test',
    priority: 30,
    refine({ files }) {
      if (files.has('mvnw')) return { command: './mvnw test', confidence: 'high', note: 'Maven wrapper present — using it pins the project\'s Maven version.' }
      return { command: 'mvn test', confidence: 'medium' }
    },
  },
  {
    id: 'gradle',
    label: 'Java/Kotlin (Gradle)',
    markers: ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'],
    command: 'gradle test',
    priority: 35,
    refine({ files }) {
      if (files.has('gradlew')) return { command: './gradlew test', confidence: 'high', note: 'Gradle wrapper present — using it pins the project\'s Gradle version.' }
      return { command: 'gradle test', confidence: 'medium' }
    },
  },
  {
    id: 'composer',
    label: 'PHP (Composer)',
    markers: ['composer.json'],
    lockfiles: ['composer.lock'],
    command: 'composer test',
    priority: 40,
    refine({ markerPath, files, readJSON }) {
      const pkg = readJSON(markerPath)
      if (pkg === undefined) return { confidence: 'low', note: 'composer.json is present but is not valid JSON.' }
      const scripts = (pkg && pkg.scripts) || {}
      if (scripts.test) return { command: 'composer test', confidence: 'high', script: Array.isArray(scripts.test) ? scripts.test.join(' && ') : String(scripts.test) }
      if (files.has('phpunit.xml') || files.has('phpunit.xml.dist')) return { command: 'vendor/bin/phpunit', confidence: 'medium', note: 'No composer scripts.test; using the PHPUnit config the project ships.' }
      return { confidence: 'low', note: 'composer.json defines no scripts.test and no phpunit.xml was found — `composer test` will report an undefined script.' }
    },
  },
  {
    id: 'dotnet',
    label: '.NET',
    markers: [],
    patterns: [/\.sln$/i, /\.slnx$/i, /\.csproj$/i, /\.fsproj$/i, /\.vbproj$/i],
    command: 'dotnet test',
    priority: 45,
    refine({ marker }) {
      const solution = /\.slnx?$/i.test(marker)
      return { command: 'dotnet test', confidence: solution ? 'high' : 'medium', note: solution ? undefined : 'Matched a single project file; `dotnet test` covers only test projects it can resolve from it.' }
    },
  },
  {
    id: 'bundler',
    label: 'Ruby (Bundler)',
    markers: ['Gemfile'],
    lockfiles: ['Gemfile.lock'],
    command: 'bundle exec rake test',
    priority: 50,
    refine({ files, dirs }) {
      if (files.has('.rspec') || dirs.has('spec')) return { command: 'bundle exec rspec', confidence: 'high', note: 'RSpec layout detected (.rspec or spec/).' }
      if (files.has('Rakefile')) return { command: 'bundle exec rake test', confidence: 'high', note: 'Rakefile present — the default `test` task is the Minitest convention.' }
      return { confidence: 'low', note: 'A Gemfile is present but there is no Rakefile, .rspec or spec/ — no test task could be confirmed.' }
    },
  },
  {
    id: 'flutter',
    label: 'Dart / Flutter',
    markers: ['pubspec.yaml'],
    lockfiles: ['pubspec.lock'],
    command: 'dart test',
    priority: 55,
    refine({ markerPath, lock, readText }) {
      const body = readText(markerPath) || ''
      const isFlutter = /^\s*flutter\s*:/m.test(body) || /sdk:\s*flutter/.test(body)
      return {
        command: isFlutter ? 'flutter test' : 'dart test',
        confidence: lock ? 'high' : 'medium',
        note: isFlutter ? 'pubspec.yaml depends on the Flutter SDK, so the Flutter test runner is required for widget tests.' : undefined,
      }
    },
  },
  {
    id: 'swift',
    label: 'Swift (SwiftPM)',
    markers: ['Package.swift'],
    lockfiles: ['Package.resolved'],
    command: 'swift test',
    priority: 60,
  },
  {
    id: 'ctest',
    label: 'C/C++ (CMake + CTest)',
    markers: ['CMakeLists.txt'],
    // --output-on-failure is included because CTest's default is to swallow the failing test's
    command: 'ctest --test-dir build --output-on-failure',
    priority: 80,
    refine({ markerPath, readText }) {
      const body = readText(markerPath) || ''
      if (!/\b(enable_testing\s*\(|include\s*\(\s*CTest\s*\)|add_test\s*\()/i.test(body)) return null
      return { confidence: 'medium', note: 'The build tree must be configured (e.g. `cmake -B build`) before CTest can run.' }
    },
  },
  {
    id: 'make',
    label: 'Make',
    markers: ['Makefile', 'makefile', 'GNUmakefile'],
    command: 'make test',
    priority: 90,
    refine({ markerPath, readText }) {
      const body = readText(markerPath) || ''
      const target = name => new RegExp(`^\\.?${name}\\s*:(?!=)`, 'm').test(body)
      if (target('test')) return { command: 'make test', confidence: 'high', note: 'A `test` target is defined in the Makefile.' }
      if (target('check')) return { command: 'make check', confidence: 'high', note: 'No `test` target; using the GNU-standard `check` target.' }
      return null
    },
  },
]

/**
 * Read the top level of `dir`.
 * Throws on an unreadable directory: silently returning "no markers" would let a permission
 * error or a bad path masquerade as a legitimate "this project has no tests" answer.
 */
function listDir(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    throw new Error(`testdetect: cannot read directory ${dir}: ${err.code || err.message}`, { cause: err })
  }
  const files = new Set(), dirs = new Set()
  for (const e of entries) (e.isDirectory() ? dirs : files).add(e.name)
  return { files, dirs }
}

function findMarker(d, files) {
  for (const m of d.markers || []) if (files.has(m)) return m
  for (const re of d.patterns || []) {
    const hit = [...files].filter(n => re.test(n)).sort()
    if (hit.length) return hit[0]
  }
  return null
}

/**
 * Every ecosystem whose marker is present in `dir`, strongest first.
 *
 * A repo can legitimately match several detectors — a JS frontend beside a Go backend, or a
 * Makefile wrapping a Cargo project — so the full list is returned, never truncated. Ordering:
 * confidence first (corroborated beats bare marker), then the detector's priority.
 *
 * Each match: { id, label, command, marker, markerPath, confidence, priority, lock, note?, script?, runner? }
 * `command` is null only when the ecosystem was recognised but no runnable command could be
 * confirmed; `note` always explains why.
 */
export function detectAll(dir) {
  const { files, dirs } = listDir(dir)
  const matches = []
  for (const d of DETECTORS) {
    const marker = findMarker(d, files)
    if (!marker) continue
    const markerPath = path.join(dir, marker)
    const lock = (d.lockfiles || []).find(l => files.has(l)) || null
    const base = { command: d.command, confidence: lock ? 'high' : 'medium' }
    const refined = d.refine ? d.refine({ dir, marker, markerPath, files, dirs, lock, readText, readJSON }) : {}
    if (refined === null) continue
    const merged = { ...base, ...refined }
    matches.push({
      id: d.id,
      label: d.label,
      command: merged.confidence === 'low' && !refined.command ? null : merged.command,
      marker,
      markerPath,
      confidence: merged.confidence,
      priority: d.priority,
      lock,
      ...(merged.note ? { note: merged.note } : {}),
      ...(merged.script ? { script: merged.script } : {}),
      ...(merged.runner ? { runner: merged.runner } : {}),
    })
  }
  return matches.sort((a, b) =>
    CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] ||
    a.priority - b.priority ||
    a.id.localeCompare(b.id))
}

/**
 * The single best test command for `dir`, or null when nothing recognisable is present.
 *
 * Returns { id, command, marker, confidence } — `marker` is the path of the file that triggered
 * the match, so a user can see exactly why this command was chosen. `command` may be null when
 * an ecosystem was recognised but has no usable test command (see `note` from detectAll for the
 * reason); callers that need a runnable string must check it.
 */
export function detectTestCommand(dir) {
  const [best] = detectAll(dir)
  if (!best) return null
  return { id: best.id, command: best.command, marker: best.markerPath, confidence: best.confidence, ...(best.note ? { note: best.note } : {}) }
}
